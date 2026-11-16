// 本地联调工具：模拟企业微信长连接服务端，验证「群内 @ → 查真实库 → 回复」全链路。
// 生产代码不会加载本文件；仅在已安装 ws（@wecom/aibot-node-sdk 的依赖）的容器/本机可用。
//
// 用法（在 server 目录）：
//   node test/mock-wecom-ws.mjs 8788 '@公寓助手 房态' &
//   DATA_DIR=/tmp/bot-verify-data PORT=3001 WECOM_BOT_WS_URL=ws://127.0.0.1:8788 \
//     WECOM_PUSH_DAILY=0 WECOM_PUSH_EVENTS=0 node src/index.js
//   cat /tmp/wecom-mock.log        # 应看到 SUBSCRIBE / PUSHED / REPLY finish=true / DONE
//
// 该进程不连企微云端，不会与线上服务抢连接，也不会往真实群里发任何消息。
import { WebSocketServer } from 'ws'
import fs from 'node:fs'

const PORT = Number(process.argv[2] || 8788)
const COMMAND = process.argv[3] || '@公寓助手 房态'
const OUT = process.env.MOCK_OUT || '/tmp/wecom-mock.log'
const lines = []
const write = (s) => {
  lines.push(s)
  fs.writeFileSync(OUT, `${lines.join('\n')}\n`)
}

const wss = new WebSocketServer({ port: PORT })

wss.on('connection', (ws) => {
  write('CONNECTED')
  ws.on('message', (raw) => {
    let f
    try { f = JSON.parse(String(raw)) } catch { return }
    const reqId = f.headers?.req_id || ''
    const ack = () => ws.send(JSON.stringify({ headers: { req_id: reqId }, errcode: 0, errmsg: 'ok' }))

    if (f.cmd === 'aibot_subscribe') {
      write(`SUBSCRIBE ${reqId}`)
      ack() // SDK 收到 errcode=0 才触发 authenticated
      setTimeout(() => {
        ws.send(JSON.stringify({
          cmd: 'aibot_msg_callback',
          headers: { req_id: 'mock_msg_1' },
          body: {
            msgid: 'mock-msgid-001',
            aibotid: 'mock-bot',
            chatid: 'mock-chat-1',
            chattype: 'group',
            from: { userid: 'mock-user' },
            msgtype: 'text',
            text: { content: COMMAND }
          }
        }))
        write(`PUSHED ${COMMAND}`)
      }, 150)
      return
    }
    if (f.cmd === 'ping') { ack(); return }
    if (f.cmd === 'aibot_respond_msg') {
      const stream = f.body?.stream
      if (stream) {
        write(`REPLY finish=${stream.finish} bytes=${Buffer.byteLength(stream.content || '', 'utf8')}`)
        write(stream.content || '')
      } else {
        write(`REPLY ${JSON.stringify(f.body)}`)
      }
      ack()
      if (stream?.finish) {
        setTimeout(() => { write('DONE'); wss.close(); process.exit(0) }, 300)
      }
      return
    }
    ack()
  })
})

write(`LISTENING ${PORT}`)
setTimeout(() => { write('TIMEOUT'); process.exit(2) }, 20_000)
