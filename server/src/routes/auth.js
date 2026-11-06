import { Router } from 'express'
import db from '../db.js'
import { signToken, verifyPassword, hashPassword, authRequired } from '../auth.js'

const router = Router()

router.post('/login', (req, res) => {
  const { username, password } = req.body || {}
  if (!username || !password) return res.status(400).json({ message: '请输入用户名和密码' })
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username)
  if (!u || !verifyPassword(password, u.password_hash)) {
    return res.status(401).json({ message: '用户名或密码错误' })
  }
  if (u.status !== 'active') return res.status(403).json({ message: '账号已被禁用，请联系管理员' })
  const token = signToken(u)
  res.json({
    token,
    user: { id: u.id, username: u.username, name: u.name, role: u.role, storeId: u.store_id }
  })
})

router.get('/me', authRequired, (req, res) => {
  const u = db
    .prepare('SELECT id, username, name, role, store_id, status FROM users WHERE id=?')
    .get(req.user.sub)
  if (!u) return res.status(401).json({ message: '用户不存在' })
  res.json({ id: u.id, username: u.username, name: u.name, role: u.role, storeId: u.store_id, status: u.status })
})

router.post('/logout', authRequired, (req, res) => res.json({ message: '已退出登录' }))

router.post('/change-password', authRequired, (req, res) => {
  const { oldPassword, newPassword } = req.body || {}
  if (!oldPassword || !newPassword) return res.status(400).json({ message: '请填写原密码和新密码' })
  if (newPassword.length < 6) return res.status(400).json({ message: '新密码至少 6 位' })
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.sub)
  if (!u || !verifyPassword(oldPassword, u.password_hash)) {
    return res.status(400).json({ message: '原密码错误' })
  }
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(newPassword), u.id)
  res.json({ message: '密码已修改，请重新登录' })
})

// 供前端判断当前登录态（可选）
router.get('/ping', authRequired, (req, res) => res.json({ ok: true }))

export default router
