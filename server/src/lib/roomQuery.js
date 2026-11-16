// 企业微信群内「只读房态查询」：命令解析 / 数据快照 / 回答渲染。
// 设计约束：
//  1. 零依赖 —— 刻意不 import db.js / helpers.js，database 与 today 均可注入，便于离线单测；
//  2. 只读 —— 只认白名单命令，绝不解析「退房 / 收款 / 改到期日」等写操作，也不接大模型；
//  3. 最小披露 —— 输出的 SQL 不含手机号、身份证、附件；姓名 / 金额 / 表读数可分别开关；
//  4. 幂等友好 —— 不直接发消息，只返回要回复的文本，交给传输层决定怎么发。

export const STATUS_LABEL = {
  empty: '空房',
  rented: '在住',
  maintenance: '维修',
  cleaning: '待清扫'
}

const DUE_DAYS = 7
const MAX_LIST = 15
const CONTENT_LIMIT = 3600 // 企微单条消息上限留余量

const ALIASES = {
  overview: ['房态', '房态总览', '总览', '汇总', '全部', '房态查询', 'rooms'],
  empty: ['空房', '空置', '可租', '空房间', 'vacant'],
  cleaning: ['待清扫', '清扫', '保洁', 'cleaning'],
  due: ['到期', '逾期', '催租', '房租到期', 'due'],
  help: ['帮助', 'help', '?', '？', '命令', '用法', '菜单']
}

function list(v) {
  return String(v || '').split(',').map((s) => s.trim()).filter(Boolean)
}

function flag(v, def = true) {
  if (v === undefined || v === null || v === '') return def
  const s = String(v).toLowerCase()
  return s !== '0' && s !== 'false' && s !== 'off' && s !== 'no'
}

function num(v, def, min, max) {
  const n = Number.parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

// 配置全部来自环境变量；未配置 BotID/Secret 时 enabled=false，服务不会发起任何外网连接。
export function getBotConfig(env = process.env) {
  const botId = String(env.WECOM_BOT_ID || '').trim()
  const secret = String(env.WECOM_BOT_SECRET || '').trim()
  return {
    enabled: flag(env.WECOM_BOT_ENABLED, true) && Boolean(botId) && Boolean(secret),
    botId,
    secret,
    allowedChats: list(env.WECOM_BOT_ALLOWED_CHATS),
    allowedUsers: list(env.WECOM_BOT_ALLOWED_USERS),
    allowSingle: env.WECOM_BOT_ALLOW_SINGLE === '1',
    showName: flag(env.WECOM_BOT_SHOW_NAME, true),
    showRent: flag(env.WECOM_BOT_SHOW_RENT, true),
    showMeter: flag(env.WECOM_BOT_SHOW_METER, true),
    replyUnknown: flag(env.WECOM_BOT_REPLY_UNKNOWN, true),
    rateLimit: num(env.WECOM_BOT_RATE_LIMIT, 10, 1, 60),
    rateWindowMs: 60_000,
    testChat: String(env.WECOM_BOT_TEST_CHAT || '').trim(),
    // 仅本地联调用：指向模拟企微的 WebSocket 服务；生产留空走官方默认地址。
    wsUrl: String(env.WECOM_BOT_WS_URL || '').trim()
  }
}

// 群里 @ 机器人时，企微通常把 "@机器人名 " 一起放进 text.content；可能有多个 @。
export function normalizeText(raw = '') {
  return String(raw || '')
    .replace(/@[^\s@]+/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}

export function parseCommand(raw = '') {
  const text = normalizeText(raw)
  if (!text) return { kind: 'unknown', arg: '', text }
  const lower = text.toLowerCase()
  for (const [kind, words] of Object.entries(ALIASES)) {
    if (words.some((w) => lower === w.toLowerCase())) return { kind, arg: '', text }
  }
  // 房号：字母 / 数字 / 连字符，至少含一位数字，最长 12 位（604、A-203、B301…）
  if (/^(?=.*\d)[A-Za-z0-9][A-Za-z0-9-]{0,11}$/.test(text)) {
    return { kind: 'room', arg: text, text }
  }
  return { kind: 'unknown', arg: text, text }
}

// 白名单：默认只允许群聊；配置 chatid / userid 白名单后严格匹配。
// 回调里 userid 可能是密文（机器人创建者非超管），故 chatid 白名单更可靠。
export function isAllowed(frame, cfg = getBotConfig()) {
  const b = frame?.body || {}
  const chatType = b.chattype || (b.chatid ? 'group' : 'single')
  if (chatType !== 'group' && !cfg.allowSingle) return { ok: false, reason: '仅允许群聊查询' }
  const chatid = String(b.chatid || '')
  const userid = String(b.from?.userid || '')
  if (cfg.allowedChats.length && !cfg.allowedChats.includes(chatid)) {
    return { ok: false, reason: '会话不在白名单' }
  }
  if (cfg.allowedUsers.length && !cfg.allowedUsers.includes(userid)) {
    return { ok: false, reason: '成员不在白名单' }
  }
  return { ok: true, reason: '' }
}

function defaultToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

function addDays(dateStr, n) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const ROOM_SQL = `SELECT r.room_no, r.status, r.rent, r.floor, r.area,
       r.water_meter, r.electricity_meter, r.meter_date,
       s.name AS store_name,
       (SELECT t.name FROM tenants t WHERE t.room_id=r.id AND t.status='active' ORDER BY t.id DESC LIMIT 1) AS resident,
       (SELECT t.rent_due_date FROM tenants t WHERE t.room_id=r.id AND t.status='active' ORDER BY t.id DESC LIMIT 1) AS rent_due_date
FROM rooms r
LEFT JOIN stores s ON s.id = r.store_id
ORDER BY s.name, r.room_no`

// 一条 SQL 取全部房间，快照口径与工作台 / 每日汇总保持一致（7 天内到期、active 租户即在住人）。
export function collectRoomSnapshot(database, today = defaultToday()) {
  const rows = database.prepare(ROOM_SQL).all() || []
  const rooms = rows.map((r) => ({
    store: String(r.store_name || ''),
    no: String(r.room_no || ''),
    status: String(r.status || 'empty'),
    label: STATUS_LABEL[r.status] || String(r.status || '未知'),
    rent: Number(r.rent) || 0,
    floor: r.floor ?? '',
    area: r.area ?? '',
    resident: String(r.resident || ''),
    due: String(r.rent_due_date || '').slice(0, 10),
    water: r.water_meter ?? 0,
    electric: r.electricity_meter ?? 0,
    meterDate: String(r.meter_date || '')
  }))
  const counts = { empty: 0, rented: 0, cleaning: 0, maintenance: 0, other: 0 }
  for (const r of rooms) {
    if (Object.prototype.hasOwnProperty.call(counts, r.status)) counts[r.status] += 1
    else counts.other += 1
  }
  const limit = addDays(today, DUE_DAYS)
  const occupied = rooms.filter((r) => r.status === 'rented' && r.due)
  return {
    today,
    limit,
    dueDays: DUE_DAYS,
    total: rooms.length,
    counts,
    rooms,
    emptyRooms: rooms.filter((r) => r.status === 'empty'),
    cleaningRooms: rooms.filter((r) => r.status === 'cleaning'),
    overdue: occupied.filter((r) => r.due < today).sort((a, b) => a.due.localeCompare(b.due)),
    dueSoon: occupied
      .filter((r) => r.due >= today && r.due <= limit)
      .sort((a, b) => a.due.localeCompare(b.due))
  }
}

function place(r) {
  return [r.store, r.no].filter(Boolean).join(' ') || '-'
}

function money(n) {
  return `¥${Math.round((Number(n) || 0) * 100) / 100}`
}

function truncate(content) {
  if (Buffer.byteLength(content, 'utf8') <= CONTENT_LIMIT) return content
  const out = []
  let size = 0
  for (const line of content.split('\n')) {
    const bytes = Buffer.byteLength(`${line}\n`, 'utf8')
    if (size + bytes > CONTENT_LIMIT) break
    out.push(line)
    size += bytes
  }
  return `${out.join('\n')}\n> …内容已截断`
}

// 每条房间行只暴露：位置、姓名（可关）、到期日、月租（可关）。
function roomLine(r, cfg, withDue = false) {
  const parts = [place(r)]
  if (cfg.showName && r.resident) parts.push(r.resident)
  if (withDue && r.due) parts.push(`\`${r.due.slice(5)}\` 到期`)
  if (cfg.showRent) parts.push(money(r.rent))
  return `> ${parts.join(' · ')}`
}

function appendSection(lines, title, rows, cfg, withDue = false, emptyText = '无') {
  lines.push(`**${title}：${rows.length} 间**`)
  if (!rows.length) lines.push(`> ${emptyText}`)
  else {
    rows.slice(0, MAX_LIST).forEach((r) => lines.push(roomLine(r, cfg, withDue)))
    if (rows.length > MAX_LIST) lines.push(`> …另有 ${rows.length - MAX_LIST} 间`)
  }
  lines.push('')
}

export function buildHelp() {
  return [
    '**公寓房态助手 · 可用命令**',
    '> `房态` 总览（在住 / 空房 / 待清扫 / 到期）',
    '> `空房` 列出可出租房间',
    '> `待清扫` 列出待清扫房间',
    '> `到期` 7 天内到期与已逾期',
    '> `604` 直接查某个房间（支持 A-203 这类房号）',
    '> `帮助` 显示本说明',
    '> 仅支持查询，不提供任何修改操作'
  ].join('\n')
}

function buildRoomDetail(cmd, snap, cfg) {
  const key = cmd.arg.toLowerCase()
  let hits = snap.rooms.filter((r) => r.no.toLowerCase() === key)
  if (!hits.length) hits = snap.rooms.filter((r) => r.no.toLowerCase().includes(key))
  if (!hits.length) {
    return `**未找到房号 ${cmd.arg}**\n> 发 \`房态\` 查看全部，或发 \`帮助\` 看命令清单`
  }
  const lines = []
  for (const r of hits.slice(0, 5)) {
    lines.push(`**${place(r)} · ${r.label}**`)
    const bits = []
    bits.push(`状态 ${r.label}`)
    if (cfg.showName) bits.push(`在住 ${r.resident || '无'}`)
    if (cfg.showRent) bits.push(`月租 ${money(r.rent)}`)
    lines.push(`> ${bits.join(' · ')}`)
    lines.push(`> 房租到期 ${r.due || '未设置'}`)
    if (cfg.showMeter) {
      lines.push(`> 水表 ${r.water} / 电表 ${r.electric} · 上次抄表 ${r.meterDate || '未记录'}`)
    }
    lines.push('')
  }
  if (hits.length > 5) lines.push(`> …另有 ${hits.length - 5} 间同名房号`)
  return lines.join('\n').trim()
}

export function buildAnswer(cmd, snap, cfg = getBotConfig()) {
  switch (cmd.kind) {
    case 'help':
      return buildHelp()
    case 'overview': {
      const c = snap.counts
      const lines = [
        `**房态总览** · ${snap.today}`,
        `> 共 ${snap.total} 间 · 在住 ${c.rented} · 空房 ${c.empty} · 待清扫 ${c.cleaning} · 维修 ${c.maintenance}`,
        ''
      ]
      appendSection(lines, '空房', snap.emptyRooms, cfg, false, '暂无空房')
      appendSection(lines, '待清扫', snap.cleaningRooms, cfg, false, '无')
      appendSection(lines, `房租 ${snap.dueDays} 天内到期`, snap.dueSoon, cfg, true, '无')
      appendSection(lines, '已逾期', snap.overdue, cfg, true, '无')
      return truncate(lines.join('\n').trim())
    }
    case 'empty': {
      const lines = [`**空房：${snap.emptyRooms.length} 间** · ${snap.today}`, '']
      appendSection(lines, '可出租', snap.emptyRooms, cfg, false, '暂无空房')
      return truncate(lines.join('\n').trim())
    }
    case 'cleaning': {
      const lines = [`**待清扫：${snap.cleaningRooms.length} 间** · ${snap.today}`, '']
      appendSection(lines, '待清扫房间', snap.cleaningRooms, cfg, false, '无需清扫的房间')
      return truncate(lines.join('\n').trim())
    }
    case 'due': {
      const lines = [`**房租到期** · ${snap.today}`, '']
      appendSection(lines, '已逾期', snap.overdue, cfg, true, '无')
      appendSection(lines, `${snap.dueDays} 天内到期`, snap.dueSoon, cfg, true, '无')
      return truncate(lines.join('\n').trim())
    }
    case 'room':
      return truncate(buildRoomDetail(cmd, snap, cfg))
    case 'unknown':
      return cfg.replyUnknown
        ? `**未识别的命令**\n> 可用：\`房态\` · \`空房\` · \`待清扫\` · \`到期\` · \`房号\` · \`帮助\``
        : ''
    default:
      return ''
  }
}

// 组装入口：传输层只需调用它拿 reply，其余（白名单、去重、限流、审计）在 wecomBot.js 里。
export function handleQuery({ text, database, today = defaultToday(), cfg = getBotConfig() } = {}) {
  const cmd = parseCommand(text)
  const snap = collectRoomSnapshot(database, today)
  return { command: cmd, snapshot: snap, reply: buildAnswer(cmd, snap, cfg) }
}

// msgid 排重：企微明确说明回调可能重复推送。容量超限时淘汰最早的一半（Set 保序）。
export function createDedup(maxSize = 2000) {
  const seen = new Set()
  return {
    check(id) {
      if (!id) return true
      if (seen.has(id)) return false
      seen.add(id)
      if (seen.size > maxSize) {
        let n = Math.floor(maxSize / 2)
        for (const k of seen) {
          seen.delete(k)
          n -= 1
          if (n <= 0) break
        }
      }
      return true
    },
    size: () => seen.size,
    clear: () => seen.clear()
  }
}

// 按会话滑动窗口限流，防止群里刷屏打爆数据库。
export function createLimiter(windowMs = 60_000, limit = 10) {
  const hits = new Map()
  let win = windowMs
  let lim = limit
  return {
    setLimit(l, w = win) {
      lim = Math.max(1, l)
      win = w
    },
    check(key, now = Date.now()) {
      const fresh = (hits.get(key) || []).filter((t) => now - t < win)
      if (fresh.length >= lim) {
        hits.set(key, fresh)
        return false
      }
      fresh.push(now)
      hits.set(key, fresh)
      return true
    },
    clear: () => hits.clear()
  }
}
