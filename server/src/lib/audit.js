// 操作日志审计：请求级采集、脱敏、只追加落库、保留策略。
// 设计要点：
// 1) 中间件挂在 app 顶层（express.json 之后），所有 /api/* 响应完成时统一落一条，
//    以后新增路由自动纳入，不会漏记；
// 2) 业务路由可用 setAuditDetail() 补充中间件拿不到的旧值 / 单号，一次请求仍只落一条；
// 3) 日志只追加，不提供删除接口；仅按保留天数自动清理，清理动作本身也留痕。
import crypto from 'node:crypto'
import db from '../db.js'
import { nowLocal } from './helpers.js'

export const RETENTION_DAYS = (() => {
  const raw = process.env.AUDIT_RETENTION_DAYS
  const n = raw === undefined || raw === '' ? 180 : Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 180
})()
export const LOG_READS = process.env.AUDIT_LOG_READS === '1'
const MAX_DETAIL = 4096

export const MODULES = {
  auth: '登录与账号',
  users: '系统用户',
  stores: '门店管理',
  rooms: '房源管理',
  tenants: '租户管理',
  payments: '收费账单',
  reminders: '提醒中心',
  dashboard: '工作台',
  uploads: '附件',
  audit: '操作日志',
  other: '其他'
}

export const ACTION_LABELS = {
  login: '登录',
  logout: '退出登录',
  change_password: '修改密码',
  create: '新增',
  update: '编辑',
  delete: '删除',
  collect: '收款',
  checkout: '退房',
  due_date: '改到期日',
  upload: '上传附件',
  view: '查看附件',
  export: '导出日志',
  purge: '清理过期日志',
  read: '标记已读',
  enable: '启用账号',
  disable: '禁用账号',
  enable_audit: '启用审计',
  query: '查询'
}

// 永不写入日志明文的字段：密码、令牌、证件号等
const SECRET_KEYS = new Set([
  'password', 'oldpassword', 'newpassword', 'password_hash', 'passwordhash',
  'token', 'authorization', 'secret', 'jwt', 'jwt_secret',
  'idcard', 'id_card', 'idnumber', 'cardno'
])
function isSecretKey(k) {
  const key = String(k).toLowerCase()
  return SECRET_KEYS.has(key) || /password|secret|token|credential/.test(key)
}

function sanitize(value, depth = 0) {
  if (value === null || value === undefined) return value
  if (depth > 4) return '[层级过深已省略]'
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => sanitize(v, depth + 1))
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (isSecretKey(k)) {
        out[k] = '***'
        continue
      }
      if (k.toLowerCase() === 'attachments') {
        const n = Array.isArray(v?.contracts) ? v.contracts.length : 0
        out[k] = `[附件 ${n} 张]`
        continue
      }
      out[k] = sanitize(v, depth + 1)
    }
    return out
  }
  if (typeof value === 'string' && value.length > 300) return value.slice(0, 300) + '…'
  return value
}

function randomId() {
  return crypto.randomBytes(8).toString('hex')
}

function pathOf(req) {
  return String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '')
}

// method + path → 模块 / 动作 / 目标 id
export function describe(req) {
  const p = pathOf(req)
  const method = String(req.method || 'GET').toUpperCase()
  const seg = p.split('/').filter(Boolean) // ['api','tenants','12','collect']
  const raw = seg[1] || ''
  const module = MODULES[raw] ? raw : 'other'
  const hasId = /^\d+$/.test(seg[2] || '')
  const sub = seg[3] || ''
  let action = 'query'

  if (raw === 'auth') {
    action = { login: 'login', logout: 'logout', 'change-password': 'change_password' }[seg[2]] || 'query'
  } else if (raw === 'audit') {
    action = seg[2] === 'export' ? 'export' : 'query'
  } else if (raw === 'uploads') {
    action = method === 'GET' ? 'view' : method === 'DELETE' ? 'delete' : 'upload'
  } else if (sub === 'collect') action = 'collect'
  else if (sub === 'checkout') action = 'checkout'
  else if (sub === 'due-date') action = 'due_date'
  else if (sub === 'read') action = 'read'
  else if (sub === 'enable') action = 'enable'
  else if (method === 'POST') action = hasId ? 'update' : 'create'
  else if (method === 'PUT' || method === 'PATCH') action = 'update'
  else if (method === 'DELETE') action = 'delete'
  else action = 'query'

  let targetId = hasId ? seg[2] : ''
  if (raw === 'uploads' && /^\d+$/.test(seg[3] || '')) targetId = seg[3]
  return { module, action, targetId, sub, method, path: p }
}

function shouldLog(req, desc) {
  if (!desc.path.startsWith('/api/')) return false
  // 审计界面自身浏览不产生日志，避免每次刷新都自增殖；导出属于数据外带，必须记录。
  if (desc.path === '/api/audit/logs' || desc.path === '/api/audit/meta') return false
  if (desc.method === 'GET' && !LOG_READS) {
    return desc.module === 'uploads' || desc.action === 'export'
  }
  return true
}

function pickLabel(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return ''
  const parts = []
  for (const k of ['roomNo', 'room_no', 'name', 'tenantName', 'tenant_name', 'no', 'username']) {
    const v = b[k]
    if (v && typeof v !== 'object' && !parts.includes(String(v))) parts.push(String(v))
  }
  return parts.slice(0, 3).join(' · ')
}

// 响应体只保留少量标识字段，避免把整个列表塞进日志
function pickResp(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return {}
  const keys = [
    'id', 'no', 'name', 'username', 'roomNo', 'room_no', 'tenantName', 'tenant_name',
    'status', 'rentDueDate', 'rentNewDue', 'checkOutDate', 'message', 'total'
  ]
  const out = {}
  for (const k of keys) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'object') out[k] = b[k]
  }
  return out
}

function buildDetail(req, res) {
  const detail = {}
  const body = sanitize(req.body || {})
  if (Object.keys(body).length) detail.request = body
  const query = sanitize(req.query || {})
  if (Object.keys(query).length) detail.query = query
  const extra = req._audit?.extra
  if (extra && Object.keys(extra).length) Object.assign(detail, extra)
  const resp = pickResp(res._auditResp)
  if (Object.keys(resp).length) detail.response = resp
  if (res.statusCode >= 400) detail.status = 'fail'

  let s
  try {
    s = JSON.stringify(detail)
  } catch {
    s = '{}'
  }
  if (s.length > MAX_DETAIL) {
    const small = { truncated: true }
    if (extra && Object.keys(extra).length) Object.assign(small, extra)
    if (detail.status) small.status = 'fail'
    s = JSON.stringify(small).slice(0, MAX_DETAIL)
  }
  return s
}

function actorOf(req, res) {
  if (req.user) {
    return {
      actorId: req.user.sub ?? null,
      actorName: req.user.name || req.user.username || '',
      actorRole: req.user.role || ''
    }
  }
  // 登录接口：actor 来自响应里的 user；登录失败则只记尝试的用户名
  const u = res._auditResp?.user
  if (u && typeof u === 'object') {
    return { actorId: u.id ?? null, actorName: u.name || u.username || '', actorRole: u.role || '' }
  }
  return { actorId: null, actorName: String(req.body?.username || ''), actorRole: '' }
}

function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
  return (xf || req.ip || '').slice(0, 64)
}

const insertLog = db.prepare(
  `INSERT INTO audit_logs
   (ts, actor_id, actor_name, actor_role, action, module, target_id, target_label,
    method, path, ip, user_agent, status, status_code, detail, request_id)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
)

export function logAudit(e = {}) {
  insertLog.run(
    e.ts || nowLocal(),
    e.actorId ?? null,
    e.actorName || '',
    e.actorRole || '',
    e.action || 'query',
    e.module || 'other',
    e.targetId != null ? String(e.targetId) : '',
    e.targetLabel || '',
    e.method || '',
    e.path || '',
    e.ip || '',
    String(e.userAgent || '').slice(0, 200),
    e.status || 'success',
    e.statusCode ?? 200,
    e.detail || '',
    e.requestId || randomId()
  )
}

// 业务路由调用：补充中间件拿不到的旧值、单号等业务明细
export function setAuditDetail(req, patch = {}) {
  if (!req._audit) req._audit = {}
  req._audit.extra = { ...(req._audit.extra || {}), ...patch }
}

export function auditMiddleware(req, res, next) {
  const desc = describe(req)
  req._audit = { requestId: randomId(), desc }
  const origJson = res.json.bind(res)
  res.json = (body) => {
    res._auditResp = body
    return origJson(body)
  }
  res.on('finish', () => {
    if (!shouldLog(req, desc)) return
    try {
      const actor = actorOf(req, res)
      logAudit({
        ...actor,
        action: desc.action,
        module: desc.module,
        targetId: desc.targetId,
        targetLabel: pickLabel(res._auditResp) || pickLabel(req.body) || '',
        method: desc.method,
        path: desc.path,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'],
        status: res.statusCode >= 400 ? 'fail' : 'success',
        statusCode: res.statusCode,
        detail: buildDetail(req, res),
        requestId: req._audit.requestId
      })
    } catch (err) {
      // 审计写入失败绝不能影响已经完成的主请求
      // eslint-disable-next-line no-console
      console.error('[audit] 写入日志失败', err)
    }
  })
  next()
}

// 审计启用基线：用户明确说此前的删收款 / 改到期日属于测试，日志从启用时刻开始，
// 界面展示该时间点，避免把启用前的历史数据误读成「无记录的事故」。
export function ensureAuditBaseline() {
  try {
    if (db.prepare("SELECT 1 FROM audit_logs WHERE action='enable_audit' LIMIT 1").get()) return
    logAudit({
      action: 'enable_audit',
      module: 'audit',
      targetLabel: '操作日志审计启用',
      method: 'SYSTEM',
      path: '-',
      status: 'success',
      detail: JSON.stringify({ note: '日志自此时间点开始记录，启用前的历史操作不可追溯' })
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[audit] 初始化基线失败', err)
  }
}

export function auditSince() {
  try {
    return db.prepare("SELECT ts FROM audit_logs WHERE action='enable_audit' ORDER BY id LIMIT 1").get()?.ts || ''
  } catch {
    return ''
  }
}

// 保留策略：按北京时间清理过期日志；基线记录永久保留；清理动作本身留痕。
export function startAuditRetention() {
  if (!RETENTION_DAYS) return
  const run = () => {
    try {
      const cutoff = nowLocal(new Date(Date.now() - RETENTION_DAYS * 86400 * 1000))
      const r = db.prepare("DELETE FROM audit_logs WHERE ts < ? AND action != 'enable_audit'").run(cutoff)
      if (r.changes) {
        logAudit({
          action: 'purge',
          module: 'audit',
          targetLabel: `清理 ${r.changes} 条过期日志`,
          method: 'SYSTEM',
          path: '-',
          status: 'success',
          detail: JSON.stringify({ deleted: r.changes, cutoff, retentionDays: RETENTION_DAYS })
        })
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[audit] 保留策略清理失败', err)
    }
  }
  const daily = setInterval(run, 24 * 3600 * 1000)
  daily.unref?.()
  const first = setTimeout(run, 60 * 1000)
  first.unref?.()
}
