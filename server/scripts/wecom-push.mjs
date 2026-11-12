// 企微推送运维脚本（在 server/ 目录下或任意目录均可运行，自动读取 server/.env）。
//   node scripts/wecom-push.mjs --dry-run   只打印「每日待办」内容，不联网、不写库
//   node scripts/wecom-push.mjs --test      发一条测试消息到群里（可重复执行）
//   node scripts/wecom-push.mjs             立即推当日汇总（当天已推过会自动跳过）
import { config } from 'dotenv'
import { fileURLToPath } from 'node:url'
import { pushDaily, pushMessage, buildEventContent, getConfig, isValidWebhook } from '../src/lib/wecom.js'

config({ path: fileURLToPath(new URL('../.env', import.meta.url)) })

const args = process.argv.slice(2)
const cfg = getConfig()

if (args.includes('--dry-run')) {
  const r = await pushDaily({ dryRun: true })
  console.log('===== 每日待办预览（未发送）=====')
  console.log(r.content)
  process.exit(0)
}

if (!isValidWebhook(cfg.url)) {
  console.error('尚未配置 WECOM_WEBHOOK_URL，或地址格式不正确。')
  console.error('请在 server/.env 填入企微群机器人的完整 Webhook 地址，然后执行：systemctl restart apartment-admin')
  process.exit(1)
}

if (args.includes('--test')) {
  const r = await pushMessage({
    kind: 'event',
    dedupKey: `test:${Date.now()}`,
    title: 'test',
    content: buildEventContent('test')
  })
  console.log(r.ok ? '测试消息已发送，请查看企微群。' : `发送失败：${r.error}`)
  process.exit(r.ok ? 0 : 1)
}

const r = await pushDaily()
if (r.ok) console.log('每日汇总已发送。')
else if (r.skipped) console.log(`未发送：${r.error}`)
else console.log(`发送失败：${r.error}`)
process.exit(r.ok || r.skipped ? 0 : 1)
