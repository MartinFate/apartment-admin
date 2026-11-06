import { Router } from 'express'
import db from '../db.js'
import { hashPassword } from '../auth.js'
import { parseRow, nowLocal } from '../lib/helpers.js'

const router = Router()
const ROLES = ['admin', 'manager', 'operator', 'finance']

function publicRow(id) {
  return db
    .prepare('SELECT id, username, name, role, store_id, status, created_at FROM users WHERE id=?')
    .get(id)
}

router.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT id, username, name, role, store_id, status, created_at FROM users ORDER BY id')
    .all()
  res.json({ list: rows.map(parseRow), total: rows.length })
})

router.post('/', (req, res) => {
  const { username, password, name, role, storeId, status } = req.body || {}
  if (!username || !password || !name) {
    return res.status(400).json({ message: '用户名 / 密码 / 姓名 必填' })
  }
  if (String(password).length < 6) {
    return res.status(400).json({ message: '密码至少 6 位' })
  }
  if (db.prepare('SELECT 1 FROM users WHERE username=?').get(username)) {
    return res.status(409).json({ message: '用户名已存在' })
  }
  const r = ROLES.includes(role) ? role : 'operator'
  const info = db
    .prepare(
      'INSERT INTO users (username, password_hash, name, role, store_id, status, created_at) VALUES (?,?,?,?,?,?,?)'
    )
    .run(username, hashPassword(password), name, r, storeId || null, status || 'active', nowLocal())
  res.status(201).json(parseRow(publicRow(info.lastInsertRowid)))
})

router.put('/:id', (req, res) => {
  const id = +req.params.id
  const { name, role, storeId, status, password } = req.body || {}
  const cur = db.prepare('SELECT * FROM users WHERE id=?').get(id)
  if (!cur) return res.status(404).json({ message: '用户不存在' })
  const nextRole = ROLES.includes(role) ? role : cur.role
  const nextStore = storeId !== undefined ? storeId : cur.store_id
  const nextStatus = status || cur.status
  db.prepare('UPDATE users SET name=?, role=?, store_id=?, status=? WHERE id=?').run(
    name ?? cur.name,
    nextRole,
    nextStore,
    nextStatus,
    id
  )
  if (password) {
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(password), id)
  }
  res.json(parseRow(publicRow(id)))
})

// 删除 = 禁用（保留账号与操作记录，避免外键/审计缺口）
router.delete('/:id', (req, res) => {
  const id = +req.params.id
  if (id === req.user.sub) return res.status(400).json({ message: '不能删除当前登录账号' })
  db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(id)
  res.json({ message: '已禁用该账号' })
})

// 重新启用
router.post('/:id/enable', (req, res) => {
  const id = +req.params.id
  db.prepare("UPDATE users SET status='active' WHERE id=?").run(id)
  res.json(parseRow(publicRow(id)))
})

export default router
