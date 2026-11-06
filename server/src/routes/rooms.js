import { Router } from 'express'
import db from '../db.js'
import { parseRow, nowLocal } from '../lib/helpers.js'

const router = Router()

router.get('/', (req, res) => {
  const { storeId, status, keyword } = req.query
  const where = []
  const params = []
  if (storeId) { where.push('store_id=?'); params.push(+storeId) }
  if (status) { where.push('status=?'); params.push(status) }
  if (keyword) { where.push('room_no LIKE ?'); params.push(`%${keyword}%`) }
  const sql = `SELECT * FROM rooms ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY store_id, room_no`
  const rows = db.prepare(sql).all(...params)
  // 当前在住人：取每个房间下 status='active' 的租户姓名（退房后租户变为 left，故在住人为空）
  const residents = db
    .prepare("SELECT room_id, name FROM tenants WHERE status='active' AND room_id IS NOT NULL")
    .all()
  const residentMap = Object.fromEntries(residents.map((r) => [r.room_id, r.name]))
  const list = rows.map((row) => {
    const o = parseRow(row)
    o.resident = residentMap[o.id] || ''
    return o
  })
  res.json({ list, total: list.length })
})

router.post('/', (req, res) => {
  const { storeId, roomNo, floor, area, type, rent, deposit, status, waterMeter, electricityMeter, meterDate } = req.body || {}
  if (!storeId || !roomNo) return res.status(400).json({ message: '门店与房号必填' })
  const info = db
    .prepare(
      'INSERT INTO rooms (store_id, room_no, floor, area, type, rent, deposit, status, water_meter, electricity_meter, meter_date, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(+storeId, roomNo, floor || 0, area || 0, type || '', rent || 0, deposit || 0, status || 'empty', waterMeter || 0, electricityMeter || 0, meterDate || '', nowLocal())
  res.status(201).json(parseRow(db.prepare('SELECT * FROM rooms WHERE id=?').get(info.lastInsertRowid)))
})

router.put('/:id', (req, res) => {
  const id = +req.params.id
  const { storeId, roomNo, floor, area, type, rent, deposit, status, waterMeter, electricityMeter, meterDate } = req.body || {}
  const cur = db.prepare('SELECT * FROM rooms WHERE id=?').get(id)
  if (!cur) return res.status(404).json({ message: '房源不存在' })
  db.prepare('UPDATE rooms SET store_id=?, room_no=?, floor=?, area=?, type=?, rent=?, deposit=?, status=?, water_meter=?, electricity_meter=?, meter_date=? WHERE id=?').run(
    storeId ? +storeId : cur.store_id,
    roomNo ?? cur.room_no,
    floor ?? cur.floor,
    area ?? cur.area,
    type ?? cur.type,
    rent ?? cur.rent,
    deposit ?? cur.deposit,
    status ?? cur.status,
    waterMeter ?? cur.water_meter,
    electricityMeter ?? cur.electricity_meter,
    meterDate ?? cur.meter_date,
    id
  )
  res.json(parseRow(db.prepare('SELECT * FROM rooms WHERE id=?').get(id)))
})

router.delete('/:id', (req, res) => {
  const id = +req.params.id
  // 有在住租户时禁止删除，避免租户的 room_id 悬空、房态统计错乱
  const occupied = db
    .prepare("SELECT 1 FROM tenants WHERE room_id=? AND status='active' LIMIT 1")
    .get(id)
  if (occupied) return res.status(400).json({ message: '该房间有在住租户，请先办理退房再删除' })
  // 历史租户不再指向已删除房间（避免悬空引用）
  db.prepare('UPDATE tenants SET room_id=NULL WHERE room_id=?').run(id)
  db.prepare('DELETE FROM rooms WHERE id=?').run(id)
  res.json(true)
})

export default router
