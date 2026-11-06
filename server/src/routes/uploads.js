// 附件上传：身份证正/反面 + 合同扫描件（多张）。
// 图片落盘到 server/uploads/tenants/:tenantId/，tenant.attachments 仅存 {name,url} 元数据。
// 读取需登录（路由已挂 authRequired），保护身份证等 PII。
import { Router } from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import db from '../db.js'
import { authRequired } from '../auth.js'

const router = Router()
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..', '..')
const UPLOAD_DIR = process.env.UPLOAD_DIR
  ? path.resolve(ROOT, process.env.UPLOAD_DIR)
  : path.join(ROOT, 'uploads')
fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// 扩展名白名单：mimetype 由客户端提供、可伪造，落盘扩展名必须强制收敛到图片类型，
// 否则上传伪装成 image/* 的 .html 会被同源 <img>/GET 加载，形成存储型 XSS。
const ALLOWED_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'])
const IMAGE_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
}
const extOf = (name) => (path.extname(name || '') || '').toLowerCase()

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, 'tenants', String(req.params.id))
    fs.mkdirSync(dir, { recursive: true })
    cb(null, dir)
  },
  filename: (req, file, cb) => {
    const ext = ALLOWED_EXT.has(extOf(file.originalname)) ? extOf(file.originalname) : '.jpg'
    const field = file.fieldname === 'contracts' ? 'contract' : file.fieldname
    const stamp = Date.now() + '_' + Math.round(Math.random() * 1e6)
    cb(null, `${field}_${stamp}${ext}`)
  }
})
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype?.startsWith('image/') && ALLOWED_EXT.has(extOf(file.originalname))) {
      cb(null, true)
    } else {
      cb(new Error('仅支持 jpg/png/webp/gif/bmp 图片文件'))
    }
  }
})

function getTenant(id) {
  return db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
}
function readAtt(t) {
  try {
    return JSON.parse(t.attachments || '{}') || {}
  } catch {
    return {}
  }
}
function writeAtt(id, att) {
  db.prepare('UPDATE tenants SET attachments=? WHERE id=?').run(JSON.stringify(att), id)
}

// 上传（可同时带 idCardFront / idCardBack / contracts[]）
router.post(
  '/tenants/:id',
  authRequired,
  upload.fields([
    { name: 'idCardFront', maxCount: 1 },
    { name: 'idCardBack', maxCount: 1 },
    { name: 'contracts', maxCount: 10 }
  ]),
  (req, res) => {
    const id = +req.params.id
    const t = getTenant(id)
    if (!t) return res.status(404).json({ message: '租户不存在' })
    const att = readAtt(t)
    att.idCardFront = att.idCardFront || null
    att.idCardBack = att.idCardBack || null
    att.contracts = Array.isArray(att.contracts) ? att.contracts : []
    const files = req.files || {}
    if (files.idCardFront && files.idCardFront[0]) {
      const f = files.idCardFront[0]
      att.idCardFront = { name: f.originalname, url: `/api/uploads/tenants/${id}/${path.basename(f.path)}` }
    }
    if (files.idCardBack && files.idCardBack[0]) {
      const f = files.idCardBack[0]
      att.idCardBack = { name: f.originalname, url: `/api/uploads/tenants/${id}/${path.basename(f.path)}` }
    }
    if (files.contracts) {
      for (const f of files.contracts) {
        att.contracts.push({ name: f.originalname, url: `/api/uploads/tenants/${id}/${path.basename(f.path)}` })
      }
    }
    writeAtt(id, att)
    res.json({ attachments: att })
  }
)

// 删除某个附件：field = idCardFront | idCardBack | contract（contract 需 ?index=N）
router.delete('/tenants/:id/:field', authRequired, (req, res) => {
  const id = +req.params.id
  const field = req.params.field
  const index = req.query.index !== undefined ? +req.query.index : null
  const t = getTenant(id)
  if (!t) return res.status(404).json({ message: '租户不存在' })
  const att = readAtt(t)
  const unlink = (url) => {
    if (!url) return
    const fp = path.join(UPLOAD_DIR, 'tenants', String(id), path.basename(url))
    try {
      fs.unlinkSync(fp)
    } catch {
      /* 忽略 */
    }
  }
  if (field === 'idCardFront' || field === 'idCardBack') {
    unlink(att[field]?.url)
    att[field] = null
  } else if (field === 'contract') {
    if (index !== null && att.contracts && att.contracts[index]) {
      unlink(att.contracts[index].url)
      att.contracts.splice(index, 1)
    }
  }
  writeAtt(id, att)
  res.json({ attachments: att })
})

// 读取附件图片：需登录（浏览器 <img> 不会附带 Authorization 头，前端改为 fetch + blob: URL 加载）。
// 同时强制按白名单返回图片 Content-Type + nosniff，避免历史/伪造的非图片文件被当作 HTML 执行。
// 身份核验之外还禁止缓存，避免身份证等 PII 落到共享浏览器缓存里。
router.get('/tenants/:id/:filename', authRequired, (req, res) => {
  res.setHeader('Cache-Control', 'no-store')
  const fp = path.join(UPLOAD_DIR, 'tenants', String(req.params.id), path.basename(req.params.filename))
  const type = IMAGE_TYPES[extOf(fp)]
  if (!type || !fs.existsSync(fp)) return res.status(404).json({ message: '文件不存在' })
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.type(type)
  res.sendFile(fp)
})

export default router
