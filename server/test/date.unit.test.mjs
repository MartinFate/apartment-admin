// 房租到期日顺延离线单测：验证「逾期缴费不改变每月固定到期日」。
// 前后端两份 nextDueDate 必须保持同一口径；后端 helpers.js 用模块钩子桩掉 db.js。
// 运行：node server/test/date.unit.test.mjs
import { registerHooks } from 'node:module'

const STUB = `
export default {
  prepare: () => ({ run: () => ({}), get: () => undefined, all: () => [] })
}
`
registerHooks({
  resolve(spec, ctx, next) {
    if (spec.endsWith('db.js')) {
      return { url: 'data:text/javascript,' + encodeURIComponent(STUB), shortCircuit: true }
    }
    return next(spec, ctx)
  }
})

const fe = await import(new URL('../../src/utils/date.js', import.meta.url).href)
const be = await import(new URL('../src/lib/helpers.js', import.meta.url).href)

let pass = 0
let fail = 0
function ok(name, cond, extra = '') {
  if (cond) {
    pass += 1
    console.log('PASS', name)
  } else {
    fail += 1
    console.error('FAIL', name, extra)
  }
}

// ---- 核心回归：11-06 到期、11-09 才缴，仍应顺延到 12-06 ----
for (const [label, fn] of [['前端', fe.nextDueDate], ['后端', be.nextDueDate]]) {
  ok(`${label}：逾期 3 天缴费仍保持每月 6 号锚点`,
    fn('2026-11-06', '2026-11-09') === '2026-12-06', fn('2026-11-06', '2026-11-09'))
  ok(`${label}：当天缴费保持锚点`,
    fn('2026-11-06', '2026-11-06') === '2026-12-06')
  ok(`${label}：提前缴费保持锚点`,
    fn('2026-11-06', '2026-11-01') === '2026-12-06')
  ok(`${label}：跨年保持锚点`,
    fn('2026-12-06', '2026-12-20') === '2027-01-06')
  ok(`${label}：无到期日（首次收款）以今天为基准`,
    fn('', '2026-11-09') === '2026-12-09')
  ok(`${label}：到期日为 null 以今天为基准`,
    fn(null, '2026-11-09') === '2026-12-09')
  ok(`${label}：逾期超过一期不自动补期，交管理员手改`,
    fn('2026-09-06', '2026-11-09') === '2026-10-06')
}

// ---- addMonths 月末夹取（前端纯函数）----
ok('1/31 +1 → 2/28（2026 平年）', fe.addMonths('2026-01-31', 1) === '2026-02-28')
ok('1/31 +1 → 2/29（2028 闰年）', fe.addMonths('2028-01-31', 1) === '2028-02-29')
ok('12/31 跨年 → 次年 1/31', fe.addMonths('2026-12-31', 1) === '2027-01-31')
ok('负数月：3/31 -1 → 2/28', fe.addMonths('2026-03-31', -1) === '2026-02-28')
ok('带时分秒只取前 10 位', fe.addMonths('2026-11-06 08:30:00', 1) === '2026-12-06')
ok('非法日期返回空串', fe.addMonths('', 1) === '' && fe.addMonths('not-a-date', 1) === '')
ok('daysInMonth：2026-02=28 / 2028-02=29',
  fe.daysInMonth(2026, 2) === 28 && fe.daysInMonth(2028, 2) === 29)

console.log(`\n结果：${pass} PASS / ${fail} FAIL`)
process.exit(fail === 0 ? 0 : 1)
