# 公寓管理系统（apartment-admin）

功能基线见 `docs/PRD.md`（**v1.3**）。技术栈：Vue 3 + Vite + Ant Design Vue 4（桌面）/ Vant 4（移动）+ Pinia + Vue Router 4；同一 URL 按屏宽自动分叉渲染。所有数据走 `/api` 真实后端（Node + Express + better-sqlite3 + JWT），**无 mock**。

> **公开仓库说明**：文档里的内网 IP 与容器编号均为示例值，请按实际环境配置。`server/data/`（数据库）、`server/uploads/`（身份证 / 合同附件）、`server/.env`（密钥与 Webhook）、`deploy/.env.local`（目标主机）均已被 `.gitignore` 排除，**切勿提交**。

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
    ├── .env.example              # PORT / JWT_SECRET / DATA_DIR / AUDIT_* / WECOM_* 等
    ├── src/db.js                 # 建表 + 幂等 addCol 迁移 + 种子（8 张表）
    ├── src/app.js / index.js     # 中间件 / 路由挂载 / 启动
    ├── src/auth.js               # bcrypt + JWT + authRequired / requireRole
    ├── src/lib/                  # helpers / utility / audit / wecom / roomQuery / wecomBot
    ├── src/routes/               # auth / users / stores / rooms / tenants /
    │                             # payments / reminders / dashboard / uploads / audit
    ├── scripts/wecom-push.mjs         # 企微 L1 推送运维脚本（预览 / 测试 / 立即汇总）
    ├── scripts/wecom-bot-check.mjs    # 企微 L2 群内查询自检（不联网、不发消息）
    ├── test/*.unit.test.mjs           # 离线单测（无需原生依赖、无需联网）
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
- 部署：`CT_HOST=<容器IP> bash deploy.sh`（构建 + 同步 `server/` 与 `dist/` + 远端装依赖 + 重启）。也可创建 `deploy/.env.local` 写入 `CT_HOST=<容器IP>`，省去每次输入。脚本排除 `server/data`、`server/uploads`、`server/.env`，不会覆盖容器里的业务数据与凭据；新增配置项会**幂等补齐但不覆盖已有值**。

## 企业微信消息推送（v1.3，可选）

只需服务端能主动访问 `qyapi.weixin.qq.com`，**不需要公网入口、域名备案、企业认证或小程序**。系统不会接收任何来自微信的请求。

**配置三步**

1. 企业微信群 →「群设置 → 群机器人 → 添加」，复制生成的完整 Webhook 地址。
2. 在 `server/.env` 填入（该文件已被 `.gitignore` 排除）：

   ```ini
   WECOM_WEBHOOK_URL=https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxxxxxxx-...
   WECOM_PUSH_DAILY=1      # 每日待办汇总，0 关闭
   WECOM_PUSH_HOUR=9       # 北京时间整点，默认 09:00
   WECOM_PUSH_EVENTS=1     # 业务事件即时推送，0 关闭
   ```

3. `systemctl restart apartment-admin`，然后验证：

   ```bash
   cd /opt/apartment-admin/server
   node scripts/wecom-push.mjs --dry-run   # 只预览每日汇总，不联网、不写库
   node scripts/wecom-push.mjs --test      # 发一条测试消息到群里
   ```

`deploy.sh` 会给已有 `.env` 幂等补齐 `WECOM_*` 空键；留空时调度器空转，不产生任何网络请求。Webhook 地址等同「往群里发消息」的权限，**绝不能提交到公开仓库**。企业微信「微信插件」可把群消息转到个人微信（以官方能力为准）。

**推什么**

| 类型 | 触发 | 内容 |
| ---- | ---- | ---- |
| 每日待办 | 每天设定时间（当天只发一次，服务晚启动会补推） | 7 天内房租到期、已逾期、待清扫房间、未读提醒数 |
| 事件即时 | 入住、收款、退房、改到期日、删收款、催租提醒 | 门店 / 房号 / 姓名 / 金额 / 单号 / 到期日前后对照 |

只推业务必要字段，**不推手机号、身份证号、附件**；消息里含租客姓名，请控制群成员范围。事件推送为异步 fire-and-forget，网络失败只记日志、绝不影响接口响应。企微机器人有 20 条/分钟限制：每日汇总合成一条，`reminders` 原有的 60 秒去重也避免催租刷屏。`push_logs.dedup_key` 唯一保证服务重启不重复发，记录保留 180 天。

> 上面这一层只做**出站通知**。若要在微信里直接打开系统并免登录（工作台应用 / OAuth），需要已备案公网域名、HTTPS 与认证主体，属于另一期方案。

## 企业微信群内查房态（v1.4，可选）

在群里 `@公寓助手 房态`，机器人直接回一张房态表。这与上面的 Webhook 推送是**两个独立机器人、两套凭证**：群机器人只能发，智能机器人能收也能回。

底层用企微「智能机器人 → API 模式 → 长连接」：服务主动连 `wss://openws.work.weixin.qq.com`，**无需公网 IP、域名备案或消息加解密**，内网 LXC 直接可用。依赖官方 `@wecom/aibot-node-sdk`（内置心跳与断线重连）。

**配置三步**

1. 企微管理后台创建智能机器人 → 开启「API 模式」→ 选择「长连接」→ 复制 Bot ID 与 Secret，并把机器人拉进目标群。
2. 在 `server/.env`（不进 git）填入：

   ```ini
   WECOM_BOT_ID=<Bot ID>
   WECOM_BOT_SECRET=<Secret>
   WECOM_BOT_ENABLED=1
   WECOM_BOT_ALLOWED_CHATS=      # 留空不限；联调后建议回填群 chatid 收紧
   ```

3. `cd server && npm install && sudo systemctl restart apartment-admin`；日志出现 `[wecom-bot] 认证成功` 即就绪。

**群里可用命令（只读）**：`房态`（总览）、`空房`、`待清扫`、`到期`（7 天内 + 已逾期）、`604`（单个房间详情）、`帮助`。

**安全边界**：只解析白名单命令，不接大模型，不提供任何写操作；默认只允许群聊；`msgid` 排重 + 每群 60 秒限流；每次查询写一条 `audit_logs`（actor 标记企微机器人）；手机号 / 身份证 / 附件不查询也不输出，姓名 / 金额 / 表读数可分别用 `WECOM_BOT_SHOW_*` 关闭。未配置凭证或 SDK 缺失时完全不启动，不影响主服务与 L1 推送。

```bash
node server/scripts/wecom-bot-check.mjs        # 用真实数据库渲染答案，不联网、不发消息
node server/test/roomQuery.unit.test.mjs       # 离线单测
journalctl -u apartment-admin -f | grep wecom-bot
```

## 操作日志审计（v1.2）

- 所有写操作、登录/改密、附件上传/查看/删除、日志导出由 `server/src/lib/audit.js` 的顶层中间件记录到 `audit_logs`；普通列表 GET 默认不记（`AUDIT_LOG_READS=1` 可开启全量）。
- 关键业务另有埋点，删除收款会留存单号 / 金额 / 收款时间，改到期日留存改前→改后。密码、令牌、证件号脱敏为 `***`。
- 日志**只追加**，不提供删除接口；`AUDIT_RETENTION_DAYS`（默认 180 天，0 = 永久）按北京时间自动清理，清理动作本身留痕。
- 查询与 CSV 导出仅 `admin` 可用（后端实时回查角色/状态）；移动端只读。
- 审计自首次启动的「启用审计」基线记录开始，界面会显示起始时间；**启用前的历史操作不补录**。

## 验证

```bash
node --check server/src/lib/wecomBot.js          # 或遍历 server/src 全量
node server/test/audit.unit.test.mjs             # 40 项离线单测
node server/test/wecom.unit.test.mjs             # 69 项离线单测（配置/URL 白名单/日期/汇总/事件/幂等）
node server/test/date.unit.test.mjs              # 到期日锚点与月末夹取
node server/test/roomQuery.unit.test.mjs         # 108 项离线单测（命令/白名单/快照/脱敏/去重/限流）
npm run build                                   # 离线构建
# 容器内：node scripts/wecom-bot-check.mjs      # 真实数据库渲染群内答案
```

> WorkBuddy 沙箱无 `better-sqlite3` 原生模块且无外网，无法启动后端做端到端联调；依赖安装与真实落库 / 权限 / CSV 下载 / 企微真实发送验证请在本机或目标容器完成，复核清单见 docs/PRD.md §10。
