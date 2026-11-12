// 企业微信群机器人推送（L1：纯出站通知）。
// 设计约束：
//  1. 零新增依赖 —— 用 Node 20 内置 fetch，服务端主动出站即可，不需要公网入口/域名备案。
//  2. 绝不阻塞业务 —— 事件推送 fire-and-forget，网络失败只记日志，不抛到路由。
//  3. 幂等 —— push_logs.dedup_key 唯一，服务重启、定时器重复触发都不会重复发消息。
//  4. 最小披露 —— 只推门店/房号/姓名/金额/日期，绝不推手机号、身份证、附件。
import db from '../db.js'
import { todayStr, nowLocal, nowHms } from './helpers.js'

const WEBHOOK_HOST = 'qyapi.weixin.qq.com'
const WEBHOOK_PATH = '/cgi-bin/webhook/send'
const CONTENT_LIMIT = 3600       // 企微 markdown 上限 4096 字节，留出余量
const DUE_DAYS = 7               // 与首页「7 天内到期」口径一致
const MAX_LIST = 15              // 单条消息最多列出的房间数
const KEEP_DAYS = 180            // 推送记录保留天数

export function getConfig() {
  const raw = Number.parseInt(process.env.WECOM_PUSH_HOUR ?? '9', 10)
  return {
    url: (process.env.WECOM_WEBHOOK_URL || '').trim(),
    daily: process.env.WECOM_PUSH_DAILY !== '0',
    events: process.env.WECOM_PUSH_EVENTS !== '0',
    hour: Number.isFinite(raw) ? Math.min(23, Math.max(0, raw)) : 9
  }
}

// 只接受企微官方 Webhook 地址：避免误填、也避免配置值被改成任意 URL 造成 SSRF。
export function isValidWebhook(url) {
  if (!url) return false
  try {
    const u = new URL(url)
    const key = u.searchParams.get('key') || ''
    return u.protocol === 'https:'
      && u.hostname === WEBHOOK_HOST
      && u.pathname === WEBHOOK_PATH
      && /^[A-Za-z0-9-]{16,64}$/.test(key)
  } catch {
    return false
  }
}

// 纯 UTC 日期加减（YYYY-MM-DD 字符串），避免本地时区与 setDate 溢出问题。
export function addDays(dateStr, n) {
  const d = new Date(`${String(dateStr).slice(0, 10)}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return ''
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function money(n) {
  return `¥${Math.round((Number(n) || 0) * 100) / 100}`
}

// 兼容两种来源：SQL 行是蛇形（store_name/room_no），业务事件 payload 是驼峰。
function placeOf(p) {
  const store = p.storeName || p.store_name || ''
  const room = p.roomNo || p.room_no || ''
  return [store, room].filter(Boolean).join(' ') || '-'
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

// 从库里取每日汇总所需的全部数据（database 可注入，便于离线单测）。
export function collectDailySnapshot(database = db, today = todayStr()) {
  const tenants = database.prepare(
    `SELECT t.name, t.rent_due_date, r.room_no, r.rent, s.name AS store_name
     FROM tenants t
     LEFT JOIN rooms r ON r.id = t.room_id
     LEFT JOIN stores s ON s.id = t.store_id
     WHERE t.status='active' AND t.rent_due_date IS NOT NULL AND t.rent_due_date != ''
     ORDER BY t.rent_due_date`
  ).all()
  const limit = addDays(today, DUE_DAYS)
  const overdue = tenants.filter((x) => x.rent_due_date < today)
  const dueSoon = tenants.filter((x) => x.rent_due_date >= today && x.rent_due_date <= limit)
  const cleaning = database.prepare(
    `SELECT r.room_no, s.name AS store_name FROM rooms r
     LEFT JOIN stores s ON s.id = r.store_id
     WHERE r.status='cleaning' ORDER BY r.room_no`
  ).all()
  const unread = database.prepare("SELECT COUNT(*) AS c FROM reminders WHERE status='unread'").get()?.c || 0
  return { today, dueDays: DUE_DAYS, overdue, dueSoon, cleaning, unread }
}

function tenantLine(x) {
  const md = String(x.rent_due_date || '').slice(5)
  return `> ${placeOf(x)} · ${x.name || '-'} · \`${md}\` 到期 · ${money(x.rent)}`
}

function appendSection(lines, title, rows, emptyText) {
  lines.push(`**${title}：${rows.length} 间**`)
  if (!rows.length) {
    lines.push(`> ${emptyText}`)
  } else {
    rows.slice(0, MAX_LIST).forEach((x) => lines.push(tenantLine(x)))
    if (rows.length > MAX_LIST) lines.push(`> …另有 ${rows.length - MAX_LIST} 间`)
  }
  lines.push('')
}

export function buildDailyReport(snap) {
  const lines = [`## 公寓待办 · ${snap.today}`, '']
  appendSection(lines, `房租 ${snap.dueDays} 天内到期`, snap.dueSoon || [], '无')
  appendSection(lines, '已逾期', snap.overdue || [], '无')
  lines.push(`**待清扫：${(snap.cleaning || []).length} 间**`)
  const cleaningNames = (snap.cleaning || []).slice(0, MAX_LIST).map((x) => placeOf(x))
  lines.push(cleaningNames.length ? `> ${cleaningNames.join('、')}` : '> 无')
  lines.push('')
  lines.push(`**未读提醒：${snap.unread || 0} 条**`)
  return truncate(lines.join('\n'))
}

// 事件消息模板。所有字段均由调用方显式传入，不直接序列化请求体，避免把敏感字段带出去。
export function buildEventContent(type, p = {}) {
  const place = placeOf(p)
  switch (type) {
    case 'checkin':
      return `**新入住**\n> ${place} · ${p.tenantName || '-'}\n> 入住 ${p.checkInDate || '-'} · 月租 ${money(p.rent)}`
    case 'collect':
      return [
        `**收到房租** · ${money(p.amount)}`,
        `> ${place} · ${p.tenantName || '-'} · 单号 ${p.paymentNo || '-'}`,
        `> 房租有效期 ${p.oldDue || '-'} → **${p.newDue || '-'}**`,
        (p.waterMode || p.electricityMode)
          ? `> 水 ${p.waterMode || '不计'} ${money(p.waterFee)} / 电 ${p.electricityMode || '不计'} ${money(p.electricityFee)}`
          : ''
      ].filter(Boolean).join('\n')
    case 'payment_create':
      return `**新增收款记录** · ${money(p.amount)}\n> ${place} · ${p.tenantName || '-'} · 单号 ${p.paymentNo || '-'}\n> 收款时间 ${p.paidAt || '-'}`
    case 'payment_delete':
      return `**删除收款记录**\n> 单号 ${p.paymentNo || '-'} · ${place} · ${p.tenantName || '-'}\n> 金额 ${money(p.amount)} · 原收款时间 ${p.paidAt || '-'}\n> <font color="warning">注意：水电表读数不会回退</font>`
    case 'checkout':
      return `**办理退房**\n> ${place} · ${p.tenantName || '-'}\n> 退房时间 ${p.checkOutDate || '-'}\n> 房间已置为「待清扫」`
    case 'due_date':
      return `**修改房租到期日**\n> ${place} · ${p.tenantName || '-'}\n> ${p.before || '-'} → **${p.after || '-'}**`
    case 'reminder':
      return `**催租提醒**\n> ${place} · ${p.tenantName || '-'}\n> ${p.content || ''}`
    case 'test':
      return `**公寓管理系统 · 推送测试**\n> ${p.message || '若收到此消息，说明企业微信 Webhook 配置正确。'}\n> 时间 ${nowLocal()}`
    default:
      return ''
  }
}

async function deliver(content) {
  const { url } = getConfig()
  if (!isValidWebhook(url)) return { ok: false, error: '未配置或 Webhook 地址不合法' }
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'markdown', markdown: { content } }),
      signal: AbortSignal.timeout(8000)
    })
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok || body.errcode !== 0) {
      return { ok: false, error: `HTTP ${resp.status} ${body.errmsg || ''}`.trim() }
    }
    return { ok: true, error: '' }
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) }
  }
}

// 统一发送入口。dryRun 只组装内容、不写库不联网；CLI 与单测都走这里。
export async function pushMessage({
  kind, dedupKey, title = '', content, dryRun = false, database = db, send = deliver
}) {
  if (!content) return { ok: false, skipped: true, error: '空内容' }
  if (dryRun) return { ok: true, dryRun: true, content }

  const cfg = getConfig()
  if (kind === 'daily' && !cfg.daily) return { ok: false, skipped: true, error: '每日汇总已关闭' }
  if (kind === 'event' && !cfg.events) return { ok: false, skipped: true, error: '事件推送已关闭' }
  if (!isValidWebhook(cfg.url)) return { ok: false, skipped: true, error: '未配置 Webhook' }

  // 抢占去重键：服务重启 / 定时器重复触发时，同一天或同一业务单号只发一次。
  const info = database.prepare(
    'INSERT OR IGNORE INTO push_logs (kind, dedup_key, title, ok, error, created_at) VALUES (?,?,?,?,?,?)'
  ).run(kind, dedupKey, title, 0, '', nowLocal())
  if (!info || !info.changes) return { ok: false, skipped: true, error: '重复推送已跳过' }
  const id = Number(info.lastInsertRowid)

  const result = await send(content)
  if (result.ok) {
    database.prepare('UPDATE push_logs SET ok=?, error=? WHERE id=?').run(1, '', id)
    if (kind === 'daily') {
      const cutoff = nowLocal(new Date(Date.now() - KEEP_DAYS * 86400000))
      database.prepare('DELETE FROM push_logs WHERE created_at < ?').run(cutoff)
    }
  } else {
    // 失败释放占位，允许下一次调度重试；错误另记一行，方便排查但不阻断业务。
    database.prepare('DELETE FROM push_logs WHERE id=?').run(id)
    database.prepare(
      'INSERT OR IGNORE INTO push_logs (kind, dedup_key, title, ok, error, created_at) VALUES (?,?,?,?,?,?)'
    ).run('error', `${dedupKey}:${nowLocal()}:${Math.random().toString(36).slice(2, 8)}`, title, 0, result.error, nowLocal())
    // eslint-disable-next-line no-console
    console.warn('[wecom] 推送失败：', result.error)
  }
  return result
}

export async function pushDaily({ dryRun = false, today = todayStr(), database = db, send = deliver } = {}) {
  const snap = collectDailySnapshot(database, today)
  const content = buildDailyReport(snap)
  return pushMessage({
    kind: 'daily', dedupKey: `daily:${today}`, title: `每日待办 ${today}`,
    content, dryRun, database, send
  })
}

// fire-and-forget：路由里直接调用、不要 await，网络延迟不影响接口响应。
export function pushEvent(type, payload = {}, dedupKey = '', database = db) {
  const content = buildEventContent(type, payload)
  if (!content) return
  const key = `event:${type}:${dedupKey || nowLocal()}`
  Promise.resolve()
    .then(() => pushMessage({ kind: 'event', dedupKey: key, title: type, content, database }))
    // eslint-disable-next-line no-console
    .catch((e) => console.warn('[wecom] 事件推送异常：', e.message))
}

// 每分钟检查一次；到点后由 dedup_key 保证一天只发一次。
// 服务在设定时间之后才启动也会补推当天（catch-up），符合「每天至少一条」的预期。
export function startPushScheduler() {
  const tick = () => {
    const cfg = getConfig()
    if (!cfg.daily || !isValidWebhook(cfg.url)) return
    if (Number(nowHms().slice(0, 2)) < cfg.hour) return
    pushDaily().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[wecom] 每日汇总异常：', e.message)
    })
  }
  const timer = setInterval(tick, 60_000)
  timer.unref?.()
  const first = setTimeout(tick, 10_000)
  first.unref?.()
  return timer
}
