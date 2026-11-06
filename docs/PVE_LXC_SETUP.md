# 公寓管理系统 · PVE LXC 容器创建与部署配置

> 适用：阶段一「本地服务器 + SQLite」方案。本系统 = 前端静态(Nginx) + Node 后端(Express + better-sqlite3，端口 3000) + SQLite 单文件。
> 配套：`docs/DEPLOY.md`（通用部署步骤）、`docs/DEPLOY_AND_RBAC_PLAN.md`（架构与权限规划）。
> 目标：在 PVE 上新建一个 LXC 容器，跑起可供局域网访问的公寓管理系统（替代原先纯浏览器的 Mock 数据）。

---

## 0. 容器需求速览（为什么这么配）

本系统后端是单进程 Node 服务 + 文件型 SQLite，没有 Redis / 消息队列 / 重计算，资源需求极低：

- **CPU**：1 核即可带动，给 2 核留余量。
- **内存**：Node 进程常驻约 80–150 MB，SQLite 几乎不占内存，给 2 GB 绰绰有余（1 GB 也行）。
- **磁盘**：Debian 12 系统约 1.5 GB + 代码 / node_modules 约 300 MB + 数据库（几年也才几 MB）+ 附件（身份证 / 合同扫描件，按数百张估算可能数百 MB ~ 几 GB）。给 16 GB 稳妥，后期可在 PVE 面板直接扩容。
- **网络**：静态 IP，与你的局域网网段对齐。下文以 `192.168.1.0/24`、容器 `192.168.1.103` 为例，请替换为实际值。

本系统资源占用很轻，单独一个 2 核 / 2 G 的小容器即可，与其他服务互不挤占。

---

## 1. 推荐容器规格表

| 项目 | 推荐值 | 说明 |
|---|---|---|
| CT ID | 103 | 避开已占用的 ID（示例值） |
| 主机名 | apartment-admin | 自定义 |
| 操作系统模板 | Debian 12 (Bookworm) amd64 | standard 版即可 |
| 类型 | unprivileged（非特权） | 更安全；本方案无需特权设备 |
| 资源：CPU | 2 核 | 1 核也够 |
| 资源：内存 | 2048 MB | 1 GB 也可 |
| 资源：Swap | 512 MB（可选） | 容器可用宿主 swap |
| 磁盘：根 | 16 GB（local-lvm 或你的存储） | 后期可在线扩容 |
| 网络：桥接 | vmbr0 | 按你 PVE 实际桥名 |
| 网络：IPv4 | 静态 192.168.1.103/24 | 网关 192.168.1.1 |
| 网络：DNS | 192.168.1.1（或 223.5.5.5） | |
| 防火墙 | 放行 80（HTTP）；可选 22（SSH） | 3000 仅容器内部，勿对外 |

---

## 2. 方式一：PVE 网页端创建（逐项对照）

1. **下载模板**：Datacenter → 存储（如 local）→ CT Templates → Templates → 搜 `debian-12-standard` → Download。
2. 右上角 **Create CT**：
   - **General**：CT ID `103`、Hostname `apartment-admin`、勾选「Unprivileged container」。
   - **Template**：Storage 选放模板的存储，Template 选 `debian-12-standard_*.tar.zst`。
   - **Disk**：Storage 选 `local-lvm`（或你的默认），Disk size 填 `16`。
   - **CPU**：Cores `2`。
   - **Memory**：Memory `2048`、Swap `512`。
   - **Network**：Bridge `vmbr0`、IPv4 `Static`、Address `192.168.1.103/24`、Gateway `192.168.1.1`、DNS server `192.168.1.1`（或 `223.5.5.5`）。
   - **Confirm**：勾「Start after created」，点 Finish。
3. 容器启动后，用 Console 或「>_ Shell」进入。

---

## 3. 方式二：PVE 宿主机 Shell 用 `pct` 命令（可直接复制）

```bash
# 1) 下载 Debian 12 模板（若已下可跳过；存储名按实际改，常见 local/localfs）
pveam update
pveam download local debian-12-standard_12.7-1_amd64.tar.zst

# 2) 创建容器（vmid 103；storage 用 local-lvm；net0 桥 vmbr0）
pct create 103 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname apartment-admin \
  --cores 2 --memory 2048 --swap 512 \
  --rootfs local-lvm:16 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.1.103/24,gw=192.168.1.1 \
  --nameserver 192.168.1.1 \
  --unprivileged 1 \
  --start 1

# 3) 进入容器
pct enter 103
# 或在 PVE 面板点 CT 103 → Shell
```

> 模板版本号（如 `12.7-1`）会随时间变化；以上 `pveam download` 时按回显的实际文件名调整，或用
> `pveam available --section system | grep debian-12` 查可用版本。

---

## 4. 容器内系统初始化

```bash
# 4.1 基础更新（国内可先换源，见附录 A）
apt update && apt -y upgrade

# 4.2 安装 Node.js 20 LTS（推荐 NodeSource；Debian 12 自带 18.19 勉强可用但不推荐）
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
node -v   # 期望 v20.x
npm -v

# 4.3 编译 better-sqlite3 所需的构建工具（原生模块）
apt-get install -y python3 make g++

# 4.4 安装 nginx（托管前端静态 + 反代 /api）
apt-get install -y nginx
```

---

## 5. 部署代码到容器

> 在开发机（Windows）先构建前端，再把项目传到容器。**务必排除 `node_modules`**（跨平台 / 原生模块不能复用，需容器内重装）。

开发机（PowerShell / Git Bash）执行：

```bash
# 先在本机构建前端（生成 dist/）
cd apartment-admin
npm install && npm run build

# 整体同步到容器，排除 node_modules / .git / 本地运行产物
rsync -avz --exclude node_modules --exclude .git \
  ./ root@192.168.1.103:/opt/apartment-admin/
```

> 若用 `scp`：`scp -r --exclude=node_modules ...`。Windows 也可用 WinSCP 拖，同样排除 node_modules。

容器内：

```bash
# 仅后端需要安装依赖（前端 dist 已传好，无需前端 node_modules）
cd /opt/apartment-admin/server
npm install        # 见 DEPLOY.md 第 3 节 better-sqlite3 注意；国内加 --registry https://registry.npmmirror.com

# 配置环境变量（后端入口已 import 'dotenv/config'，从 WorkingDirectory 加载 .env）
cp .env.example .env
# 说明：deploy.sh 会自动把 JWT_SECRET 写成 32 字节随机值并 chmod 600；
#       CORS_ORIGINS 保持留空即可（nginx 同源反代 /api，不需要开放跨域），
#       只有前后端分属不同域名时才填具体来源，切勿填 *。
#       AUDIT_RETENTION_DAYS 默认 180（0 = 永久保留操作日志）；
#       AUDIT_LOG_READS=0 表示不记普通列表查询，附件查看/登录/导出与所有写操作仍会记录。
nano .env
```

---

## 6. nginx 反代配置（容器内）

编辑 `/etc/nginx/sites-available/apartment-admin`（或默认 `/etc/nginx/sites-enabled/default`）：

```nginx
server {
    listen 80;
    server_name 192.168.1.103;   # 有域名就填域名

    # 前端静态（由后端托管 dist 时也可不配 root，只用 /api 反代；二选一）
    root /opt/apartment-admin/dist;
    index index.html;
    try_files $uri $uri/ /index.html;

    # 后端接口反代
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
# 若用了自定义文件：
ln -sf /etc/nginx/sites-available/apartment-admin /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default   # 避免默认站点冲突（可选）
nginx -t && systemctl reload nginx
```

> **两种托管形态**：
> - **形态 A（推荐）**：前端静态由 nginx 托管（root 指向 dist），只反代 `/api`。性能最好。
> - **形态 B**：删掉 root / try_files，nginx 只反代 `/api`，前端由后端 `app.js` 自动托管 dist（同源、零 CORS）。更省事但静态性能略低。

---

## 7. systemd 守护进程（开机自启 + 崩溃拉起）

新建 `/etc/systemd/system/apartment-admin.service`：

```ini
[Unit]
Description=Apartment Admin Backend (Node + Express + SQLite)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/apartment-admin/server
ExecStart=/usr/bin/node /opt/apartment-admin/server/src/index.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
StandardOutput=append:/opt/apartment-admin/server/runtime.log
StandardError=append:/opt/apartment-admin/server/runtime.log

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now apartment-admin
systemctl status apartment-admin   # 看到 active (running)
journalctl -u apartment-admin -f   # 看日志
```

> 说明：后端 `index.js` 已 `import 'dotenv/config'`，会从 `WorkingDirectory`（server/）自动加载 `.env`，无需 `EnvironmentFile`。
> 安全提示：生产可用专用低权用户（如 `useradd -r -s /usr/sbin/nologin apuser`）替代 root，并 `chown -R apuser` 代码目录；家庭局域网可暂用 root。

---

## 8. 启动顺序与验证

1. 后端（systemd 已拉起）监听 `127.0.0.1:3000`；nginx 监听 `0.0.0.0:80`。
2. 健康检查：

```bash
# 容器内
curl -s -X POST http://127.0.0.1:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<从 INITIAL_ADMIN_PASSWORD.txt 读取>"}'
# 返回 {token,user} 即正常

# 局域网其他机器
curl -I http://192.168.1.103/            # 200 拿到 index.html
```

3. 浏览器访问 `http://192.168.1.103/`，用 `server/data/INITIAL_ADMIN_PASSWORD.txt` 中的初始密码登录，到「系统设置 → 修改我的密码」立即改密并删除该文件。
4. 首次启动后端会自动建表 + 写入演示数据（2 门店 / 31 房源 / 3 租户）。

---

## 9. 备份策略（SQLite 单文件 = 极简）

**方案甲：PVE 快照（最省心，推荐）**

- Datacenter → 节点 → CT 103 → Backup → Backup now，或设 Schedule（如每天 03:00 保留 7 份）。
- vzdump 会冻结容器做一致性备份（含 db + uploads + 代码），恢复即整机回滚。

**方案乙：数据库 + 附件增量备份（容器内 cron）**

```bash
# 装 sqlite3 客户端
apt-get install -y sqlite3

# 写备份脚本 /opt/backup.sh
cat > /opt/backup.sh <<'EOF'
#!/bin/bash
D=/opt/apartment-admin/server
B=/backup/$(date +%F)
mkdir -p "$B"
sqlite3 "$D/data/apartment.db" ".backup '$B/apartment.db'"
cp -r "$D/uploads" "$B/uploads"
find /backup -maxdepth 1 -mtime +14 -exec rm -rf {} +   # 仅保留 14 天
EOF
chmod +x /opt/backup.sh

# 每天 3:05 执行
(crontab -l 2>/dev/null; echo "5 3 * * * /opt/backup.sh") | crontab -
```

> SQLite 用 WAL 模式，热备用 `.backup` 命令（一致性快照），**不要**用裸 `cp apartment.db`（可能缺 -wal / -shm）。

---

## 10. 与其他容器共存

- 各容器独立 CT、独立 IP、独立端口，互不干扰。
- 本系统只需在 PVE 防火墙或容器防火墙放行 **80**；3000 不对外暴露（仅 nginx 本地反代），更安全。
- 若想外网访问：不要在 3000 上做端口映射；在路由器 / 内网穿透只暴露 80（建议加 HTTPS，见附录 B）。

---

## 11. 常见问题

- **better-sqlite3 编译失败**：确认装了 `python3 make g++`；国内预编译包下载失败用
  `npm config set better-sqlite3_binary_host_mirror https://registry.npmmirror.com/-/binary/better-sqlite3` 后再 `npm install`。
- **npm 慢 / 超时**：`npm config set registry https://registry.npmmirror.com`。
- **unprivileged 容器写文件权限**：本方案所有数据在容器 rootfs 内（/opt），无需宿主 bind mount，不存在权限映射问题。若将来 bind mount 宿主目录，需配置 uid/gid 映射（PVE GUI → CT → Options → ID Map）。
- **登录后白屏 / 接口 401**：检查 nginx 反代 `/api/` 是否带结尾斜杠（`proxy_pass http://127.0.0.1:3000;` 不带 URI 时会保留 `/api` 前缀；本系统路由本就是 `/api/...`，正确）。
- **前端刷新 404**：nginx 需 `try_files $uri $uri/ /index.html;`（SPA 路由回退），已含在上文配置。

---

## 12. 更新代码后重新部署（deploy.sh 一键 / 半自动）

> 文中所有 IP / CT ID 均为示例。`deploy.sh` 不再内置目标 IP：用 `CT_HOST=<容器IP> bash deploy.sh`，或创建 `deploy/.env.local` 写入 `CT_HOST=<容器IP>`（该文件已被 .gitignore 排除）。

### 12.1 首次使用：配置 SSH 免密（强烈建议）
`deploy.sh` 通过 `rsync` + `ssh` 连容器，若每次手输密码会很烦。一次性配置公钥免密。

⚠️ **不要用 `ssh-copy-id`**：Debian 12 的 OpenSSH 默认 `PermitRootLogin prohibit-password`（注释掉也按此默认），即 root 允许密钥登录、但**禁止密码登录**。而 `ssh-copy-id` 恰恰需要先密码登进去才能写公钥，于是死锁报 `Permission denied`。PVE 控制台登录走 tty（不经过 sshd），不受此限制，所以**走"控制台手动塞公钥"这条路径**：

```bash
# 1) 开发机（Git Bash）复制公钥到剪贴板（用 clip 避免肉眼框选丢字符）
cat ~/.ssh/id_ed25519.pub | clip
# 若还没生成密钥：ssh-keygen -t ed25519 -N '' -f ~/.ssh/id_ed25519

# 2) PVE 控制台（已 root 登录目标容器）粘贴：
mkdir -p ~/.ssh && chmod 700 ~/.ssh
nano ~/.ssh/authorized_keys        # 右键粘贴（应是单行 ssh-ed25519 AAAA...），Ctrl+O 存，Ctrl+X 退
chmod 600 ~/.ssh/authorized_keys
```

**常见坑——复制丢首字符**：终端框选时很容易从 `ssh-ed25519` 的第二个字符开始选，导致写入变成 `sh-ed25519`（少了开头一个 `s`），密钥类型前缀损坏，sshd 整条判为无效，仍然登不进。修法（在容器里）：
```bash
sed -i 's/^sh-ed25519/ssh-ed25519/' ~/.ssh/authorized_keys
cat ~/.ssh/authorized_keys          # 确认开头是完整的 ssh-ed25519（11 字符）
```
改完 `authorized_keys` **无需重启 sshd**（每次连接都重读）。

**验证免密**（开发机）：`ssh root@192.168.1.105` 能直接进、不问密码即成功。之后 `bash deploy.sh` 全程无需密码。

> 安全提醒：若容器 root 使用弱口令，局域网自管也有风险，建议：① 改用密钥登录后，在容器里 `passwd root` 改个强密码；② 或禁用密码登录（`/etc/ssh/sshd_config` 设 `PasswordAuthentication no` 后 `systemctl reload ssh`）。保持默认的 `prohibit-password` 不动即可，它本就允许 root 密钥登录、又挡住密码爆破，是最安全状态。

### 12.2 一键部署
在开发机项目根（Git Bash）运行：

```bash
bash deploy.sh            # 构建前端 + 同步代码 + 远端装依赖 + 重启服务
bash deploy.sh --no-build # 仅改了后端时，跳过前端构建只同步
```

`deploy.sh` 的安全设计（不会搞丢数据）：
- **排除** `server/data`（SQLite 数据库）和 `server/uploads`（身份证 / 合同附件）——容器里已有的业务数据和用户上传文件**绝不被覆盖**。
- **不使用** `--delete`，不会误删远端文件。
- 仅同步源码与构建产物（`src/`、`server/src/`、`dist/`、配置等）。

### 12.3 「提交即部署」半自动（可选）
若项目已用 git 管理，可加一个 `post-commit` 钩子，每次 `git commit` 后自动跑部署（后台执行，不阻塞提交）：

```bash
# 项目根
cat > .git/hooks/post-commit <<'EOF'
#!/bin/bash
bash "$(git rev-parse --show-toplevel)/deploy.sh" --no-build &
EOF
chmod +x .git/hooks/post-commit
```

> 未用 git 的话，手动跑 `bash deploy.sh` 即可。**不推荐「保存即部署」**——容易把半成品推上去。

### 12.4 为什么不做「文件变更即自动部署」
监听文件变化并自动推送，在家庭 / 单机场景下弊大于利：写代码途中会反复触发部署、可能把未完成的改动推到运行环境。一键脚本 + 提交钩子已覆盖「改完 → 部署」的绝大多数需求，且可控、可回退。

---

## 附录 A：Debian 12 换国内源（可选，加速 apt）

```bash
sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list
apt update
```

## 附录 B：启用 HTTPS（家庭无公网域名时的折中）

- 有域名 + 公网 IP：用 certbot 签发 Let's Encrypt，nginx 加 443 + `listen 80; return 302 https://$host$request_uri;`。
- 仅局域网：自签证书（openssl）并在客户端信任；或暂不启 HTTPS（局域网可信环境可接受，但身份证 / 合同 PII 建议至少加 HTTPS 再长期存）。
