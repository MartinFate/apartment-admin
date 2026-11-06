// 服务入口：确保建表+种子，再启动 HTTP 服务。
// 必须在加载 db.js / app.js（它们会读取 process.env）之前先加载 .env
import 'dotenv/config'
import './db.js'
import { createApp } from './app.js'
import { startAuditRetention } from './lib/audit.js'

const PORT = process.env.PORT || 3000
const app = createApp()

// 操作日志保留策略：启动 1 分钟后首次清理，此后每 24 小时一次（不阻止进程退出）
startAuditRetention()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[apartment-admin] 后端已启动：http://localhost:${PORT}`)
})
