// 鉴权：bcrypt 密码哈希 + JWT 签发/校验 + 路由鉴权中间件。
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import db from './db.js'

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

// JWT 仅证明「曾通过登录」，不证明账号现在仍可用。7 天有效期里管理员可能已禁用账号、
// 改其角色或删号，因此每个请求都实时回查 users 表：
//   - 账号被删/禁用 → 立即失效，旧 token 不能再访问任何接口；
//   - 角色以库里的最新值为准覆盖 token 快照，降权即时生效，不必等 token 过期。
// 管理员禁用某人后无需等 7 天，这是多人使用前必须补的一环。
export function authRequired(req, res, next) {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!token) return res.status(401).json({ message: '未登录或登录已过期' })

  let claims
  try {
    claims = jwt.verify(token, SECRET)
  } catch {
    return res.status(401).json({ message: '登录已过期，请重新登录' })
  }

  // 先临时放上 token 里的身份，便于失败响应也能被审计记录到「谁在尝试访问」。
  req.user = { ...claims }
  const u = db
    .prepare('SELECT id, username, name, role, store_id, status FROM users WHERE id=?')
    .get(claims.sub)
  if (!u) {
    delete req.user
    return res.status(401).json({ message: '账号不存在，请重新登录' })
  }
  if (u.status !== 'active') {
    req.user.role = u.role // 审计里仍按库中真实角色记录
    return res.status(403).json({ message: '账号已被禁用，请联系管理员' })
  }

  // 以数据库为准刷新身份快照；requireRole 依赖这里的 role 而非 token 里的旧值。
  req.user = {
    sub: u.id,
    id: u.id,
    username: u.username,
    name: u.name,
    role: u.role,
    storeId: u.store_id,
    status: u.status
  }
  next()
}

// 角色校验中间件工厂：必须挂在 authRequired 之后，依赖其写入的 req.user.role（实时值）。
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: '无权限执行该操作' })
    }
    next()
  }
}
