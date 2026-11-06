// 业务辅助函数：房态联动、门店编号、收款单号、日期处理。
import db from '../db.js'

// 房间状态随在住租户联动：有 active 租户占用 → rented；否则曾 rented 退回 empty（维修房保留）
export function syncRoomStatus(roomId) {
  if (!roomId) return
  const room = db.prepare('SELECT id, status FROM rooms WHERE id=?').get(roomId)
  if (!room) return
  const occupied = db
    .prepare("SELECT 1 FROM tenants WHERE status='active' AND room_id=? LIMIT 1")
    .get(roomId)
  if (occupied) {
    db.prepare("UPDATE rooms SET status='rented' WHERE id=?").run(roomId)
  } else if (room.status === 'rented') {
    db.prepare("UPDATE rooms SET status='empty' WHERE id=?").run(roomId)
  }
}

// 生成下一个门店 6 位编号
export function nextStoreCode() {
  const row = db.prepare('SELECT code FROM stores').all()
  let max = 0
  for (const r of row) {
    const n = parseInt(r.code || '0', 10)
    if (n > max) max = n
  }
  return String(max + 1).padStart(6, '0')
}

// 生成收款单号 SF + 6 位（按当日自增）
export function nextPaymentNo() {
  const row = db.prepare("SELECT no FROM payments WHERE no LIKE 'SF%' ORDER BY id DESC LIMIT 1").get()
  let seq = 0
  if (row && row.no) seq = parseInt(row.no.slice(2), 10) || 0
  return `SF${String(seq + 1).padStart(6, '0')}`
}

// 房租到期顺延：base = max(本期到期日, 今天) + 1 个自然月。
// 纯字符串计算：避免 setMonth() 月末溢出（1/31 → 3/3）与时区漂移。
function addMonths(dateStr, months = 1) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || ''))
  if (!m) return ''
  const day = Number(m[3])
  const total = Number(m[1]) * 12 + Number(m[2]) - 1 + months
  const y = Math.floor(total / 12)
  const mo = (total % 12) + 1
  const lastDay = new Date(y, mo, 0).getDate()
  const p = (n) => String(n).padStart(2, '0')
  return `${y}-${p(mo)}-${p(Math.min(day, lastDay))}`
}

export function nextDueDate(oldDue, today = todayStr()) {
  const t = String(today).slice(0, 10)
  const o = oldDue ? String(oldDue).slice(0, 10) : ''
  const base = o && o >= t ? o : t
  return addMonths(base, 1)
}

// 上海时间（UTC+8）各分量。中国不实行夏令时，偏移恒定，故可直接 +8h 取 UTC 分量，
// 与服务器所在时区无关，保证「今天 / 当前时间」始终按北京时间呈现。
function shanghaiParts(d = new Date()) {
  const sh = new Date(d.getTime() + 8 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return {
    y: sh.getUTCFullYear(),
    m: p(sh.getUTCMonth() + 1),
    d: p(sh.getUTCDate()),
    hh: p(sh.getUTCHours()),
    mm: p(sh.getUTCMinutes()),
    ss: p(sh.getUTCSeconds())
  }
}

// 今天（上海时区，YYYY-MM-DD），用于仪表盘统计、收款默认日期
export function todayStr() {
  const { y, m, d } = shanghaiParts()
  return `${y}-${m}-${d}`
}

// 当前时间（上海时区，HH:MM:SS）
export function nowHms() {
  const { hh, mm, ss } = shanghaiParts()
  return `${hh}:${mm}:${ss}`
}

// 当前完整时间（上海时区，YYYY-MM-DD HH:MM:SS）。可传入 Date 计算相对时刻。
export function nowLocal(at = new Date()) {
  const { y, m, d, hh, mm, ss } = shanghaiParts(at)
  return `${y}-${m}-${d} ${hh}:${mm}:${ss}`
}

// 蛇形字段名 → 驼峰（对齐前端约定与后端请求契约：store_id→storeId, room_no→roomNo…）
function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())
}

// 行对象 → 前端友好的普通对象：
// 1) 蛇形键转驼峰；2) attachments(JSON 字符串) 解析为对象
export function parseRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row
  const out = {}
  for (const [k, v] of Object.entries(row)) out[toCamel(k)] = v
  if (out.attachments && typeof out.attachments === 'string') {
    try {
      out.attachments = JSON.parse(out.attachments)
    } catch {
      out.attachments = {}
    }
  }
  return out
}
