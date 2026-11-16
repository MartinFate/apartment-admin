// 服务入口：确保建表+种子，再启动 HTTP 服务。
// 必须在加载 db.js / app.js（它们会读取 process.env）之前先加载 .env
import 'dotenv/config'
import './db.js'
import { createApp } from './app.js'
import { startAuditRetention } from './lib/audit.js'
import { startPushScheduler } from './lib/wecom.js'
import { startWecomBot } from './lib/wecomBot.js'

const PORT = process.env.PORT || 3000
const app = createApp()

// 操作日志保留策略：启动 1 分钟后首次清理，此后每 24 小时一次（不阻止进程退出）
startAuditRetention()

// 企业微信推送：未配置 WECOM_WEBHOOK_URL 时调度器空转，不产生任何网络请求。
// 定时器 unref，不阻止进程退出。
startPushScheduler()

// 企业微信智能机器人（群内 @ 查房态）：长连接为主动出站，无需公网入口。
// 未配置 WECOM_BOT_ID / WECOM_BOT_SECRET 或禁用时内部直接跳过，不产生任何外网请求。
startWecomBot()

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[apartment-admin] 后端已启动：http://localhost:${PORT}`)
})
