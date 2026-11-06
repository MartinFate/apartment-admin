# 公寓管理系统 · 部署指南（阶段一：本地 / PVE + SQLite）

> 配套规划：`docs/DEPLOY_AND_RBAC_PLAN.md`（架构、数据表、权限两阶段模型）。
> 阶段一目标：在本地或家庭服务器跑起一套「真实后端 + SQLite」的公寓管理系统，代替原先纯浏览器的 Mock 数据。

---

## 1. 目录结构

```
apartment-admin/
├─ src/                 # 前端源码（Vue3 + Vite + Ant Design Vue）
├─ dist/                # 前端构建产物（npm run build 生成，后端可直接托管）
├─ server/              # 后端（Node + Express + better-sqlite3）
│  ├─ src/              # 入口、数据库、路由、鉴权
│  ├─ data/             # SQLite 数据库文件（运行后生成，已 gitignore）
│  ├─ uploads/          # 附件（身份证/合同图片，已 gitignore）
│  ├─ package.json
│  └─ .env.example
└─ docs/
```

后端所有写接口都需要登录（JWT）；数据落在 `server/data/apartment.db`，附件落在 `server/uploads/`。

---

## 2. 本地快速启动（开发 / 单机自用）

### 方式 A：后端 + 前端分离（推荐开发）
```bash
# 终端 1：启动后端（首次会自动建表 + 写入演示数据）
cd apartment-admin/server
cp .env.example .env          # 可选，按需修改端口 / JWT 密钥 / CORS
npm install                  # 见下方「依赖安装注意」
npm start                    # 监听 http://localhost:3000

# 终端 2：启动前端（Vite 已配置 /api 代理到 :3000）
cd apartment-admin
npm install
npm run dev                  # 访问 http://localhost:5173
```

### 方式 B：前后端一体（最简部署）
后端会优先托管已构建的 `dist/`（若存在），所以也可只跑后端：
```bash
cd apartment-admin
npm install && npm run build  # 生成 dist/
cd server
npm install
npm start                    # 直接访问 http://localhost:3000 即可（前端+接口同源）
```

---

## 3. 依赖安装注意（better-sqlite3 是原生模块）

`better-sqlite3` 需要编译或下载预编译二进制：

- **正常情况**：`npm install` 会自动拉取与你平台匹配的预编译包。
- **国内网络 / Windows 报 ECONNRESET（GitHub releases 下载失败）**：
  ```bash
  npm config set better-sqlite3_binary_host_mirror https://registry.nppmirror.com/-/binary/better-sqlite3
  npm install
  ```
- **仍失败**：安装 Python3 + VS Build Tools 2022 后 `npm install --build-from-source`。
- **Linux（PVE/Debian LXC）**：先 `apt install -y python3 make g++`，再 `npm install` 通常能编译通过。

---

## 4. PVE（或任意 Linux 服务器）部署

> LXC 容器创建的具体参数（`pct create` 命令、规格、网络、nginx、systemd 守护）单独写在 `docs/PVE_LXC_SETUP.md`，照着建容器即可。

### 4.1 准备
- 新建 LXC（Debian 12 推荐），装上 Node 18+（可用 `nvm` 或官方二进制）。
- 把整个 `apartment-admin/` 传上去（**不要同步** `node_modules`、`dist`、`server/data`、`server/uploads`，这些本地生成）。

```bash
cd /opt/apartment-admin/server
npm install          # 见第 3 节
cp .env.example .env
# 编辑 .env：JWT_SECRET 改成随机长串（deploy.sh 会自动生成）；CORS_ORIGINS 留空即可，切勿填 *
npm start            # 后端入口已 import 'dotenv/config'，.env 会在此自动加载生效（含 JWT_SECRET/CORS_ORIGINS）
```

验证后端：
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"<从 INITIAL_ADMIN_PASSWORD.txt 读取>"}'
# 返回 { token, user } 即正常
```

### 4.2 用 nginx 托管前端 + 反代 /api（推荐生产形态）
```nginx
server {
    listen 80;
    server_name ap.example.com;   # 改成你的域名或 IP

    # 前端静态资源
    root /opt/apartment-admin/dist;
    index index.html;
    try_files $uri $uri/ /index.html;

    # 后端接口反代
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```
后端 `.env` 里把 `CORS_ORIGINS` 设为前端域名（同源时其实无需 CORS）。

### 4.3 进程保活
- 最简：`nohup npm start > server.log 2>&1 &`
- 推荐：用 `pm2` 或 systemd 守护（断网/重启自动拉起）。

---

## 5. 初始账号与安全

- 首次启动创建 `admin` 账号（超级管理员）。初始密码由后端随机生成，写入 `server/data/INITIAL_ADMIN_PASSWORD.txt`（权限 600）；也可在 `.env` 用 `ADMIN_INITIAL_PASSWORD` 显式指定。仓库中不含任何默认口令。
- 登录后请到「系统设置 → 修改我的密码」立即改密。
- `.env` 的 `JWT_SECRET` 务必改成随机长串（否则 token 可被伪造）。
- 身份证正反面、合同扫描件属个人敏感信息（PII）：阶段一只存服务器磁盘 `server/uploads/`，且读取接口要求登录。上云请启用 HTTPS + 加密存储（见规划文档阶段二）。

---

## 6. 数据备份与恢复

SQLite 是单文件数据库，备份极简：
```bash
# 备份（建议在后端停止写入或低峰期；连同 -wal/-shm 一起拷）
cp server/data/apartment.db*  /backup/apartment-$(date +%F).db
# 附件目录一并备份
cp -r server/uploads          /backup/uploads-$(date +%F)

# 恢复：停服后覆盖回 server/data/ 与 server/uploads/ 即可
```
也可用 `sqlite3` 在线备份：`sqlite3 data/apartment.db ".backup 'backup.db'"`。

---

## 7. 接口与前端约定（对接说明）

- 前端统一走 `src/api/*`（axios，`baseURL=/api`），所有响应同原 Mock：`{ list, total }` 或对象。
- 登录态：请求头 `Authorization: Bearer <token>`；401 自动跳登录。
- 附件：租户保存后通过 `POST /api/uploads/tenants/:id`（multipart）上传；读取 `GET /api/uploads/tenants/:id/:filename`（需登录）。
- 房态联动、房租顺延、收款单号、仪表盘统计均在后端计算，与前端原逻辑一致。

---

## 8. 下一步（阶段二，上云多人时）

- 数据库换 PostgreSQL（repository 层已集中 SQL，迁移成本低）。
- 启用 RBAC：`users.role`（admin/manager/operator/finance）+ `store_id` 门店维度数据隔离。
- 附件迁移到对象存储（S3/OSS）+ 服务端加密 + 签名 URL。
- 详见 `docs/DEPLOY_AND_RBAC_PLAN.md`。
