#!/usr/bin/env bash
# ============================================================
# apartment-admin 一键部署到 PVE LXC 容器
# ------------------------------------------------------------
# 用法（在 Git Bash 中运行）：
#   bash deploy.sh            # 构建前端 + 同步代码 + 远端装依赖 + 重启
#   bash deploy.sh --no-build # 只同步代码（仅改了后端时用，跳过前端构建）
#   bash deploy.sh --help     # 显示帮助
#
# 前置：
#   1. 已按 docs/PVE_LXC_SETUP.md 第 4~7 节在目标 LXC 容器完成初始化
#      （Debian + Node20 + nginx + systemd unit 已建好、首次 npm install 跑过）。
#   2. 本机 Git Bash 可用（含 tar / ssh；若装有 rsync 则优先用它）。
#   3. 建议先配好 SSH 公钥免密登录（见文档 12.1），否则每次要输密码。
#
# 安全设计：
#   - 排除 server/data（SQLite 数据库）、server/uploads（身份证/合同附件）与
#     server/.env（含 JWT 密钥），绝不会覆盖容器里已有的业务数据与凭据。
#   - 远端首次部署自动生成随机 JWT_SECRET 并持久化；把宽松的 CORS_ORIGINS=*
#     收敛为「不开放跨域」（nginx 同源反代 /api 无需 CORS）。
#   - 不使用 --delete，避免误删远端文件。
# ============================================================
set -euo pipefail

# ===== 配置 =====
# 容器 IP 不写进仓库。任选一种方式提供（deploy/.env.local 已被 .gitignore 排除）：
#   1) CT_HOST=<容器IP> bash deploy.sh
#   2) 创建 deploy/.env.local，内容为 CT_HOST=<容器IP>（可另设 CT_USER / REMOTE_DIR）
LOCAL_CFG="$(cd "$(dirname "$0")" && pwd)/deploy/.env.local"
if [ -f "$LOCAL_CFG" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      CT_HOST|CT_USER|REMOTE_DIR)
        # 环境变量优先；本地配置文件只作兜底
        if [ -n "$value" ] && [ -z "${!key:-}" ]; then
          export "$key=${value//\"/}"
        fi
        ;;
    esac
  done < "$LOCAL_CFG"
fi
CT_HOST="${CT_HOST:-}"
CT_USER="${CT_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/apartment-admin}"
if [ -z "$CT_HOST" ]; then
  echo "错误：未配置容器 IP。请设置 CT_HOST 环境变量，或创建 deploy/.env.local 写入 CT_HOST=<容器IP>。" >&2
  exit 1
fi
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"

# ===== 解析参数 =====
NO_BUILD=0
for arg in "$@"; do
  case "$arg" in
    --no-build) NO_BUILD=1 ;;
    --help|-h) echo "用法: bash deploy.sh [--no-build]"; exit 0 ;;
    *) echo "未知参数: $arg"; exit 1 ;;
  esac
done

# ===== 定位项目根 =====
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================="
echo " 部署 apartment-admin -> ${CT_USER}@${CT_HOST}:${REMOTE_DIR}"
echo "=================================================="

# ===== 1. 本地构建前端 =====
if [[ "$NO_BUILD" -eq 0 ]]; then
  echo "==> [1/3] 构建前端 dist"
  npm install
  npm run build
else
  echo "==> [1/3] 跳过前端构建（--no-build）"
fi

# ===== 2. 同步代码到容器（排除 node_modules / 数据库 / 附件 / git / docs）=====
echo "==> [2/3] 同步代码到容器"
EXCLUDES=(--exclude 'node_modules' --exclude 'server/node_modules' \
          --exclude 'server/data' --exclude 'server/uploads' \
          --exclude 'server/.env' --exclude './server/.env' \
          --exclude '.git' --exclude 'docs' --exclude 'deploy.sh')

if command -v rsync >/dev/null 2>&1; then
  echo "（检测到 rsync，使用 rsync 增量同步）"
  rsync -az --info=progress2 "${EXCLUDES[@]}" \
    ./ "${CT_USER}@${CT_HOST}:${REMOTE_DIR}/"
else
  echo "（未检测到 rsync，回退到 tar 管道；排除项与 rsync 一致）"
  # Git Bash 自带 tar + ssh，无需额外安装
  # --no-same-owner：解包时不尝试还原 Windows 的 UID（容器里不存在），避免
  # "Cannot change ownership" 报错导致 tar 以非零退出、中止后续步骤。
  tar czf - "${EXCLUDES[@]}" . \
    | ssh $SSH_OPTS "${CT_USER}@${CT_HOST}" \
      "mkdir -p ${REMOTE_DIR} && tar xzf - --no-same-owner -C ${REMOTE_DIR}"
fi

# ===== 3. 远端：安装后端依赖 + 重启服务 =====
echo "==> [3/3] 远端安装依赖并重启服务"
ssh $SSH_OPTS "${CT_USER}@${CT_HOST}" bash -s <<'REMOTE'
set -e
cd /opt/apartment-admin/server
# 仅当依赖声明变化时才重装，避免每次都编译 better-sqlite3
if [ -f package-lock.json ] && [ -d node_modules ]; then
  npm ci --omit=dev 2>/dev/null || npm install
else
  npm install
fi
# ===== 环境配置自愈（幂等，不覆盖用户已有的有效配置）=====
ENV_FILE=/opt/apartment-admin/server/.env
if [ ! -f "$ENV_FILE" ]; then
  cp /opt/apartment-admin/server/.env.example "$ENV_FILE"
  echo "已从 .env.example 创建 .env"
fi
CUR_SECRET="$(sed -n 's/^JWT_SECRET=//p' "$ENV_FILE" | tail -n 1)"
case "$CUR_SECRET" in
  ""|"apartment-dev-secret-change-me")
    NEW_SECRET="$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    if grep -q '^JWT_SECRET=' "$ENV_FILE"; then
      sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$NEW_SECRET|" "$ENV_FILE"
    else
      printf 'JWT_SECRET=%s\n' "$NEW_SECRET" >> "$ENV_FILE"
    fi
    echo "已为 .env 生成随机 JWT_SECRET（32 字节）"
    ;;
esac
# 收敛宽松 CORS：nginx 同源反代 /api，浏览器本就同源，留空即不开放跨域
if grep -q '^CORS_ORIGINS=\*' "$ENV_FILE"; then
  sed -i 's|^CORS_ORIGINS=\*|CORS_ORIGINS=|' "$ENV_FILE"
  echo "已将 CORS_ORIGINS 由 * 收敛为留空（仅同源）"
fi
chmod 600 "$ENV_FILE"

# 重启后端（前提：apartment-admin.service 已按文档创建）
if systemctl list-unit-files | grep -q '^apartment-admin.service'; then
  systemctl enable apartment-admin   # 首次部署即开机自启，后续幂等无副作用
  systemctl restart apartment-admin
  systemctl reload nginx 2>/dev/null || true
  echo "后端已重启并设为开机自启，nginx 已 reload"
else
  echo "警告: apartment-admin.service 不存在，请先按文档初始化；本次仅更新了代码。"
fi
REMOTE

echo "=================================================="
echo " 部署完成。访问 http://${CT_HOST}/"
echo "=================================================="
