// 操作日志查询 / 导出：仅超级管理员可读；日志只追加，不提供删除接口。
import { Router } from 'express'
import db from '../db.js'
import { parseRow, nowLocal, todayStr } from '../lib/helpers.js'
import {
  MODULES,
  ACTION_LABELS,
  RETENTION_DAYS,
  LOG_READS,
  auditSince
} from '../lib/audit.js'

const router = Router()

// 高危数据：实时回查数据库当前角色与状态，不信任 7 天有效期 JWT 里可能已过期的 role
router.use((req, res, next) => {
  const u = db.prepare('SELECT role, status FROM users WHERE id=?').get(req.user?.sub)
  if (!u || u.role !== 'admin' || u.status !== 'active') {
    return res.status(403).json({ message: '仅超级管理员可查看操作日志' })
  }
  next()
})

function buildWhere(q = {}) {
  const where = []
  const params = []
  const str = (v) => String(v ?? '').trim()
  if (str(q.module)) { where.push('module=?'); params.push(str(q.module)) }
  if (str(q.action)) { where.push('action=?'); params.push(str(q.action)) }
  if (str(q.actorId)) { where.push('actor_id=?'); params.push(Number(str(q.actorId))) }
  if (str(q.status)) { where.push('status=?'); params.push(str(q.status)) }
  if (str(q.targetId)) { where.push('target_id=?'); params.push(str(q.targetId)) }
  if (str(q.dateFrom)) { where.push('substr(ts,1,10)>=?'); params.push(str(q.dateFrom)) }
  if (str(q.dateTo)) { where.push('substr(ts,1,10)<=?'); params.push(str(q.dateTo)) }
  if (str(q.keyword)) {
    where.push('(target_label LIKE ? OR actor_name LIKE ? OR path LIKE ? OR detail LIKE ?)')
    const kw = `%${str(q.keyword)}%`
    params.push(kw, kw, kw, kw)
  }
  return { clause: where.length ? 'WHERE ' + where.join(' AND ') : '', params }
}

function decode(row) {
  const o = parseRow(row)
  if (o.detail) {
    try {
      o.detail = JSON.parse(o.detail)
    } catch {
      o.detail = { raw: o.detail }
    }
  } else {
    o.detail = {}
  }
  o.moduleLabel = MODULES[o.module] || o.module
  o.actionLabel = ACTION_LABELS[o.action] || o.action
  return o
}

function query(q = {}, page = 1, pageSize = 20) {
  const { clause, params } = buildWhere(q)
  const total = db.prepare(`SELECT COUNT(*) AS c FROM audit_logs ${clause}`).get(...params).c
  const p = Math.max(1, Number(page) || 1)
  const size = Math.min(50000, Math.max(1, Number(pageSize) || 20))
  const rows = db
    .prepare(`SELECT * FROM audit_logs ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...params, size, (p - 1) * size)
  return { list: rows.map(decode), total, page: p, pageSize: size }
}

router.get('/logs', (req, res) => {
  const { page, pageSize, ...q } = req.query
  res.json(query(q, page, pageSize))
})

router.get('/meta', (_req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS c FROM audit_logs').get().c
  const today = db
    .prepare('SELECT COUNT(*) AS c FROM audit_logs WHERE substr(ts,1,10)=?')
    .get(todayStr()).c
  const failed = db.prepare("SELECT COUNT(*) AS c FROM audit_logs WHERE status='fail'").get().c
  const actors = db
    .prepare('SELECT COUNT(DISTINCT actor_id) AS c FROM audit_logs WHERE actor_id IS NOT NULL')
    .get().c
  res.json({
    since: auditSince(),
    retentionDays: RETENTION_DAYS,
    logReads: LOG_READS,
    modules: Object.entries(MODULES).map(([value, label]) => ({ value, label })),
    actions: Object.entries(ACTION_LABELS).map(([value, label]) => ({ value, label })),
    stats: { total, today, failed, actors }
  })
})

// 防 CSV 公式注入：以 = + - @ 开头的单元格加单引号前缀
function csvCell(v) {
  let s = v === null || v === undefined ? '' : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return '"' + s.replace(/"/g, '""') + '"'
}

router.get('/export', (req, res) => {
  const q = { ...req.query }
  delete q.page
  delete q.pageSize
  const { list } = query(q, 1, 50000)
  const head = [
    '时间', '操作人', '角色', '模块', '动作', '对象', '目标ID',
    '结果', '状态码', 'IP', '请求方法', '请求路径', '明细'
  ]
  const lines = [head.map(csvCell).join(',')]
  for (const r of list) {
    lines.push(
      [
        r.ts, r.actorName, r.actorRole, r.moduleLabel, r.actionLabel, r.targetLabel,
        r.targetId, r.status === 'fail' ? '失败' : '成功', r.statusCode, r.ip,
        r.method, r.path, JSON.stringify(r.detail)
      ]
        .map(csvCell)
        .join(',')
    )
  }
  const stamp = nowLocal().replace(/[-: ]/g, '')
  const buf = Buffer.from('\uFEFF' + lines.join('\r\n'), 'utf8')
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="audit-${stamp}.csv"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(buf)
})

export default router
