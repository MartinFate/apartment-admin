// 企微推送离线单测：无需 better-sqlite3、无需外网、不发送任何真实消息。
// 用 Node 模块钩子把 db.js 换成内存桩，直接加载真实 wecom.js 验证组装与发送链路。
// 运行：node server/test/wecom.unit.test.mjs
import { registerHooks } from 'node:module'

const STUB = `
const state = (globalThis.__wecomState ||= { rows: [], cleaning: [], unread: 0, claimChanges: 1, runs: [] })
export default {
  prepare: (sql) => ({
    run: (...args) => {
      state.runs.push({ sql, args })
      if (sql.startsWith('INSERT OR IGNORE INTO push_logs') && args[0] !== 'error') {
        return { changes: state.claimChanges, lastInsertRowid: 7 }
      }
      return { changes: 1, lastInsertRowid: 7 }
    },
    get: () => ({ c: state.unread }),
    all: () => sql.includes('FROM tenants t') ? state.rows : state.cleaning
  })
}
`
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('db.js')) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUB), shortCircuit: true }
    }
    return next(spec, ctx)
  }
})

const w = await import(new URL('../src/lib/wecom.js', import.meta.url).href)
const S = globalThis.__wecomState

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('PASS', name) }
  else { fail += 1; console.log('FAIL', name, extra) }
}

const GOOD_URL = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=12345678-abcd-1234-abcd-123456789012'
const tenant = (name, due, extra = {}) => ({
  name, rent_due_date: due, room_no: '201', rent: 1000, store_name: '阳光公寓', ...extra
})

// ---------- 配置解析 ----------
const savedEnv = { ...process.env }
function resetEnv() {
  for (const k of ['WECOM_WEBHOOK_URL', 'WECOM_PUSH_DAILY', 'WECOM_PUSH_EVENTS', 'WECOM_PUSH_HOUR']) {
    delete process.env[k]
  }
}
resetEnv()
let c = w.getConfig()
ok('默认每日推送开启', c.daily === true)
ok('默认事件推送开启', c.events === true)
ok('默认推送时间 09:00', c.hour === 9)
ok('默认未配置 webhook', c.url === '')

process.env.WECOM_PUSH_DAILY = '0'
process.env.WECOM_PUSH_EVENTS = '0'
process.env.WECOM_PUSH_HOUR = '7'
process.env.WECOM_WEBHOOK_URL = GOOD_URL
c = w.getConfig()
ok('环境变量可关闭每日/事件推送', c.daily === false && c.events === false)
ok('环境变量可改推送时间与地址', c.hour === 7 && c.url === GOOD_URL)

process.env.WECOM_PUSH_HOUR = '99'
ok('推送小时上限夹取到 23', w.getConfig().hour === 23)
process.env.WECOM_PUSH_HOUR = '-5'
ok('推送小时下限夹取到 0', w.getConfig().hour === 0)
process.env.WECOM_PUSH_HOUR = 'abc'
ok('非法推送时间回退到 9', w.getConfig().hour === 9)
resetEnv()

// ---------- Webhook 白名单 ----------
ok('合法企微 Webhook 通过', w.isValidWebhook(GOOD_URL) === true)
ok('空地址被拒', w.isValidWebhook('') === false)
ok('http 被拒', w.isValidWebhook(GOOD_URL.replace('https:', 'http:')) === false)
ok('非企微域名被拒', w.isValidWebhook(GOOD_URL.replace('qyapi.weixin.qq.com', 'evil.example.com')) === false)
ok('非 webhook 路径被拒', w.isValidWebhook('https://qyapi.weixin.qq.com/cgi-bin/message/send?key=12345678-abcd-1234-abcd-123456789012') === false)
ok('缺少 key 被拒', w.isValidWebhook('https://qyapi.weixin.qq.com/cgi-bin/webhook/send') === false)
ok('畸形 URL 不抛异常', w.isValidWebhook('not-a-url') === false)

// ---------- 日期计算 ----------
ok('加 7 天跨月', w.addDays('2026-11-28', 7) === '2026-12-05')
ok('跨年', w.addDays('2026-12-30', 7) === '2027-01-06')
ok('闰年 2 月', w.addDays('2028-02-27', 2) === '2028-02-29')
ok('非法日期返回空', w.addDays('bad', 1) === '')

// ---------- 每日汇总数据分类 ----------
S.rows = [
  tenant('逾期客', '2026-11-08'),
  tenant('今天到期', '2026-11-12'),
  tenant('第7天', '2026-11-19'),
  tenant('第8天', '2026-11-20')
]
S.cleaning = [{ room_no: '301', store_name: '阳光公寓' }, { room_no: '302', store_name: '港湾公寓' }]
S.unread = 4
// 已退租记录由 SQL 的 status='active' 过滤，桩只给在住行
const snap = w.collectDailySnapshot(undefined, '2026-11-12')
ok('逾期识别 1 间', snap.overdue.length === 1, JSON.stringify(snap.overdue))
ok('7 天内到期含今天与第 7 天', snap.dueSoon.length === 2, JSON.stringify(snap.dueSoon))
ok('第 8 天不计入', !snap.dueSoon.some((x) => x.name === '第8天'))
ok('待清扫 2 间', snap.cleaning.length === 2)
ok('未读提醒 4 条', snap.unread === 4)

const report = w.buildDailyReport(snap)
ok('汇总含日期标题', report.includes('公寓待办 · 2026-11-12'))
ok('汇总含 7 天内到期数量', report.includes('房租 7 天内到期：2 间'))
ok('汇总含逾期数量', report.includes('已逾期：1 间'))
ok('汇总含待清扫数量', report.includes('待清扫：2 间'))
ok('汇总含未读提醒数量', report.includes('未读提醒：4 条'))
ok('汇总列出房号与姓名', report.includes('阳光公寓 201') && report.includes('今天到期'))
ok('汇总不带手机号/身份证字段', !report.includes('phone') && !report.includes('id_card'))

const emptyReport = w.buildDailyReport({
  today: '2026-11-12', dueDays: 7, overdue: [], dueSoon: [], cleaning: [], unread: 0
})
ok('空数据汇总不报错且给出「无」', emptyReport.includes('> 无') && emptyReport.includes('未读提醒：0 条'))

const many = Array.from({ length: 60 }, (_, i) => tenant(`租客${i}`, '2026-11-13', { room_no: String(100 + i) }))
const bigReport = w.buildDailyReport({
  today: '2026-11-12', dueDays: 7, overdue: [], dueSoon: many, cleaning: [], unread: 0
})
ok('超长汇总限制在 15 条并列出剩余', bigReport.includes('另有 45 间'))
ok('超长汇总字节数受控', Buffer.byteLength(bigReport, 'utf8') <= 3600)
const hugeReport = w.buildDailyReport({
  today: '2026-11-12', dueDays: 7, overdue: [], dueSoon: Array.from({ length: 15 }, (_, i) =>
    tenant('很长'.repeat(200) + i, '2026-11-13')), cleaning: [], unread: 0
})
ok('超长单行内容被截断', Buffer.byteLength(hugeReport, 'utf8') <= 3600 && hugeReport.includes('内容已截断'))

// ---------- 事件内容 ----------
const collectContent = w.buildEventContent('collect', {
  tenantName: '王艳兰', storeName: '古城公寓', roomNo: '201', amount: 1420,
  paymentNo: 'SF000008', oldDue: '2026-11-06', newDue: '2026-12-06',
  waterMode: 'flat', electricityMode: 'meter', waterFee: 20, electricityFee: 120
})
ok('收款事件含金额与单号', collectContent.includes('¥1420') && collectContent.includes('SF000008'))
ok('收款事件含到期日前后对照', collectContent.includes('2026-11-06') && collectContent.includes('2026-12-06'))
ok('收款事件含水/电模式', collectContent.includes('flat') && collectContent.includes('meter'))

const del = w.buildEventContent('payment_delete', {
  tenantName: '李某', roomNo: '201', amount: 600, paymentNo: 'SF000006', paidAt: '2026-10-31 08:18:49'
})
ok('删收款事件含风险提示', del.includes('删除收款记录') && del.includes('不会回退'))
ok('删收款事件含金额与原时间', del.includes('¥600') && del.includes('2026-10-31 08:18:49'))

const checkout = w.buildEventContent('checkout', {
  tenantName: '张某', roomNo: '202', checkOutDate: '2026-11-12 15:00:00'
})
ok('退房事件含待清扫', checkout.includes('待清扫') && checkout.includes('2026-11-12 15:00:00'))
ok('改期事件含前后值', w.buildEventContent('due_date', { before: '2026-11-06', after: '2026-12-06' }).includes('2026-12-06'))
ok('入住事件含月租', w.buildEventContent('checkin', { rent: 1200 }).includes('¥1200'))
ok('催租事件含正文', w.buildEventContent('reminder', { content: '请于今日缴租' }).includes('请于今日缴租'))
ok('测试事件有内容', w.buildEventContent('test').includes('推送测试'))
ok('未知事件类型返回空', w.buildEventContent('unknown_type') === '')
ok('事件不泄露敏感字段', !w.buildEventContent('collect', {
  phone: '13800000000', idCard: '110101199001011234', amount: 1
}).includes('13800000000'))

// ---------- 发送链路 ----------
function resetStub() { S.runs = []; S.claimChanges = 1 }
const okSend = async () => ({ ok: true, error: '' })
const failSend = async () => ({ ok: false, error: '模拟网络失败' })

resetStub()
let sends = 0
let r = await w.pushMessage({
  kind: 'daily', dedupKey: 'x', content: '内容', dryRun: true,
  send: async () => { sends += 1; return okSend() }
})
ok('dryRun 不联网', r.ok === true && r.dryRun === true && sends === 0)
ok('dryRun 不写库', S.runs.length === 0)
ok('dryRun 返回组装内容', r.content === '内容')

resetEnv()
resetStub()
r = await w.pushMessage({ kind: 'daily', dedupKey: 'x', content: '内容', send: okSend })
ok('未配置 Webhook 时静默跳过', r.skipped === true && r.error.includes('未配置'))
ok('未配置时不产生任何数据库写入', S.runs.length === 0)

process.env.WECOM_WEBHOOK_URL = GOOD_URL
process.env.WECOM_PUSH_DAILY = '0'
resetStub()
r = await w.pushMessage({ kind: 'daily', dedupKey: 'x', content: '内容', send: okSend })
ok('关闭每日推送后跳过', r.skipped === true && r.error.includes('已关闭'))
process.env.WECOM_PUSH_DAILY = '1'
process.env.WECOM_PUSH_EVENTS = '0'
resetStub()
r = await w.pushMessage({ kind: 'event', dedupKey: 'x', content: '内容', send: okSend })
ok('关闭事件推送后跳过', r.skipped === true && r.error.includes('已关闭'))
process.env.WECOM_PUSH_EVENTS = '1'

resetStub()
S.claimChanges = 0
sends = 0
r = await w.pushMessage({
  kind: 'daily', dedupKey: 'daily:2026-11-12', content: '内容',
  send: async () => { sends += 1; return okSend() }
})
ok('重复 dedupKey 被拦截', r.skipped === true && r.error.includes('重复'))
ok('重复时不会真的发送', sends === 0)

resetStub()
r = await w.pushMessage({ kind: 'daily', dedupKey: 'daily:ok', title: '每日待办', content: '内容', send: okSend })
ok('成功发送返回 ok', r.ok === true)
ok('成功后写回 ok=1', S.runs.some((x) => x.sql.startsWith('UPDATE push_logs') && x.args[0] === 1))
ok('每日成功后清理过期记录', S.runs.some((x) => x.sql.includes('DELETE FROM push_logs WHERE created_at')))

resetStub()
r = await w.pushMessage({ kind: 'event', dedupKey: 'event:fail', content: '内容', send: failSend })
ok('发送失败返回错误', r.ok === false && r.error === '模拟网络失败')
ok('失败释放占位允许重试', S.runs.some((x) => x.sql === 'DELETE FROM push_logs WHERE id=?'))
ok('失败另记一行 error', S.runs.some((x) => x.args[0] === 'error'))

resetStub()
r = await w.pushDaily({ dryRun: true, today: '2026-11-12' })
ok('pushDaily dryRun 输出汇总', r.ok === true && r.content.includes('公寓待办 · 2026-11-12'))
ok('pushDaily dryRun 不写库', S.runs.length === 0)

resetStub()
r = await w.pushMessage({ kind: 'event', dedupKey: 'empty', content: '', send: okSend })
ok('空内容不发送', r.skipped === true && S.runs.length === 0)

for (const k of ['WECOM_WEBHOOK_URL', 'WECOM_PUSH_DAILY', 'WECOM_PUSH_EVENTS', 'WECOM_PUSH_HOUR']) {
  if (savedEnv[k] === undefined) delete process.env[k]
  else process.env[k] = savedEnv[k]
}
console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
if (fail) process.exit(1)
