// SQL 形状离线单测：静态核对改写过的路由里，INSERT 的列数 / VALUES 占位符数 / .run() 实参数量一致。
// 背景：node --check 只查 JS 语法，查不出「23 列写了 22 个 ?」这类 SQL 参数错位；
// 这类错误只在真实请求触发该分支时才暴露。本测试纯文本解析、零依赖、无需数据库。
// 运行：node server/test/sqlshape.unit.test.mjs
import fs from 'node:fs'

// 相对本文件（server/test/）的路径：上两级到 server/
const files = [
  '../src/routes/payments.js',
  '../src/routes/tenants.js',
  '../src/routes/rooms.js',
  '../src/routes/users.js'
]

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) { pass += 1; console.log('PASS', name) }
  else { fail += 1; console.log('FAIL', name, extra) }
}

// 按顶层逗号切分参数列表（忽略括号/字符串内部的逗号）
function splitTop(src) {
  const out = []
  let depth = 0
  let quote = null
  let buf = ''
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quote) {
      buf += c
      if (c === quote && src[i - 1] !== '\\') quote = null
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; buf += c; continue }
    if (c === '(' || c === '[') { depth++; buf += c; continue }
    if (c === ')' || c === ']') { depth--; buf += c; continue }
    if (c === ',' && depth === 0) { out.push(buf.trim()); buf = ''; continue }
    buf += c
  }
  if (buf.trim()) out.push(buf.trim())
  return out.filter(Boolean)
}

let insertCount = 0
for (const f of files) {
  const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8')
  // 匹配 INSERT INTO t (cols) VALUES (?,...) 后紧跟 .run(...)
  const re = /INSERT INTO\s+(\w+)\s*\(([\s\S]*?)\)\s*VALUES\s*\(([^)]*)\)`?\s*\)\s*\.run\(([\s\S]*?)\n\s*\)/g
  let m
  while ((m = re.exec(src))) {
    insertCount++
    const line = src.slice(0, m.index).split('\n').length
    const cols = splitTop(m[2]).length
    const q = (m[3].match(/\?/g) || []).length
    const args = splitTop(m[4]).length
    ok(`${f}:${line} ${m[1]} 列/占位符/参数一致 (${cols}/${q}/${args})`,
      cols === q && q === args, `cols=${cols} q=${q} args=${args}`)
  }
}
ok('已覆盖全部改写过的 INSERT 语句', insertCount >= 4, `实际扫描到 ${insertCount} 条`)
console.log(`\n${pass} PASS / ${fail} FAIL`)
process.exit(fail ? 1 : 0)
