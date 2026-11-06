import { Router } from 'express'
import db from '../db.js'
import { nextStoreCode, parseRow, nowLocal } from '../lib/helpers.js'

const router = Router()

router.get('/', (req, res) => {
  const { keyword } = req.query
  let rows
  if (keyword) {
    const kw = `%${keyword}%`
    rows = db
      .prepare('SELECT * FROM stores WHERE name LIKE ? OR manager LIKE ? OR phone LIKE ? ORDER BY id')
      .all(kw, kw, kw)
  } else {
    rows = db.prepare('SELECT * FROM stores ORDER BY id').all()
  }
  res.json({ list: rows.map(parseRow), total: rows.length })
})

router.post('/', (req, res) => {
  const { code, name, address, manager, phone, status, waterPrice, electricityPrice } = req.body || {}
  if (!name) return res.status(400).json({ message: '门店名称必填' })
  const finalCode = code && String(code).trim() ? code : nextStoreCode()
  if (db.prepare('SELECT 1 FROM stores WHERE code=?').get(finalCode)) {
    return res.status(409).json({ message: '门店编号已存在' })
  }
  const info = db
    .prepare(
      'INSERT INTO stores (code, name, address, manager, phone, status, water_price, electricity_price, created_at) VALUES (?,?,?,?,?,?,?,?,?)'
    )
    .run(finalCode, name, address || '', manager || '', phone || '', status || 'active', waterPrice || 0, electricityPrice || 0, nowLocal())
  res.status(201).json(parseRow(db.prepare('SELECT * FROM stores WHERE id=?').get(info.lastInsertRowid)))
})

router.put('/:id', (req, res) => {
  const id = +req.params.id
  const { code, name, address, manager, phone, status, waterPrice, electricityPrice } = req.body || {}
  const cur = db.prepare('SELECT * FROM stores WHERE id=?').get(id)
  if (!cur) return res.status(404).json({ message: '门店不存在' })
  db.prepare('UPDATE stores SET code=?, name=?, address=?, manager=?, phone=?, status=?, water_price=?, electricity_price=? WHERE id=?').run(
    code ?? cur.code,
    name ?? cur.name,
    address ?? cur.address,
    manager ?? cur.manager,
    phone ?? cur.phone,
    status ?? cur.status,
    waterPrice ?? cur.water_price,
    electricityPrice ?? cur.electricity_price,
    id
  )
  res.json(parseRow(db.prepare('SELECT * FROM stores WHERE id=?').get(id)))
})

router.delete('/:id', (req, res) => {
  const id = +req.params.id
  // 门店下仍有房源/租户时禁止删除，避免产生悬空的 store_id（列表 join 后会显示空门店）
  const rooms = db.prepare('SELECT COUNT(*) AS c FROM rooms WHERE store_id=?').get(id).c
  const tenants = db.prepare('SELECT COUNT(*) AS c FROM tenants WHERE store_id=?').get(id).c
  if (rooms || tenants) {
    return res
      .status(400)
      .json({ message: `该门店下还有 ${rooms} 间房源、${tenants} 条租户记录，请先转移或清理后再删除` })
  }
  db.prepare('DELETE FROM stores WHERE id=?').run(id)
  res.json(true)
})

export default router
