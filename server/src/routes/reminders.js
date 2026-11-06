import { Router } from 'express'
import db from '../db.js'
import { parseRow, nowLocal } from '../lib/helpers.js'

const router = Router()

router.get('/', (req, res) => {
  const { status } = req.query
  const rows = status
    ? db.prepare('SELECT * FROM reminders WHERE status=? ORDER BY id DESC').all(status)
    : db.prepare('SELECT * FROM reminders ORDER BY id DESC').all()
  res.json({ list: rows.map(parseRow), total: rows.length })
})

router.post('/', (req, res) => {
  const b = req.body || {}
  // 防连点 / 网络重试：同一租户、相同内容、60 秒内已发过的未读提醒直接复用，
  // 避免列表里出现多条一模一样的催租记录（前端也有 doing 标志，这里是服务端兜底）。
  const since = nowLocal(new Date(Date.now() - 60 * 1000))
  const dup = db
    .prepare(
      `SELECT * FROM reminders
       WHERE tenant_id IS ? AND type=? AND content=? AND status='unread' AND created_at>=?
       ORDER BY id DESC LIMIT 1`
    )
    .get(b.tenantId || null, b.type || '', b.content || '', since)
  if (dup) return res.status(200).json(parseRow(dup))

  const info = db
    .prepare(
      'INSERT INTO reminders (tenant_id, tenant_name, store_name, room_no, type, content, status, created_at) VALUES (?,?,?,?,?,?,?,?)'
    )
    .run(
      b.tenantId || null,
      b.tenantName || '',
      b.storeName || '',
      b.roomNo || '',
      b.type || '',
      b.content || '',
      'unread',
      nowLocal()
    )
  res.status(201).json(parseRow(db.prepare('SELECT * FROM reminders WHERE id=?').get(info.lastInsertRowid)))
})

router.put('/:id/read', (req, res) => {
  const id = +req.params.id
  db.prepare("UPDATE reminders SET status='read' WHERE id=?").run(id)
  res.json(parseRow(db.prepare('SELECT * FROM reminders WHERE id=?').get(id)))
})

router.delete('/:id', (req, res) => {
  const id = +req.params.id
  db.prepare('DELETE FROM reminders WHERE id=?').run(id)
  res.json(true)
})

router.get('/unread-count', (req, res) => {
  const c = db.prepare("SELECT COUNT(*) AS c FROM reminders WHERE status='unread'").get().c
  res.json({ count: c })
})

export default router
