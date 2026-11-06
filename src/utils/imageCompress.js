// 手机原图常 2~5MB，直接上传又慢又占空间，还容易撞上请求体上限。
// 上传前先压到长边 1280、JPEG 质量 0.75，实测 3MB 照片 -> 150~250KB。
const MAX_EDGE = 1280
const QUALITY = 0.75
// 压缩后体积小于这个值就认为够小了，不必再压
const SKIP_SIZE = 400 * 1024

export function formatSize(bytes) {
  if (!bytes) return '0KB'
  if (bytes < 1024) return bytes + 'B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + 'KB'
  return (bytes / 1024 / 1024).toFixed(1) + 'MB'
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片读取失败'))
    }
    img.src = url
  })
}

function toBlob(canvas, quality) {
  return new Promise((resolve) => {
    if (canvas.toBlob) {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
    } else {
      resolve(null)
    }
  })
}

// 传入原图 File，返回压缩后的 File；任何环节失败都安全回退为原图
export async function compressImage(file, opts = {}) {
  const maxEdge = opts.maxEdge || MAX_EDGE
  const quality = opts.quality || QUALITY
  if (!file || !file.type || !file.type.startsWith('image/')) return file

  try {
    // GIF 压缩后会丢动画，且我们只存证件/合同照片，直接跳过
    if (file.type === 'image/gif') return file

    const img = await loadImage(file)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return file

    const scale = Math.min(1, maxEdge / Math.max(w0, h0))
    if (scale >= 1 && file.size <= SKIP_SIZE) return file

    const w = Math.round(w0 * scale)
    const h = Math.round(h0 * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    // JPEG 没有透明通道，先铺白底避免透明区域变黑
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)

    const blob = await toBlob(canvas, quality)
    if (!blob || blob.size >= file.size) return file

    const name = file.name.replace(/\.\w+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
