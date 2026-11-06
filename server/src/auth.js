// 鉴权：bcrypt 密码哈希 + JWT 签发/校验 + 路由鉴权中间件。
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'

const DEFAULT_SECRET = 'apartment-dev-secret-change-me'
const configured = (process.env.JWT_SECRET || '').trim()
// 绝不回退到可猜测的固定密钥：未配置（或仍是示例值）时改用进程内随机密钥。
// 这样即使 .env 漏配，攻击者也无法伪造 JWT；代价是重启后旧 token 失效，
// 而 deploy.sh 会自动把随机密钥持久化到 .env，生产环境不会触发这种情况。
const SECRET =
  configured && configured !== DEFAULT_SECRET ? configured : crypto.randomBytes(32).toString('hex')
const EXPIRES_IN = '7d'

if (!configured || configured === DEFAULT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    '[安全告警] JWT_SECRET 未配置或仍为示例值，本次启动使用临时随机密钥（重启后需重新登录）；请在 server/.env 中配置随机长字符串'
  )
}

export function hashPassword(p) {
  return bcrypt.hashSync(p, 10)
}
export function verifyPassword(p, hash) {
  return bcrypt.compareSync(p, hash)
}
export function signToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, role: user.role, name: user.name },
    SECRET,
    { expiresIn: EXPIRES_IN }
  )
}

// 路由鉴权中间件：要求 Authorization: Bearer <token>
export function authRequired(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return res.status(401).json({ message: '未登录或登录已过期' })
  try {
    req.user = jwt.verify(token, SECRET)
    next()
  } catch {
    res.status(401).json({ message: '登录已过期，请重新登录' })
  }
}

// 角色校验中间件工厂（阶段二启用 RBAC 时使用）
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: '无权限执行该操作' })
    }
    next()
  }
}
