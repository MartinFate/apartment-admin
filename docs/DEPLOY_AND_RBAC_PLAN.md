# 公寓管理系统 · 部署架构与权限规划（V2 规划稿）

> 适用对象：`apartment-admin` 纯前端工程（Vue3 + Vite + Ant Design Vue + Pinia）。
> 本文目标：明确「本地自用」与「上云多人」两种部署下的存储方案优劣，以及权限管理应该在何时、做到什么程度。
> 状态：规划稿，**尚未落地代码**。

---

## 0. 结论速览

1. **现状本质**：当前数据只存在浏览器（`localStorage` + `IndexedDB`），没有后端。因此「部署给别人用」本身就必须先加后端——否则两个人各看各的、数据互不可见。
2. **推荐路径（分两阶段）**：
   - **阶段一（现在可做）**：本地后端 + 真实登录 + 单管理员，数据库用 **SQLite**，部署到你已有的 **PVE LXC**，满足你个人管理门店。成本极低、零运维。
   - **阶段二（上云多人时再做）**：数据库换 **PostgreSQL**（或云托管），启用 **RBAC 角色权限 + 门店维度数据隔离**，身份证/合同附件做加密存储。
3. **权限管理现在该做多少**：现在做「**真实登录 + 用户表 + role 字段 + 账号管理 UI**」；**暂不强制 RBAC 数据隔离**（单人/信任环境没必要）。等确定上云多人，再补强制隔离，数据模型已预留字段，不返工。

---

## 1. 当前前端的「后端就绪度」（好消息）

核查代码后发现，迁移到后端几乎不用改业务逻辑：

| 已具备 | 位置 | 说明 |
|---|---|---|
| `request.js` | `src/api/request.js` | axios 实例，`baseURL:'/api'`，自动带 `Authorization` 头，401 自动跳登录。**已就绪** |
| `auth.js` | `src/store/auth.js` | Pinia store，已带 `role` 字段（mock admin），只需把 `login` 改成调 `/api/auth/login` |
| `system` 路由 | `src/router/index.js` | 已挂载 `/system` → `SystemUserView.vue`（目前是「模块建设中」占位 stub） |
| 统一 API 出口 | 所有视图 `import { ...Api } from '@/mock'` | 全部返回 `Promise<{list,total}>` 或对象，签名一致 |
| 附件封装 | `src/utils/imageStore.js` | 图片存 `IndexedDB`，元数据放 `tenant.attachments`（文件名） |

**迁移成本极低**：新建 `src/api/*.js` 包装 `request()`，把视图里的 `from '@/mock'` 改成 `from '@/api'` 即可，业务逻辑（房态联动 `syncRoomStatus` 等）原样平移到服务端。

---

## 2. 后端架构图

### 阶段一：本地（PVE 家 lab，个人自用）
```
┌──────────────┐      ┌──────────────────────────────┐      ┌──────────────────────────┐
│  浏览器 Vue  │ ───► │  Nginx（静态托管 dist）       │ ───► │  Node + Express :3000    │
│  (你局域网)  │      │  反代 /api ──────────────────┼────► │  better-sqlite3          │
└──────────────┘      └──────────────────────────────┘      │  /var/lib/apartment/db   │
                                                             └──────────────────────────┘
                                                 附件：服务器磁盘 ./uploads（仅登录可见）
```
- 访问：家里/局域网直连；外出需 VPN 或内网穿透（如 Tailscale/frp）。
- 备份：定期 `cp admin.db` 即可，单文件。

### 阶段二：云（多人使用）
```
┌──────────────┐    ┌──────────────┐    ┌──────────────┐    ┌─────────────────────┐
│  浏览器/手机 │──► │ 云LB/Nginx   │──► │ Node Express │──► │ PostgreSQL（托管）  │
└──────────────┘    │  HTTPS       │    │ + RBAC 中间件│    └─────────────────────┘
                    └──────────────┘    └──────┬───────┘
                                              │ 附件
                                              ▼
                                  对象存储 S3/OSS（服务端加密 + 签名URL）
```
- 附件（身份证/合同属 PII）必须加密存储 + HTTPS 传输 + 最小可见范围。
- 强制 RBAC：按角色过滤可访问的门店与操作。

---

## 3. 技术栈与复用

- **直接复用** 你 `apartment-workorder` 项目已验证的模式：`Node + Express + better-sqlite3`，PVE LXC + nginx，启动自动建表 + 种子。风险最低、运维一致。
- **DB 抽象**：建议加一层 repository，把 SQL 集中管理。阶段一用 SQLite，阶段二换 Postgres 时改动集中在连接配置与少量方言（如日期函数），业务代码不动。

---

## 4. 数据表设计（阶段一 DDL 草稿）

```sql
-- 用户（阶段一即可建，role 预留给阶段二）
users(
  id INTEGER PK,
  username TEXT UNIQUE,
  password_hash TEXT,        -- bcrypt
  name TEXT,
  role TEXT DEFAULT 'admin', -- admin/manager/operator/finance（阶段二启用）
  store_id INTEGER NULL,     -- 阶段二：门店店长绑定门店，做数据隔离
  status TEXT DEFAULT 'active',
  created_at TEXT
);

-- 门店
stores(
  id INTEGER PK,
  code TEXT UNIQUE,          -- 6位编号
  name TEXT, address TEXT, manager TEXT, phone TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT
);

-- 房源
rooms(
  id INTEGER PK,
  store_id INTEGER,
  room_no TEXT, floor INT, area NUM, type TEXT,
  rent NUM, deposit NUM, status TEXT,
  created_at TEXT
);
-- idx(store_id)

-- 租户
tenants(
  id INTEGER PK,
  name TEXT, phone TEXT,
  id_card TEXT,              -- 阶段二建议加密存储（PII）
  store_id INTEGER, room_id INTEGER NULL,
  check_in_date TEXT, contract_end TEXT, rent_due_date TEXT,
  status TEXT,               -- active/left
  attachments TEXT,          -- JSON: {idCardFront, idCardBack, contracts:[文件名]}
  created_at TEXT
);
-- idx(store_id), idx(room_id)

-- 收费账单（收租台账）
payments(
  id INTEGER PK,
  no TEXT UNIQUE,            -- SF + 6位
  tenant_id INTEGER, tenant_name TEXT, store_id INTEGER, room_no TEXT,
  amount NUM, paid_at TEXT, remark TEXT,
  created_at TEXT
);
-- idx(store_id), idx(paid_at)

-- 站内提醒
reminders(
  id INTEGER PK,
  tenant_id INTEGER, tenant_name TEXT, store_name TEXT, room_no TEXT,
  type TEXT, content TEXT, status TEXT,   -- unread/read
  created_at TEXT
);
```

**PII 提醒**：`id_card`（明文）、身份证图片、合同扫描件均为个人敏感信息。
- 本地自用：文件权限 `600` + 仅登录用户可下载，风险可控。
- 上云：必须服务端加密（如 AES-256）+ HTTPS + 仅授权角色可见，并考虑留存最小化。

---

## 5. 接口契约（与 mock 对齐，保证前端零改动）

响应结构保持 `{ list, total }` 或对象，与现有 `src/mock/index.js` 完全一致，前端仅改 import 来源。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | `{username,password}` → `{token, user}` |
| POST | `/api/auth/logout` | 失效 token |
| GET  | `/api/auth/me` | 当前用户（含 role） |
| GET/POST/PUT/DELETE | `/api/stores[/:id]` | 门店 CRUD，列表支持 `keyword` |
| GET/POST/PUT/DELETE | `/api/rooms[/:id]` | 房源，支持 `storeId/status/keyword` |
| GET/POST/PUT/DELETE | `/api/tenants[/:id]` | 租户，含 `syncRoomStatus` 联动逻辑 |
| POST | `/api/tenants/:id/collect` | 房租收缴：生成 payment + 顺延 `rentDueDate` |
| POST | `/api/tenants/:id/due-date` | 内联改到期日 |
| GET/POST/DELETE | `/api/payments[/:id]` | 账单，支持 `month/storeId/keyword` 按 `paid_at`(前7位) 归月 |
| GET/POST/PUT/DELETE | `/api/reminders[/:id]` | 提醒，含 `unreadCount` |
| GET  | `/api/dashboard/summary` | 工作台统计（同 mock 返回字段） |
| GET/POST/PUT/DELETE | `/api/users[/:id]` | **阶段一即可做账号基础 CRUD** |
| POST | `/api/tenants/:id/attachments` | multipart 上传，替换现有 IndexedDB |

---

## 6. 权限模型（两阶段）

### 阶段一（现在，最小可用）
- 真实登录（bcrypt + JWT），种子一个 `admin` 账号，初始密码由首次启动随机生成（或 `ADMIN_INITIAL_PASSWORD` 指定），**首次登录后请立即改密**。
- `users` 表 + `role` 字段落地；`SystemUserView.vue` 实现账号 CRUD（新增 / 禁用 / 改角色）。
- **服务端所有写接口都要有效 token**（把后端从「公开」变成「需授权」）。
- **不强制 store 隔离**（单人 / 信任局域网环境，做了也是摆设）。

### 阶段二（上云多人，启用 RBAC）
- 角色：`超级管理员`（全量）/ `门店店长`（本店读写）/ `运营专员`（租户·房源）/ `财务`（账单只读 + 收款）。
- **门店维度数据隔离**：查询自动追加 `store_id` 过滤；越权返回 403。
- UI 按 `role` 隐藏/禁用按钮（菜单 + 操作列）。
- 可选：操作审计日志表。

> 关键：阶段一就把 `users` 表和 `role`/`store_id` 字段建好，阶段二只需补「强制隔离」逻辑，**不返工**。

---

## 7. 附件迁移（IndexedDB → 服务端）

- 现状：身份证/合同图片以 dataURL 存 `IndexedDB`，元数据（文件名）在 `tenant.attachments`。
- 后端化：`TenantListView` 改为 `multipart` 上传到 `/api/tenants/:id/attachments`，服务端落盘 `./uploads/{tenantId}/{field}.ext` 并返回 URL；`tenant.attachments` 改为存相对路径。
- 种子数据：阶段一内置示例图可留空，需重新上传；或保留若干占位。

---

## 8. 阶段一实施清单（落地步骤）

1. 初始化 `server/`：Express + better-sqlite3，启动自动建表 + 种子（admin 账号、2 门店、31 房源、3 租户）。
2. 实现 `auth`：bcrypt + JWT + 鉴权中间件。
3. 实现 `stores/rooms/tenants/payments/reminders/dashboard` 路由，把 `syncRoomStatus`、`markCollected` 等业务逻辑从 mock 平移到服务端。
4. 实现 `users` 基础 CRUD（账号管理）。
5. 实现附件上传接口。
6. 前端：`src/api/*.js` 包装 `request()`；全局替换 `@/mock` import；`auth.js` 改调 `/api/auth/login`；`SystemUserView` 接 `/api/users`。
7. 构建 `dist`，nginx 反代 `/api` → `:3000`；部署到 PVE LXC。

---

## 9. 决策点（何时升级到阶段二）

- 一旦要「**给别人用**」→ 必须启用 RBAC + 附件加密 + HTTPS，否则数据篡改/泄露风险高。
- 数据量 < 几万行、单店低频 → SQLite 足够；多店高并发写 → 换 PostgreSQL。

---

## 10. 风险与对策

| 风险 | 本地（阶段一） | 上云（阶段二） |
|---|---|---|
| PII（身份证/合同）泄露 | 文件权限 600 + 仅登录可见 | 服务端加密 + HTTPS + 最小可见范围 |
| SQLite 并发写入 | 单进程 OK，避免高并发写 | 换 Postgres |
| 数据丢失 | 定期 `cp admin.db` | 托管自动备份 |
| 外出访问 | VPN / 内网穿透 | 天然公网 |

---

### 待你确认
- [ ] 是否按「阶段一」现在动手（本地后端 + 登录 + 单管理员 + SQLite + PVE 部署）？
- [ ] 角色先定 4 种（admin/manager/operator/finance）还是更简化？
- [ ] 附件上云前是否先只在本地磁盘存（阶段一），阶段二再上对象存储？
