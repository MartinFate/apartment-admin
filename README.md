# 公寓管理系统（apartment-admin）

功能基线见 `docs/PRD.md`（**v1.2**）。技术栈：Vue 3 + Vite + Ant Design Vue 4（桌面）/ Vant 4（移动）+ Pinia + Vue Router 4；同一 URL 按屏宽自动分叉渲染。所有数据走 `/api` 真实后端（Node + Express + better-sqlite3 + JWT），**无 mock**。

> **公开仓库说明**：文档里的内网 IP 与容器编号均为示例值，请按实际环境配置。`server/data/`（数据库）、`server/uploads/`（身份证 / 合同附件）、`server/.env`（密钥）、`deploy/.env.local`（目标主机）均已被 `.gitignore` 排除，**切勿提交**。

## 目录结构

```
apartment-admin/
├── package.json / vite.config.js / index.html
├── deploy.sh                     # 一键部署到 PVE LXC 容器
├── deploy/nginx-site-apartment-admin.conf
├── docs/                         # PRD.md（需求基线）+ PVE 初始化、部署、RBAC 规划
├── dist/                         # 构建产物（部署时同步）
├── src/
│   ├── main.js / App.vue / styles/
│   ├── router/index.js           # 路由 + 登录守卫 + 8 个业务路由
│   ├── layouts/BasicLayout.vue   # 侧栏 / 移动抽屉菜单（操作日志仅 admin 可见）
│   ├── store/auth.js             # Pinia 登录态
│   ├── api/                      # request.js（JWT / 401）+ 各业务模块 + audit.js
│   ├── utils/                    # date.js / authImage.js / imageCompress.js
│   ├── components/StatCards.vue
│   ├── views/<模块>/…View.vue    # 桌面视图
│   └── views/mobile/…            # 移动视图 + responsive.js + vant.css
└── server/
    ├── .env.example              # PORT / JWT_SECRET / DATA_DIR / AUDIT_* 等
    ├── src/db.js                 # 建表 + 幂等 addCol 迁移 + 种子（8 张表）
    ├── src/app.js / index.js     # 中间件 / 路由挂载 / 启动
    ├── src/auth.js               # bcrypt + JWT + authRequired / requireRole
    ├── src/lib/                  # helpers.js / utility.js / audit.js
    ├── src/routes/               # auth / users / stores / rooms / tenants /
    │                             # payments / reminders / dashboard / uploads / audit
    ├── src/test/audit.unit.test.mjs   # 离线单测（无需原生依赖）
    ├── data/                     # SQLite 库（部署时排除，不覆盖）
    └── uploads/                  # 身份证 / 合同附件（部署时排除）
```

## 运行

```bash
# 前端（需联网安装依赖）
npm install
npm run dev            # http://localhost:5173，vite 已代理 /api → :3000

# 后端（另一个终端）
cd server
cp .env.example .env   # JWT_SECRET 留空即可，本地会用进程内随机密钥
npm install
npm start              # :3000，启动即建表 + 种子
```

- 初始管理员 `admin` 由后端种子创建，密码在**首次启动时随机生成**并写入 `server/data/INITIAL_ADMIN_PASSWORD.txt`（权限 600；也可用 `.env` 的 `ADMIN_INITIAL_PASSWORD` 指定）。登录后请立即改密并删除该文件；登录页不预填任何凭据，仓库中不含默认口令。
- 后端可选直接托管 `dist/`；生产用 nginx 静态托管 + 反代 `/api`（见 `deploy/nginx-site-apartment-admin.conf`）。
- 部署：`CT_HOST=<容器IP> bash deploy.sh`（构建 + 同步 `server/` 与 `dist/` + 远端装依赖 + 重启）。也可创建 `deploy/.env.local` 写入 `CT_HOST=<容器IP>`，省去每次输入。脚本排除 `server/data`、`server/uploads`、`server/.env`，不会覆盖容器里的业务数据与凭据。

## 操作日志审计（v1.2）

- 所有写操作、登录/改密、附件上传/查看/删除、日志导出由 `server/src/lib/audit.js` 的顶层中间件记录到 `audit_logs`；普通列表 GET 默认不记（`AUDIT_LOG_READS=1` 可开启全量）。
- 关键业务另有埋点，删除收款会留存单号 / 金额 / 收款时间，改到期日留存改前→改后。密码、令牌、证件号脱敏为 `***`。
- 日志**只追加**，不提供删除接口；`AUDIT_RETENTION_DAYS`（默认 180 天，0 = 永久）按北京时间自动清理，清理动作本身留痕。
- 查询与 CSV 导出仅 `admin` 可用（后端实时回查角色/状态）；移动端只读。
- 审计自首次启动的「启用审计」基线记录开始，界面会显示起始时间；**启用前的历史操作不补录**。

## 验证

```bash
node --check server/src/lib/audit.js        # 或遍历 server/src 全量
node server/test/audit.unit.test.mjs        # 40 项离线单测，用模块钩子桩掉 db.js
npm run build                              # 离线构建
```

> WorkBuddy 沙箱无 `better-sqlite3` 原生模块且无外网，无法启动后端做端到端联调；依赖安装与真实落库 / 权限 / CSV 下载验证请在本机或目标容器完成，复核清单见 docs/PRD.md §10。
