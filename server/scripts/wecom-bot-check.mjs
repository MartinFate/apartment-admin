// 群内房态查询自检：不联网、不发消息，用真实 SQLite 渲染一次答案。
// 用法（在 server 目录执行）：
//   node scripts/wecom-bot-check.mjs            # 默认渲染「房态」总览
//   node scripts/wecom-bot-check.mjs 空房
//   node scripts/wecom-bot-check.mjs 604
// 用于确认数据库连接、SQL 口径与消息文案；长连接认证状态请看服务日志 journalctl。
import 'dotenv/config'
import db from '../src/db.js'
import { todayStr } from '../src/lib/helpers.js'
import { getBotConfig, handleQuery } from '../src/lib/roomQuery.js'

const cmd = process.argv[2] || '房态'
const cfg = getBotConfig()
console.log('配置：BotID =', cfg.botId ? '已设置' : '未设置',
  '/ Secret =', cfg.secret ? '已设置' : '未设置',
  '/ 启用 =', cfg.enabled)
console.log('北京时间：', todayStr())
console.log('命令：', cmd)
console.log('---- 将要回复到群里的 markdown ----')
try {
  const { command, snapshot, reply } = handleQuery({ text: cmd, database: db, today: todayStr(), cfg })
  console.log(reply || '（该命令不产生回复）')
  console.log('---- 快照 ----')
  console.log(`房间 ${snapshot.total} 间 / 空房 ${snapshot.counts.empty} / 在住 ${snapshot.counts.rented} / 待清扫 ${snapshot.counts.cleaning}`)
  console.log(`命令类型 ${command.kind} / 回复 ${Buffer.byteLength(reply, 'utf8')} 字节`)
} catch (e) {
  console.error('自检失败：', e?.message || String(e))
  process.exitCode = 1
}
