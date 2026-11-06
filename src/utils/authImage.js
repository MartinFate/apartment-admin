// 受保护附件的图片加载工具。
//
// 后端 /api/uploads/** 已改为需要 JWT，而浏览器 <img src> / antd a-image / Vant
// ImagePreview 都不会附带 Authorization 头。这里统一用 fetch + Bearer 把图片取成 Blob，
// 再转成同源 blob: URL 供上述组件使用：
//   - token 只出现在请求头，不落到 URL / 日志 / Referer；
//   - 按需加载（打开弹窗/预览时才取），不随列表一次性拉取所有身份证照片；
//   - 同一 url 全局缓存 + 并发去重，重复打开弹窗不会重复下载。
//
// 刻意不依赖 @/api/request（避免与响应拦截器形成循环依赖），401 自行处理。

const blobCache = new Map()
const pending = new Map()
// 每次清空缓存（登录/登出/401）递增；进行中的请求若发现代数已变，就不再把 Blob 写回，
// 避免上一个账号的身份证照片在新会话里残留。
let generation = 0

export function isProtectedImage(url) {
  return typeof url === 'string' && url.startsWith('/api/uploads/')
}

export function clearImageCache() {
  generation += 1
  for (const objectUrl of blobCache.values()) {
    try {
      URL.revokeObjectURL(objectUrl)
    } catch {
      /* 忽略：可能已被浏览器回收 */
    }
  }
  blobCache.clear()
  pending.clear()
}

export async function resolveImage(url) {
  if (!url) return ''
  // 本地 blob: / data: / 外部 http(s) 图片原样返回
  if (!isProtectedImage(url)) return url
  if (blobCache.has(url)) return blobCache.get(url)
  if (pending.has(url)) return pending.get(url)

  const gen = generation
  const task = (async () => {
    const token = localStorage.getItem('ap_token')
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })
    if (res.status === 401) {
      clearImageCache()
      localStorage.removeItem('ap_token')
      localStorage.removeItem('ap_user')
      location.assign('/login')
      throw new Error('登录已过期，请重新登录')
    }
    if (!res.ok) throw new Error(`附件加载失败（HTTP ${res.status}）`)
    const blob = await res.blob()
    // 期间发生了登录/登出/401：丢弃这次结果，不写回缓存
    if (gen !== generation) return ''
    const objectUrl = URL.createObjectURL(blob)
    blobCache.set(url, objectUrl)
    return objectUrl
  })().finally(() => pending.delete(url))

  pending.set(url, task)
  return task
}

// 用于「打开弹窗」这类非关键路径：失败时回退原始 url，
// 保证编辑表单里的附件条目数量/顺序不变（否则删除快照会误判成"用户删了这张"）。
export async function safeResolveImage(url) {
  try {
    return await resolveImage(url)
  } catch {
    return url || ''
  }
}

export function resolveImageList(urls = []) {
  return Promise.all(urls.map(safeResolveImage))
}
