// 操作日志审计离线单测：无需 better-sqlite3 / 无需启动服务。
// 用 Node 的模块钩子把 db.js 换成内存桩，直接加载真实 audit.js 验证采集链路。
// 运行：node server/test/audit.unit.test.mjs
import { registerHooks } from 'node:module'
import { EventEmitter } from 'node:events'

const STUB = `
export default {
  prepare: () => ({
    run: (...args) => { (globalThis.__auditRuns ||= []).push(args); return { changes: 0 } },
    get: () => undefined,
    all: () => []
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

const audit = await import(new URL('../src/lib/audit.js', import.meta.url).href)

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log('PASS', name)
  } else {
    fail += 1
    console.log('FAIL', name, extra)
  }
}

// 模拟一次完整请求：中间件注册 → 业务埋点 → 响应 → finish 写日志
function run({
  method = 'GET', url = '/api/tenants', body, query = {}, user,
  statusCode = 200, respBody, extra
} = {}) {
  globalThis.__auditRuns = []
  const req = {
    method,
    originalUrl: url,
    url,
    headers: {
      'x-forwarded-for': '203.0.113.20, 127.0.0.1',
      'user-agent': 'unit-test-agent'
    },
    body,
    query,
    user,
    ip: '127.0.0.1'
  }
  const res = new EventEmitter()
  res.statusCode = statusCode
  res.json = (b) => b
  audit.auditMiddleware(req, res, () => {})
  if (extra) audit.setAuditDetail(req, extra)
  if (respBody !== undefined) res.json(respBody)
  res.emit('finish')
  return globalThis.__auditRuns
}

// logAudit 的 INSERT 参数顺序
const IDX = {
  ts: 0, actorId: 1, actorName: 2, actorRole: 3, action: 4, module: 5,
  targetId: 6, targetLabel: 7, method: 8, path: 9, ip: 10, userAgent: 11,
  status: 12, statusCode: 13, detail: 14, requestId: 15
}

// ---- 1. 路径 → 模块 / 动作 / 目标映射 ----
const mapCases = [
  ['POST', '/api/tenants/12/collect', 'tenants', 'collect', '12'],
  ['POST', '/api/tenants/12/due-date', 'tenants', 'due_date', '12'],
  ['POST', '/api/tenants/12/checkout', 'tenants', 'checkout', '12'],
  ['POST', '/api/tenants', 'tenants', 'create', ''],
  ['PUT', '/api/rooms/3', 'rooms', 'update', '3'],
  ['DELETE', '/api/payments/7', 'payments', 'delete', '7'],
  ['POST', '/api/payments', 'payments', 'create', ''],
  ['POST', '/api/auth/login', 'auth', 'login', ''],
  ['POST', '/api/auth/change-password', 'auth', 'change_password', ''],
  ['POST', '/api/auth/logout', 'auth', 'logout', ''],
  ['GET', '/api/uploads/tenants/12/id_1.jpg', 'uploads', 'view', '12'],
  ['POST', '/api/uploads/tenants/12', 'uploads', 'upload', '12'],
  ['DELETE', '/api/uploads/tenants/12/contract', 'uploads', 'delete', '12'],
  ['PUT', '/api/reminders/4/read', 'reminders', 'read', '4'],
  ['POST', '/api/users/5/enable', 'users', 'enable', '5'],
  ['GET', '/api/audit/export', 'audit', 'export', '']
]
for (const [method, url, module, action, targetId] of mapCases) {
  const d = audit.describe({ method, originalUrl: url })
  ok(
    `映射 ${method} ${url}`,
    d.module === module && d.action === action && d.targetId === targetId,
    `得到 ${d.module}/${d.action}/${d.targetId}`
  )
}

// ---- 2. 是否记录（普通 GET 默认不记，敏感读与导出必记） ----
ok('写操作记录一条', run({ method: 'DELETE', url: '/api/payments/7' }).length === 1)
ok('普通列表 GET 不记', run({ method: 'GET', url: '/api/tenants?storeId=1' }).length === 0)
ok('附件查看 GET 记录', run({ method: 'GET', url: '/api/uploads/tenants/12/a.jpg' }).length === 1)
ok('日志导出 GET 记录', run({ method: 'GET', url: '/api/audit/export' }).length === 1)
ok('日志列表 GET 不自增殖', run({ method: 'GET', url: '/api/audit/logs' }).length === 0)
ok('meta GET 不自增殖', run({ method: 'GET', url: '/api/audit/meta' }).length === 0)
ok('非 /api 路径不记', run({ method: 'GET', url: '/dashboard' }).length === 0)

// ---- 3. 脱敏 ----
const masked = run({
  method: 'POST',
  url: '/api/users',
  user: { sub: 1, name: '管理员', username: 'admin', role: 'admin' },
  body: {
    username: 'zhangsan',
    password: 'secret123',
    token: 'jwt-value',
    idCard: '110101199001011234',
    name: '张三',
    attachments: { contracts: [{}, {}] },
    role: 'operator'
  }
})
const md = JSON.parse(masked[0][IDX.detail])
ok('密码脱敏', md.request.password === '***')
ok('令牌脱敏', md.request.token === '***')
ok('证件号脱敏', md.request.idCard === '***')
ok('业务姓名保留', md.request.name === '张三')
ok('附件只记数量', String(md.request.attachments).includes('2'))
ok('普通字段保留', md.request.role === 'operator')

// ---- 4. 失败请求、操作人、IP、requestId ----
const failed = run({
  method: 'POST',
  url: '/api/auth/login',
  body: { username: 'admin', password: 'wrong' },
  statusCode: 401,
  respBody: { message: '用户名或密码错误' }
})
ok('登录失败记录一条', failed.length === 1)
ok('登录失败标记 fail', failed[0][IDX.status] === 'fail')
ok('登录失败记尝试账号', failed[0][IDX.actorName] === 'admin')
ok('失败原因进入明细', JSON.parse(failed[0][IDX.detail]).status === 'fail')
ok('X-Forwarded-For 取首段', failed[0][IDX.ip] === '203.0.113.20')
ok('requestId 非空', String(failed[0][IDX.requestId]).length > 0)

// ---- 5. 业务埋点与响应快照 ----
const enriched = run({
  method: 'DELETE',
  url: '/api/payments/7',
  user: { sub: 1, name: '管理员', username: 'admin', role: 'admin' },
  extra: { paymentNo: 'SF000006', before: { amount: 1420 } },
  respBody: true
})
const ed = JSON.parse(enriched[0][IDX.detail])
ok('埋点单号进入明细', ed.paymentNo === 'SF000006')
ok('埋点旧值进入明细', ed.before.amount === 1420)
ok('操作人来自 JWT', enriched[0][IDX.actorName] === '管理员')

const labeled = run({
  method: 'POST',
  url: '/api/rooms',
  respBody: { id: 9, roomNo: 'A-101', name: '王芳' }
})
ok('targetLabel 取响应快照', String(labeled[0][IDX.targetLabel]).includes('A-101'))

// ---- 6. 一次请求只落一条 ----
const single = run({
  method: 'POST',
  url: '/api/tenants/12/collect',
  extra: { paymentNo: 'SF000007', before: { rentDueDate: '2026-11-05' } },
  respBody: { id: 12, name: '王芳' }
})
ok('一次请求只写一条日志', single.length === 1)

console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
if (fail) process.exit(1)
