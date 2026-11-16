// 企业微信「智能机器人」长连接接入：群内 @ → 只读房态查询 → 回复到原群。
// 与 wecom.js（群机器人 Webhook 纯出站推送）是两个独立机器人、两套凭证，互不影响。
//
// 设计约束：
//  1. 零公网入口 —— 服务主动出站连 wss://openws.work.weixin.qq.com，内网 LXC 可直接跑；
//  2. 未配置凭证 / SDK 缺失时完全降级，不影响主服务启动与现有业务；
//  3. 只读 —— 只调用 roomQuery.handleQuery，绝不触碰任何写接口；
//  4. 绝不泄露凭证 —— 日志只打事件与命令类型，不打印 secret、消息全文、完整 userid；
//  5. 全量可追溯 —— 每次查询通过 logAudit 落一条审计（含拒绝原因与失败）。
import db from '../db.js'
import { todayStr } from './helpers.js'
import { logAudit } from './audit.js'
import {
  getBotConfig, isAllowed, handleQuery, createDedup, createLimiter
} from './roomQuery.js'

let client = null
let sdk = null
const dedup = createDedup(2000)
const limiter = createLimiter(60_000, 10)

function log(...args) {
  // eslint-disable-next-line no-console
  console.log('[wecom-bot]', ...args)
}
function warn(...args) {
  // eslint-disable-next-line no-console
  console.warn('[wecom-bot]', ...args)
}

function short(v) {
  const s = String(v || '')
  return s ? `${s.slice(0, 8)}…` : '-'
}

function audit({ status = 'success', reason = '', frame, cmd, bytes = 0, detail = '' }) {
  const b = frame?.body || {}
  try {
    logAudit({
      action: 'query',
      module: 'rooms',
      actorId: null,
      actorName: `企微机器人·${short(b.from?.userid)}`,
      actorRole: 'bot',
      targetId: String(b.chatid || ''),
      targetLabel: cmd?.kind || 'unknown',
      method: 'WECOM_BOT',
      path: 'wecom://group/room-query',
      status,
      statusCode: status === 'success' ? 200 : 403,
      detail: detail || JSON.stringify({
        chatid: short(b.chatid),
        command: cmd?.kind || 'unknown',
        arg: cmd?.arg || '',
        replyBytes: bytes,
        reason
      })
    })
  } catch (e) {
    warn('审计写入失败：', e.message)
  }
}

// SDK 是可选依赖：CJS / ESM 双格式，动态 import 后兼容两种导出形态。
async function loadSdk() {
  const mod = await import('@wecom/aibot-node-sdk')
  const ns = mod.default && typeof mod.default === 'object' ? mod.default : mod
  const WSClient = mod.WSClient || ns.WSClient
  const generateReqId = mod.generateReqId || ns.generateReqId
  if (typeof WSClient !== 'function') throw new Error('SDK 未导出 WSClient')
  return {
    WSClient,
    generateReqId: typeof generateReqId === 'function'
      ? generateReqId
      : (p = 'stream') => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  }
}

// 一次性结果也走官方推荐的流式通道：先发「正在查询」占位，再以 finish=true 覆盖为最终结果。
// 这样企微端显示为同一条消息的更新，不会出现两条刷屏。
async function replyMarkdown(frame, content) {
  if (!client) return
  const streamId = sdk.generateReqId('stream')
  try {
    await client.replyStream(frame, streamId, '正在查询房态…', false)
  } catch (e) {
    warn('占位帧发送失败（继续发送结果）：', e?.message || String(e))
  }
  await client.replyStream(frame, streamId, content, true)
}

async function onTextFrame(frame) {
  const b = frame?.body || {}
  const cfg = getBotConfig()
  const text = String(b.text?.content || '')
  const cmd = { kind: 'unknown', arg: '' }

  const gate = isAllowed(frame, cfg)
  if (!gate.ok) {
    audit({ status: 'denied', reason: gate.reason, frame, cmd })
    log('拒绝查询：', gate.reason, 'chatid=', b.chatid || '-')
    return
  }

  // 企微可能因网络重复推送同一 msgid，必须排重，否则群里会收到两条一样的答案。
  const msgid = String(b.msgid || '')
  if (msgid && !dedup.check(msgid)) {
    log('重复回调已跳过 msgid=', short(msgid))
    return
  }

  limiter.setLimit(cfg.rateLimit, cfg.rateWindowMs)
  if (!limiter.check(String(b.chatid || 'default'))) {
    audit({ status: 'denied', reason: '查询过于频繁', frame, cmd })
    log('限流拦截 chatid=', b.chatid || '-')
    return
  }

  try {
    const result = handleQuery({ text, database: db, today: todayStr(), cfg })
    if (!result.reply) {
      log('未识别命令，未回复 chatid=', b.chatid || '-')
      return
    }
    await replyMarkdown(frame, result.reply)
    audit({ frame, cmd: result.command, bytes: Buffer.byteLength(result.reply, 'utf8') })
    // 打印完整 chatid 便于运维回填 WECOM_BOT_ALLOWED_CHATS 收紧白名单；userid 仍只打前缀。
    log('已回复 cmd=', result.command.kind, 'chatid=', b.chatid || '-',
      'user=', short(b.from?.userid), 'bytes=', Buffer.byteLength(result.reply, 'utf8'))
  } catch (e) {
    warn('查询或回复失败：', e?.message || String(e))
    audit({ status: 'fail', reason: String(e?.message || e).slice(0, 200), frame, cmd })
    try {
      await replyMarkdown(frame, '**查询失败**\n> 房态数据暂时无法读取，请稍后重试或登录系统查看')
    } catch {
      // 回复失败只记日志，绝不抛出到事件循环
    }
  }
}

export function startWecomBot() {
  const cfg = getBotConfig()
  if (!cfg.enabled) {
    log('未配置 WECOM_BOT_ID / WECOM_BOT_SECRET 或已禁用，群内查询不启动（不影响 L1 推送）')
    return null
  }

  limiter.setLimit(cfg.rateLimit, cfg.rateWindowMs)
  // 动态 import：依赖缺失时只告警，主服务照常提供 HTTP 与现有推送。
  loadSdk()
    .then((loaded) => {
      sdk = loaded
      client = new sdk.WSClient({
        botId: cfg.botId,
        secret: cfg.secret,
        ...(cfg.wsUrl ? { wsUrl: cfg.wsUrl } : {}), // 联调时指向本地 mock，生产走官方 wss
        maxReconnectAttempts: -1, // 常驻服务：无限重连，由 systemd 保证进程存活
        heartbeatInterval: 30_000,
        logger: {
          debug: () => {},
          info: (m) => log(m),
          warn: (m) => warn(m),
          error: (m) => warn(m)
        }
      })

      client.on('connected', () => log('WebSocket 已连接'))
      client.on('authenticated', () => {
        log('认证成功，群内房态查询已就绪')
        // 可选：配置了目标会话时主动推一条上线通知，用于部署自检。
        if (cfg.testChat) {
          client.sendMessage(cfg.testChat, {
            msgtype: 'markdown',
            markdown: { content: '**公寓房态助手已上线**\n> 在群里 @ 我并输入 `房态` 即可查询' }
          }).then(() => log('上线通知已推送')).catch((e) => warn('上线通知推送失败：', e?.message || String(e)))
        }
      })
      client.on('disconnected', (reason) => warn('连接断开：', reason || ''))
      client.on('reconnecting', (n) => warn('正在重连，第', n, '次'))
      client.on('error', (e) => warn('SDK 错误：', e?.message || String(e)))
      client.on('message.text', (frame) => { onTextFrame(frame).catch((e) => warn('消息处理异常：', e?.message || String(e))) })
      // 非文本消息（图片 / 文件 / 语音）一律忽略，不下载、不解密、不留痕到业务数据。
      client.connect()
      log('正在建立长连接…')
    })
    .catch((e) => {
      warn('SDK 加载失败，群内查询不可用：', e?.message || String(e))
      warn('请在 server 目录执行 npm install 安装 @wecom/aibot-node-sdk 后重启服务')
    })

  const shutdown = () => {
    try { client?.disconnect() } catch { /* 忽略退出时的断连异常 */ }
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
  return true
}

export function botStatus() {
  return {
    enabled: getBotConfig().enabled,
    connected: Boolean(client?.isConnected),
    sdkLoaded: Boolean(sdk)
  }
}
