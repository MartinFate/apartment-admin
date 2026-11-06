// 纯日期（YYYY-MM-DD）工具。
// 目的：绕开 new Date('YYYY-MM-DD') 按 UTC 解析、setMonth() 在月末溢出（1/31 → 3/3）
// 这两类经典问题。全程按「字符串分量 + 本地日历」计算，与浏览器/服务器时区无关。

const pad2 = (n) => String(n).padStart(2, '0')

// 本地日期字符串（浏览器本地时区的今天）
export function localDateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

// 目标年月的天数（month 取 1~12）
export function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/**
 * 日期加 N 个自然月；若「日」超过目标月天数，则夹取到该月最后一天。
 * 例：2026-01-31 +1 → 2026-02-28；2026-12-31 +1 → 2027-01-31。
 * @param {string} dateStr YYYY-MM-DD（也兼容带时分秒的字符串，只取前 10 位）
 * @param {number} months 可为负数
 * @returns {string} YYYY-MM-DD；入参非法返回 ''
 */
export function addMonths(dateStr, months = 1) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr || '').trim())
  if (!m) return ''
  const day = Number(m[3])
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + months
  const y = Math.floor(total / 12)
  const mo = (total % 12) + 1
  return `${y}-${pad2(mo)}-${pad2(Math.min(day, daysInMonth(y, mo)))}`
}

/**
 * 房租到期顺延：base = max(本期到期日, 今天) + 1 个自然月。
 * 纯字符串比较（YYYY-MM-DD 字典序即时间序），避免 Date 对象时区问题。
 */
export function nextDueDate(oldDue, today = localDateStr()) {
  const t = String(today).slice(0, 10)
  const o = oldDue ? String(oldDue).slice(0, 10) : ''
  const base = o && o >= t ? o : t
  return addMonths(base, 1)
}
