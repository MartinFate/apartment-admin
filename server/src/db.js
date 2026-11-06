// 数据库层：better-sqlite3 初始化、建表、种子数据。
// 阶段一使用本地 SQLite 文件（data/apartment.db），零运维、单文件备份。
// 阶段二可平滑替换为 PostgreSQL（通过 repository 抽象，此处 SQL 集中管理）。

import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(ROOT, process.env.DATA_DIR)
  : path.join(ROOT, 'data')
fs.mkdirSync(DATA_DIR, { recursive: true })

const db = new Database(path.join(DATA_DIR, 'apartment.db'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ---------- 建表 ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',   -- admin / manager / operator / finance（阶段二启用隔离）
  store_id INTEGER DEFAULT NULL,        -- 阶段二：门店店长绑定门店
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT DEFAULT '',
  manager TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  water_price NUMERIC DEFAULT 0,         -- 水费单价（元/吨或元/度）
  electricity_price NUMERIC DEFAULT 0,   -- 电费单价（元/度）
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL,
  room_no TEXT NOT NULL,
  floor INTEGER DEFAULT 0,
  area NUMERIC DEFAULT 0,
  type TEXT DEFAULT '',
  rent NUMERIC DEFAULT 0,
  deposit NUMERIC DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'empty',  -- empty / rented / maintenance / cleaning(待清扫)
  water_meter NUMERIC DEFAULT 0,         -- 水表当前读数
  electricity_meter NUMERIC DEFAULT 0,   -- 电表当前读数
  meter_date TEXT DEFAULT '',            -- 上次抄表日期
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rooms_store ON rooms(store_id);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  phone TEXT DEFAULT '',
  id_card TEXT DEFAULT '',
  store_id INTEGER NOT NULL,
  room_id INTEGER DEFAULT NULL,
  check_in_date TEXT DEFAULT '',
  contract_end TEXT DEFAULT '',
  rent_due_date TEXT DEFAULT '',         -- 房租到期 / 下次收缴日（按月付）
  status TEXT NOT NULL DEFAULT 'active', -- active / left
  attachments TEXT DEFAULT '{}',         -- JSON: {idCardFront, idCardBack, contracts:[{name,url}]}
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenants_store ON tenants(store_id);
CREATE INDEX IF NOT EXISTS idx_tenants_room ON tenants(room_id);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  no TEXT UNIQUE NOT NULL,
  tenant_id INTEGER DEFAULT NULL,
  tenant_name TEXT DEFAULT '',
  store_id INTEGER DEFAULT NULL,
  room_no TEXT DEFAULT '',
  amount NUMERIC DEFAULT 0,
  paid_at TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  -- 以下为水电费明细（房租部分记在 rent_amount，amount = 房租 + 水费 + 电费）
  rent_amount NUMERIC DEFAULT 0,
  utility_mode TEXT DEFAULT '',            -- '' 无水电费 / 'meter' 按抄表 / 'flat' 包月
  water_reading NUMERIC DEFAULT 0,         -- 本次水表读数
  water_usage NUMERIC DEFAULT 0,           -- 本期用水量
  water_price NUMERIC DEFAULT 0,           -- 本次水单价
  water_fee NUMERIC DEFAULT 0,             -- 本期水费
  electricity_reading NUMERIC DEFAULT 0,   -- 本次电表读数
  electricity_usage NUMERIC DEFAULT 0,     -- 本期用电量
  electricity_price NUMERIC DEFAULT 0,     -- 本次电单价
  electricity_fee NUMERIC DEFAULT 0,       -- 本期电费
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payments_store ON payments(store_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid ON payments(paid_at);

CREATE TABLE IF NOT EXISTS reminders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER DEFAULT NULL,
  tenant_name TEXT DEFAULT '',
  store_name TEXT DEFAULT '',
  room_no TEXT DEFAULT '',
  type TEXT DEFAULT '',
  content TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'unread',  -- unread / read
  created_at TEXT NOT NULL
);

-- 操作日志审计：只追加，不提供业务侧删除接口。
-- target_label 存对象名快照，关联记录被删后仍可追溯；detail 为脱敏后的 JSON。
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,                        -- 北京时间 YYYY-MM-DD HH:MM:SS
  actor_id INTEGER DEFAULT NULL,
  actor_name TEXT DEFAULT '',
  actor_role TEXT DEFAULT '',
  action TEXT NOT NULL,                    -- login / create / update / delete / collect ...
  module TEXT NOT NULL DEFAULT 'other',
  target_id TEXT DEFAULT '',
  target_label TEXT DEFAULT '',
  method TEXT DEFAULT '',
  path TEXT DEFAULT '',
  ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'success', -- success / fail
  status_code INTEGER DEFAULT 200,
  detail TEXT DEFAULT '',
  request_id TEXT DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit_logs(ts);
CREATE INDEX IF NOT EXISTS idx_audit_module_target ON audit_logs(module, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action);
`)

// ---------- 阶段补充字段迁移（建表后执行，幂等）----------
;(() => {
  const addCol = (table, col, def) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)
    if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`)
  }

  addCol('tenants', 'deposit', 'NUMERIC DEFAULT 0')
  addCol('tenants', 'rent', 'NUMERIC DEFAULT 0')
  addCol('tenants', 'check_out_date', "TEXT DEFAULT ''")

  // 水电表：房间记当前读数，门店记水电单价
  addCol('rooms', 'water_meter', 'NUMERIC DEFAULT 0')
  addCol('rooms', 'electricity_meter', 'NUMERIC DEFAULT 0')
  addCol('rooms', 'meter_date', "TEXT DEFAULT ''")
  addCol('stores', 'water_price', 'NUMERIC DEFAULT 0')
  addCol('stores', 'electricity_price', 'NUMERIC DEFAULT 0')

  // 收款记录的水电费明细
  addCol('payments', 'rent_amount', 'NUMERIC DEFAULT 0')
  addCol('payments', 'utility_mode', "TEXT DEFAULT ''")
  // 水/电各自独立的计费方式：'' 不计 / 'meter' 按抄表 / 'flat' 包月（可水包月、电抄表）
  addCol('payments', 'water_mode', "TEXT DEFAULT ''")
  addCol('payments', 'electricity_mode', "TEXT DEFAULT ''")
  // 房租有效期：收款前后的到期日（用于账单展示房租到期日）
  addCol('payments', 'rent_old_due', "TEXT DEFAULT ''")
  addCol('payments', 'rent_new_due', "TEXT DEFAULT ''")
  addCol('payments', 'water_reading', 'NUMERIC DEFAULT 0')
  addCol('payments', 'water_usage', 'NUMERIC DEFAULT 0')
  addCol('payments', 'water_price', 'NUMERIC DEFAULT 0')
  addCol('payments', 'water_fee', 'NUMERIC DEFAULT 0')
  addCol('payments', 'electricity_reading', 'NUMERIC DEFAULT 0')
  addCol('payments', 'electricity_usage', 'NUMERIC DEFAULT 0')
  addCol('payments', 'electricity_price', 'NUMERIC DEFAULT 0')
  addCol('payments', 'electricity_fee', 'NUMERIC DEFAULT 0')
})()

// ---------- 初始管理员口令 ----------
// 仓库中不含任何默认口令。优先级：ADMIN_INITIAL_PASSWORD 环境变量 > 随机生成。
// 随机口令写入 DATA_DIR 下的文件（权限 600），仅供本机管理员首次登录使用。
function resolveInitialAdminPassword() {
  const configured = (process.env.ADMIN_INITIAL_PASSWORD || '').trim()
  if (configured) return { password: configured, generated: false }

  const password = randomBytes(12).toString('base64url')
  const file = path.join(DATA_DIR, 'INITIAL_ADMIN_PASSWORD.txt')
  fs.writeFileSync(file, [
    '公寓管理系统 · 初始管理员凭据',
    '账号：admin',
    `密码：${password}`,
    '',
    '请登录后立即在「系统设置 → 修改我的密码」改密，然后删除本文件。',
    ''
  ].join('\n'), { mode: 0o600 })
  try { fs.chmodSync(file, 0o600) } catch { /* Windows 不支持 POSIX 权限，忽略 */ }
  return { password, generated: true }
}

// ---------- 种子数据 ----------
// 与前端原 mock 锚点一致（TODAY = 2026-10-22）。真实系统运行后，
// 仪表盘统计以「服务器当前日期」为准，新录入租户使用真实日期。
function seed() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c
  if (userCount > 0) return

  // 种子数据时间戳同样按北京时间（与业务写入口径一致；此处不引 helpers 以免循环依赖）
  const p = (n) => String(n).padStart(2, '0')
  const sh = new Date(Date.now() + 8 * 3600 * 1000)
  const now = `${sh.getUTCFullYear()}-${p(sh.getUTCMonth() + 1)}-${p(sh.getUTCDate())} ${p(sh.getUTCHours())}:${p(sh.getUTCMinutes())}:${p(sh.getUTCSeconds())}`
  const { password: adminPassword, generated } = resolveInitialAdminPassword()
  const hash = bcrypt.hashSync(adminPassword, 10)

  const insertUser = db.prepare(
    'INSERT INTO users (username, password_hash, name, role, status, created_at) VALUES (?,?,?,?,?,?)'
  )
  insertUser.run('admin', hash, '超级管理员', 'admin', 'active', now)

  const insertStore = db.prepare(
    'INSERT INTO stores (code, name, address, manager, phone, status, created_at) VALUES (?,?,?,?,?,?,?)'
  )
  const sA = insertStore.run('000001', '阳光公寓（朝阳店）', '北京市朝阳区建国路 18 号', '张伟', '13800000001', 'active', now)
  const sB = insertStore.run('000002', '港湾公寓（海淀店）', '北京市海淀区中关村南大街 5 号', '李娜', '13800000002', 'active', now)
  const storeAId = sA.lastInsertRowid
  const storeBId = sB.lastInsertRowid

  const insertRoom = db.prepare(
    'INSERT INTO rooms (store_id, room_no, floor, area, type, rent, deposit, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
  )
  // 港湾公寓：3 间
  insertRoom.run(storeBId, 'B-301', 3, 75, '三室一厅', 6800, 6800, 'rented', now)
  insertRoom.run(storeBId, 'B-302', 3, 55, '两室一厅', 5600, 5600, 'maintenance', now)
  insertRoom.run(storeBId, 'B-401', 4, 45, '一室一厅', 4500, 4500, 'empty', now)
  // 阳光公寓：7 层 × 4 间 = 28 间，A-101 已租
  for (let floor = 1; floor <= 7; floor++) {
    for (let no = 1; no <= 4; no++) {
      const roomNo = `A-${floor}${String(no).padStart(2, '0')}`
      insertRoom.run(storeAId, roomNo, floor, 45, '一室一厅', 3800, 3800, 'empty', now)
    }
  }
  const a101 = db.prepare("SELECT id FROM rooms WHERE store_id=? AND room_no='A-101'").get(storeAId)
  const b301 = db.prepare("SELECT id FROM rooms WHERE store_id=? AND room_no='B-301'").get(storeBId)

  const insertTenant = db.prepare(
    `INSERT INTO tenants (name, phone, id_card, store_id, room_id, check_in_date, contract_end, rent_due_date, status, attachments, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  )
  insertTenant.run('王芳', '13900000001', '1101011990********', storeAId, a101.id, '2026-01-05', '2026-12-31', '2026-11-05', 'active', '{}', now)
  insertTenant.run('刘强', '13900000002', '1101011988********', storeBId, b301.id, '2026-03-12', '2026-11-30', '2026-11-12', 'active', '{}', now)
  insertTenant.run('陈静', '13900000003', '1101011992********', storeAId, null, '2025-09-01', '2026-08-31', null, 'left', '{}', now)

  // payments / reminders 初始为空
  // eslint-disable-next-line no-console
  console.log(generated
    ? `[seed] 已初始化演示数据；初始管理员密码已写入 ${path.join(DATA_DIR, 'INITIAL_ADMIN_PASSWORD.txt')}（权限 600），请登录后立即改密并删除该文件`
    : '[seed] 已初始化演示数据；初始管理员密码来自 ADMIN_INITIAL_PASSWORD，请登录后立即改密')
}

seed()

export default db
