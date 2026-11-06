import request from './request'
import { clearImageCache } from '@/utils/authImage'

function toQuery(params = {}) {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.append(k, String(v))
  }
  return u.toString()
}

// 导出走 fetch + Bearer → blob：<a href> 不带 token 会被后端 401 拦截。
// 与附件图片同一套模式（src/utils/authImage.js）。
async function downloadCsv(params = {}) {
  const token = localStorage.getItem('ap_token') || ''
  const q = toQuery(params)
  const res = await fetch(`/api/audit/export${q ? '?' + q : ''}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
  if (res.status === 401) {
    clearImageCache()
    localStorage.removeItem('ap_token')
    localStorage.removeItem('ap_user')
    location.href = '/login'
    throw new Error('登录已过期，请重新登录')
  }
  if (!res.ok) {
    let msg = `导出失败（${res.status}）`
    try {
      const d = await res.json()
      if (d?.message) msg = d.message
    } catch {
      /* 忽略非 JSON 响应 */
    }
    throw new Error(msg)
  }
  const blob = await res.blob()
  const href = URL.createObjectURL(blob)
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const a = document.createElement('a')
  a.href = href
  a.download = `操作日志-${stamp}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 1000)
}

export const auditApi = {
  meta: () => request.get('/audit/meta'),
  list: (params = {}) => request.get('/audit/logs', { params }),
  exportCsv: downloadCsv
}
