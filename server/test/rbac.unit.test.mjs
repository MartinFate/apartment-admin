// 权限（RBAC）离线单测：无需 better-sqlite3 / 无需启动服务。
// 用 Node 模块钩子把 db.js / jsonwebtoken / bcryptjs 换成内存桩，直接加载真实 auth.js，
// 验证：authRequired 的查库校验（禁用/删号/角色覆盖）与 requireRole 的角色判断。
// 运行：node server/test/rbac.unit.test.mjs
import { registerHooks } from 'node:module'

// 桩 db：从 globalThis.__rbacUser 返回当前「库里」的用户；__rbacQueryLog 记录查库次数。
const DB_STUB = `
export default {
  prepare: () => ({
    get: (...args) => {
      (globalThis.__rbacQueryLog ||= []).push(args)
      return globalThis.__rbacUser || undefined
    }
  })
}
`
// 桩 JWT：sign 返回带 payload 的假 token；verify 解析它，支持伪造过期错误。
const JWT_STUB = `
export function sign(payload) { return 'stub.' + JSON.stringify(payload) }
export function verify(token) {
  if (token === 'expired') throw new Error('jwt expired')
  if (token === 'garbage') throw new Error('invalid token')
  const raw = String(token || '').startsWith('stub.') ? String(token).slice(5) : ''
  if (!raw) throw new Error('bad token')
  return JSON.parse(raw)
}
export default { sign, verify }
`
const BCRYPT_STUB = `
export function hashSync(p) { return 'hash:' + p }
export function compareSync(p, h) { return h === 'hash:' + p }
export default { hashSync, compareSync }
`

registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('db.js')) {
      return { url: 'data:text/javascript,' + encodeURIComponent(DB_STUB), shortCircuit: true }
    }
    if (spec === 'jsonwebtoken') {
      return { url: 'data:text/javascript,' + encodeURIComponent(JWT_STUB), shortCircuit: true }
    }
    if (spec === 'bcryptjs') {
      return { url: 'data:text/javascript,' + encodeURIComponent(BCRYPT_STUB), shortCircuit: true }
    }
    return next(spec, ctx)
  }
})

process.env.JWT_SECRET = 'unit-test-secret-not-the-default-value-0123456789'
const auth = await import(new URL('../src/auth.js', import.meta.url).href)

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('PASS', name) }
  else { fail += 1; console.log('FAIL', name, extra) }
}

// 构造 token 与请求/响应桩
const tokenFor = (user) => 'stub.' + JSON.stringify({ sub: user.id, username: user.username, role: user.role, name: user.name })
function makeRes() {
  return {
    statusCode: 200,
    body: undefined,
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this }
  }
}
// 直接调用 authRequired，返回 { nextCalled, status, body, req }
function runAuth({ token, dbUser, noHeader = false } = {}) {
  globalThis.__rbacUser = dbUser
  globalThis.__rbacQueryLog = []
  const req = { headers: noHeader ? {} : { authorization: `Bearer ${token}` } }
  const res = makeRes()
  let nextCalled = false
  auth.authRequired(req, res, () => { nextCalled = true })
  return { nextCalled, status: res.statusCode, body: res.body, req, queries: globalThis.__rbacQueryLog.length }
}

const activeAdmin = { id: 1, username: 'admin', name: '超管', role: 'admin', store_id: null, status: 'active' }

// ---- 1. authRequired：无 token / 坏 token ----
{
  const r = runAuth({ noHeader: true })
  ok('无 Authorization 头 → 401', r.status === 401 && !r.nextCalled, JSON.stringify(r.body))
}
{
  const r = runAuth({ token: 'garbage' })
  ok('伪造/过期 token → 401', r.status === 401 && !r.nextCalled, JSON.stringify(r.body))
}

// ---- 2. authRequired：查库校验账号状态（旧 token 立即失效）----
{
  const r = runAuth({ token: tokenFor(activeAdmin), dbUser: undefined })
  ok('账号已删除（库里查不到）→ 401 且不进入业务', r.status === 401 && !r.nextCalled, JSON.stringify(r.body))
  ok('删号后 req.user 被清除（不留旧身份）', r.req.user === undefined)
}
{
  const disabled = { ...activeAdmin, status: 'disabled' }
  const r = runAuth({ token: tokenFor(activeAdmin), dbUser: disabled })
  ok('账号被禁用（旧 token 未过期）→ 403 立即拒绝', r.status === 403 && !r.nextCalled, JSON.stringify(r.body))
  ok('禁用时仍记录真实角色用于审计', r.req.user?.role === 'admin')
}
{
  const r = runAuth({ token: tokenFor(activeAdmin), dbUser: activeAdmin })
  ok('有效账号放行', r.nextCalled === true && r.status === 200)
  ok('每个请求都实时查库一次', r.queries === 1, `实际 ${r.queries}`)
}

// ---- 3. authRequired：角色以库为准覆盖 token 快照 ----
{
  // token 里仍是 admin，但库里已降为 operator → 必须以 operator 为准，防止降权后旧 token 仍高阶
  const r = runAuth({ token: tokenFor(activeAdmin), dbUser: { ...activeAdmin, role: 'operator' } })
  ok('库里角色覆盖 token 快照（降权即时生效）', r.nextCalled && r.req.user.role === 'operator', JSON.stringify(r.req.user))
  ok('覆盖后身份字段来自库 storeId/name', r.req.user.storeId === null && r.req.user.name === '超管')
}

// ---- 4. requireRole：角色白名单判断 ----
{
  const onlyAdmin = auth.requireRole('admin')
  const mk = (role) => ({ user: role ? { role } : undefined })
  const res = makeRes()
  let called = false
  onlyAdmin(mk('admin'), res, () => { called = true })
  ok('requireRole(admin)：admin 放行', called && res.statusCode === 200)
  const res2 = makeRes(); let called2 = false
  onlyAdmin(mk('operator'), res2, () => { called2 = true })
  ok('requireRole(admin)：operator 拒绝 403', !called2 && res2.statusCode === 403)
  const res3 = makeRes(); let called3 = false
  onlyAdmin(mk(null), res3, () => { called3 = true })
  ok('requireRole：无 req.user 拒绝 403', !called3 && res3.statusCode === 403)
}
{
  const finance = auth.requireRole('admin', 'finance')
  const mk = (role) => ({ user: { role } })
  for (const role of ['admin', 'finance']) {
    const res = makeRes(); let called = false
    finance(mk(role), res, () => { called = true })
    ok(`财务白名单含 ${role} → 放行`, called && res.statusCode === 200)
  }
  for (const role of ['operator', 'manager']) {
    const res = makeRes(); let called = false
    finance(mk(role), res, () => { called = true })
    ok(`财务白名单拒 ${role} → 403`, !called && res.statusCode === 403)
  }
}

console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
