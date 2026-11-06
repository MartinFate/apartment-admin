// Express 应用工厂：中间件、路由挂载、可选静态托管前端 dist、错误处理。
import express from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { authRequired } from './auth.js'
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import storeRoutes from './routes/stores.js'
import roomRoutes from './routes/rooms.js'
import tenantRoutes from './routes/tenants.js'
import paymentRoutes from './routes/payments.js'
import reminderRoutes from './routes/reminders.js'
import dashboardRoutes from './routes/dashboard.js'
import uploadRoutes from './routes/uploads.js'
import auditRoutes from './routes/audit.js'
import { auditMiddleware, ensureAuditBaseline } from './lib/audit.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp() {
  const app = express()

  // CORS：默认不开放（留空）。生产用 nginx 同源反代 /api，浏览器本就同源，无需 CORS。
  // 只有显式配置了来源时才注册 cors；仍配置 * 时保留兼容但给出告警。
  const raw = (process.env.CORS_ORIGINS || '').trim()
  if (raw === '*') {
    // eslint-disable-next-line no-console
    console.warn('[安全告警] CORS_ORIGINS=* 允许任意站点跨域调用本 API，请改为具体来源或留空')
    app.use(cors({ origin: '*', credentials: false }))
  } else if (raw) {
    const origins = raw.split(',').map((s) => s.trim()).filter(Boolean)
    app.use(cors({ origin: origins, credentials: false }))
  }
  app.use(express.json({ limit: '20mb' }))

  // 操作日志审计：必须挂在所有 /api 路由之前，才能覆盖登录、附件等全链路。
  // 中间件只记录、不阻断业务；日志写入失败不会影响已完成的响应。
  app.use(auditMiddleware)
  ensureAuditBaseline()

  // 鉴权路由（登录/刷新无需 token）
  app.use('/api/auth', authRoutes)
  // 以下接口均需登录
  app.use('/api/users', authRequired, userRoutes)
  app.use('/api/stores', authRequired, storeRoutes)
  app.use('/api/rooms', authRequired, roomRoutes)
  app.use('/api/tenants', authRequired, tenantRoutes)
  app.use('/api/payments', authRequired, paymentRoutes)
  app.use('/api/reminders', authRequired, reminderRoutes)
  app.use('/api/dashboard', authRequired, dashboardRoutes)
  // 操作日志：仅超级管理员可查询 / 导出（路由内实时回查角色与账号状态）
  app.use('/api/audit', authRequired, auditRoutes)
  // 上传接口：上传 / 删除 / 读取图片（GET）均需登录，附件含身份证等 PII。
  // 前端通过 fetch + Bearer 拉取后转成 blob: URL 再喂给 <img>，避免 token 出现在 URL 里。
  app.use('/api/uploads', uploadRoutes)

  // 可选：直接由后端托管已构建的前端 dist（生产也可用 nginx 托管 + 反代 /api）
  const dist = path.resolve(__dirname, '..', '..', 'dist')
  if (fs.existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^(?!\/api).*/, (req, res) => {
      res.sendFile(path.join(dist, 'index.html'))
    })
  }

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    // eslint-disable-next-line no-console
    console.error('[error]', err)
    res.status(500).json({ message: err.message || '服务器内部错误' })
  })

  return app
}
