// 企微「群内查房态」离线单测：零依赖、无需 better-sqlite3、无需外网、不发任何真实消息。
// 运行：node server/test/roomQuery.unit.test.mjs
import {
  getBotConfig, normalizeText, parseCommand, isAllowed, collectRoomSnapshot,
  buildAnswer, buildHelp, handleQuery, createDedup, createLimiter, STATUS_LABEL
} from '../src/lib/roomQuery.js'

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('PASS', name) }
  else { fail += 1; console.log('FAIL', name, extra) }
}

const TODAY = '2026-11-16'
const row = (o = {}) => ({
  room_no: '604', status: 'cleaning', rent: 600, floor: 6, area: 25,
  water_meter: 123, electricity_meter: 456, meter_date: '2026-11-01',
  store_name: '古城公寓', resident: '', rent_due_date: '', ...o
})
const ROWS = [
  row({ room_no: 'A-203', status: 'empty', rent: 600, store_name: '阳光公寓' }),
  row({ room_no: 'B-105', status: 'empty', rent: 550 }),
  row({ room_no: '302', status: 'rented', rent: 620, resident: '刘虹', rent_due_date: '2026-11-20' }),
  row({ room_no: '201', status: 'rented', rent: 800, resident: '王五', rent_due_date: '2026-11-10' }),
  row(),
  row({ room_no: 'B-9', status: 'maintenance', rent: 0 })
]
let capturedSql = ''
const fakeDb = (rows = ROWS) => ({
  prepare: (sql) => { capturedSql = sql; return { all: () => rows } }
})
const cfg = (o = {}) => getBotConfig({ ...o })
const snap = (rows = ROWS, today = TODAY) => collectRoomSnapshot(fakeDb(rows), today)

// ---------- 配置解析 ----------
ok('默认未配置凭证时不启用', getBotConfig({}).enabled === false)
ok('只有 BotID 不启用', getBotConfig({ WECOM_BOT_ID: 'bot' }).enabled === false)
ok('只有 Secret 不启用', getBotConfig({ WECOM_BOT_SECRET: 'sec' }).enabled === false)
ok('两项齐全即启用', getBotConfig({ WECOM_BOT_ID: 'bot', WECOM_BOT_SECRET: 'sec' }).enabled === true)
ok('显式禁用可覆盖', getBotConfig({ WECOM_BOT_ID: 'b', WECOM_BOT_SECRET: 's', WECOM_BOT_ENABLED: '0' }).enabled === false)
ok('白名单逗号拆分去空格', JSON.stringify(cfg({ WECOM_BOT_ALLOWED_CHATS: 'a, b ,c' }).allowedChats) === '["a","b","c"]')
ok('成员白名单拆分', JSON.stringify(cfg({ WECOM_BOT_ALLOWED_USERS: 'u1,u2' }).allowedUsers) === '["u1","u2"]')
ok('默认不允许单聊', cfg({}).allowSingle === false)
ok('单聊开关可打开', cfg({ WECOM_BOT_ALLOW_SINGLE: '1' }).allowSingle === true)
ok('默认显示姓名金额表读数', cfg({}).showName && cfg({}).showRent && cfg({}).showMeter)
ok('脱敏开关 0 生效', cfg({ WECOM_BOT_SHOW_NAME: '0', WECOM_BOT_SHOW_RENT: '0', WECOM_BOT_SHOW_METER: '0' }).showName === false)
ok('限流默认 10', cfg({}).rateLimit === 10)
ok('限流上限夹取 60', cfg({ WECOM_BOT_RATE_LIMIT: '999' }).rateLimit === 60)
ok('限流下限夹取 1', cfg({ WECOM_BOT_RATE_LIMIT: '-5' }).rateLimit === 1)
ok('非法限流回落默认', cfg({ WECOM_BOT_RATE_LIMIT: 'abc' }).rateLimit === 10)
ok('未知命令默认回复提示', cfg({}).replyUnknown === true)
ok('未知命令可静默', cfg({ WECOM_BOT_REPLY_UNKNOWN: '0' }).replyUnknown === false)

// ---------- 文本清洗与命令解析 ----------
ok('剥离 @ 机器人名', normalizeText('@公寓助手 房态') === '房态')
ok('剥离多个 @', normalizeText('@a @b 空房') === '空房')
ok('清理零宽字符与多余空格', normalizeText('  房\u200b态   总览  ') === '房态 总览')
ok('空文本返回 unknown', parseCommand('   ').kind === 'unknown')
ok('解析 房态', parseCommand('房态').kind === 'overview')
ok('解析 总览 别名', parseCommand('总览').kind === 'overview')
ok('解析 空房', parseCommand('空房').kind === 'empty')
ok('解析 可租 别名', parseCommand('可租').kind === 'empty')
ok('解析 待清扫', parseCommand('待清扫').kind === 'cleaning')
ok('解析 保洁 别名', parseCommand('保洁').kind === 'cleaning')
ok('解析 到期', parseCommand('到期').kind === 'due')
ok('解析 逾期 别名', parseCommand('逾期').kind === 'due')
ok('解析 帮助', parseCommand('帮助').kind === 'help')
ok('解析 英文 help 大小写不敏感', parseCommand('HELP').kind === 'help')
ok('解析问号', parseCommand('？').kind === 'help')
ok('带 @ 前缀的命令', parseCommand('@公寓助手 房态').kind === 'overview')
ok('纯数字房号', parseCommand('604').kind === 'room')
ok('带字母连字符房号', parseCommand('A-203').kind === 'room')
ok('字母数字混合房号', parseCommand('B301').kind === 'room')
ok('无数字纯字母不算房号', parseCommand('ABC').kind === 'unknown')
ok('写操作不被识别为命令', parseCommand('办理退房 604').kind === 'unknown')
ok('收款指令不被识别', parseCommand('收款 600').kind === 'unknown')
ok('改到期日不被识别', parseCommand('改到期日 2026-12-01').kind === 'unknown')
ok('过长文本不算房号', parseCommand('A123456789012345').kind === 'unknown')

// ---------- 白名单 ----------
const groupFrame = (o = {}) => ({
  body: { chattype: 'group', chatid: 'chat-1', from: { userid: 'u1' }, msgtype: 'text', text: { content: '房态' }, ...o }
})
ok('群聊默认放行', isAllowed(groupFrame(), cfg({})).ok === true)
ok('单聊默认拒绝', isAllowed(groupFrame({ chattype: 'single' }), cfg({})).ok === false)
ok('单聊开关放行', isAllowed(groupFrame({ chattype: 'single' }), cfg({ WECOM_BOT_ALLOW_SINGLE: '1' })).ok === true)
ok('会话白名单命中', isAllowed(groupFrame(), cfg({ WECOM_BOT_ALLOWED_CHATS: 'chat-1,chat-2' })).ok === true)
ok('会话白名单未命中', isAllowed(groupFrame(), cfg({ WECOM_BOT_ALLOWED_CHATS: 'chat-9' })).ok === false)
ok('成员白名单命中', isAllowed(groupFrame(), cfg({ WECOM_BOT_ALLOWED_USERS: 'u1' })).ok === true)
ok('成员白名单未命中', isAllowed(groupFrame(), cfg({ WECOM_BOT_ALLOWED_USERS: 'u9' })).ok === false)
ok('两个白名单都需满足', isAllowed(groupFrame(), cfg({ WECOM_BOT_ALLOWED_CHATS: 'chat-1', WECOM_BOT_ALLOWED_USERS: 'u9' })).ok === false)
ok('拒绝带原因', isAllowed(groupFrame({ chattype: 'single' }), cfg({})).reason.includes('群聊'))
ok('缺 chattype 时按有无 chatid 推断', isAllowed({ body: { chatid: 'c1', from: {} } }, cfg({})).ok === true)

// ---------- 数据快照 ----------
const s = snap()
ok('快照总数正确', s.total === 6)
ok('空房计数 2', s.counts.empty === 2)
ok('在住计数 2', s.counts.rented === 2)
ok('待清扫计数 1', s.counts.cleaning === 1)
ok('维修计数 1', s.counts.maintenance === 1)
ok('空房列表 2 间', s.emptyRooms.length === 2)
ok('待清扫列表 1 间', s.cleaningRooms.length === 1)
ok('7 天内到期 1 间', s.dueSoon.length === 1)
ok('到期日边界含当天+7', snap(ROWS, '2026-11-13').dueSoon.length === 1)
ok('逾期 1 间', s.overdue.length === 1)
ok('逾期排在到期之前', s.overdue[0].due === '2026-11-10')
ok('到期口径与首页一致为 7 天', s.dueDays === 7)
ok('快照不含手机号字段', !/(phone|id_card|attachment)/i.test(JSON.stringify(s)))
ok('查询 SQL 是只读 SELECT', /^\s*SELECT/.test(capturedSql))
ok('查询 SQL 不含写操作', !/\b(INSERT|UPDATE|DELETE|DROP|REPLACE)\b/i.test(capturedSql))
ok('查询 SQL 不含证件与手机号列', !/(phone|id_card|attachments)/i.test(capturedSql))
ok('状态中文映射完整', Object.keys(STATUS_LABEL).length === 4 && STATUS_LABEL.cleaning === '待清扫')
ok('未知状态计入 other', collectRoomSnapshot(fakeDb([row({ status: 'weird' })]), TODAY).counts.other === 1)
ok('空库返回全零', collectRoomSnapshot(fakeDb([]), TODAY).total === 0)

// ---------- 回答渲染 ----------
const cAll = cfg({ WECOM_BOT_ID: 'b', WECOM_BOT_SECRET: 's' })
const total = handleQuery({ text: '房态', database: fakeDb(), today: TODAY, cfg: cAll })
ok('总览标题含日期', total.reply.includes('房态总览') && total.reply.includes(TODAY))
ok('总览含汇总行', total.reply.includes('共 6 间 · 在住 2 · 空房 2'))
ok('总览含空房房号', total.reply.includes('A-203'))
ok('总览含待清扫房号', total.reply.includes('604'))
ok('总览含到期房号与姓名', total.reply.includes('302') && total.reply.includes('刘虹'))
ok('总览含逾期房号', total.reply.includes('201') && total.reply.includes('王五'))
ok('总览含金额', total.reply.includes('¥600'))
const emptyReply = handleQuery({ text: '空房', database: fakeDb(), today: TODAY, cfg: cAll }).reply
ok('空房命令含空房数', emptyReply.includes('空房：2 间'))
ok('空房命令不含在住房号', !emptyReply.includes('302'))
const cleaningReply = handleQuery({ text: '待清扫', database: fakeDb(), today: TODAY, cfg: cAll }).reply
ok('待清扫命令含 604', cleaningReply.includes('604'))
const dueReply = handleQuery({ text: '到期', database: fakeDb(), today: TODAY, cfg: cAll }).reply
ok('到期命令含逾期与将到期', dueReply.includes('已逾期') && dueReply.includes('7 天内到期'))
ok('帮助命令列出全部命令', handleQuery({ text: '帮助', database: fakeDb(), today: TODAY, cfg: cAll }).reply === buildHelp())
ok('帮助声明只读', buildHelp().includes('不提供任何修改操作'))
const detail = handleQuery({ text: '604', database: fakeDb(), today: TODAY, cfg: cAll }).reply
ok('单房间命令显示状态', detail.includes('古城公寓 604 · 待清扫'))
ok('单房间命令显示水电表', detail.includes('水表 123 / 电表 456'))
ok('单房间模糊匹配', handleQuery({ text: '20', database: fakeDb(), today: TODAY, cfg: cAll }).reply.includes('A-203'))
ok('单房间未找到有提示', handleQuery({ text: '9999', database: fakeDb(), today: TODAY, cfg: cAll }).reply.includes('未找到房号'))
ok('未知命令默认回提示', handleQuery({ text: '随便说点什么', database: fakeDb(), today: TODAY, cfg: cAll }).reply.includes('未识别的命令'))
ok('未知命令可静默', handleQuery({ text: '随便说点什么', database: fakeDb(), today: TODAY, cfg: cfg({ WECOM_BOT_REPLY_UNKNOWN: '0' }) }).reply === '')
ok('未知命令不回显用户输入', !handleQuery({ text: '<script>alert(1)</script>', database: fakeDb(), today: TODAY, cfg: cAll }).reply.includes('script'))
const cHide = cfg({ WECOM_BOT_SHOW_NAME: '0', WECOM_BOT_SHOW_RENT: '0', WECOM_BOT_SHOW_METER: '0' })
const hidden = handleQuery({ text: '房态', database: fakeDb(), today: TODAY, cfg: cHide }).reply
ok('关闭姓名后不出现姓名', !hidden.includes('刘虹') && !hidden.includes('王五'))
ok('关闭金额后不出现金额', !hidden.includes('¥600'))
ok('关闭表读数后单房间不显示表', !handleQuery({ text: '604', database: fakeDb(), today: TODAY, cfg: cHide }).reply.includes('水表'))
ok('脱敏后仍能看到房号', hidden.includes('A-203'))
const many = Array.from({ length: 800 }, (_, i) => row({ room_no: `R${i}`, status: 'empty' }))
const listReply = handleQuery({ text: '空房', database: fakeDb(many), today: TODAY, cfg: cAll }).reply
ok('列表最多列 15 间后提示另有', listReply.includes('另有'))
const longNames = Array.from({ length: 20 }, (_, i) => row({ room_no: `R${i}`, status: 'empty', store_name: '店'.repeat(300) }))
const longReply = handleQuery({ text: '空房', database: fakeDb(longNames), today: TODAY, cfg: cAll }).reply
ok('超长内容被截断', Buffer.byteLength(longReply, 'utf8') <= 3600 && longReply.includes('内容已截断'))
ok('空库总览不报错', handleQuery({ text: '房态', database: fakeDb([]), today: TODAY, cfg: cAll }).reply.includes('共 0 间'))

// ---------- 排重与限流 ----------
const d = createDedup(4)
ok('首次 msgid 通过', d.check('m1') === true)
ok('重复 msgid 被拦截', d.check('m1') === false)
ok('不同 msgid 通过', d.check('m2') === true)
ok('空 msgid 不拦截', d.check('') === true)
d.check('m3'); d.check('m4'); d.check('m5')
ok('容量超限淘汰旧键', d.size() <= 4)
d.clear()
ok('清空后可再次通过', d.check('m1') === true)
const l = createLimiter(60_000, 3)
ok('限流前 3 次通过', l.check('c1', 1000) && l.check('c1', 2000) && l.check('c1', 3000))
ok('限流第 4 次拦截', l.check('c1', 4000) === false)
ok('窗口滑动后重新放行', l.check('c1', 62_000) === true)
ok('不同会话互不影响', l.check('c2', 4000) === true)
l.setLimit(1, 60_000)
ok('可动态收紧限流', l.check('c3', 100) === true && l.check('c3', 200) === false)

console.log(`\nroomQuery 单测：${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
