import { Router } from 'express'
import db from '../db.js'
import { todayStr } from '../lib/helpers.js'

const router = Router()

router.get('/summary', (req, res) => {
  const today = new Date(todayStr())
  const stores = db.prepare('SELECT * FROM stores').all()
  const rooms = db.prepare('SELECT * FROM rooms').all()
  const tenants = db.prepare('SELECT * FROM tenants').all()

  const storeCount = stores.length
  const roomCount = rooms.length
  const rented = rooms.filter((r) => r.status === 'rented').length
  const empty = rooms.filter((r) => r.status === 'empty').length
  const tenantCount = tenants.filter((t) => t.status === 'active').length

  const diffDays = (dateStr) => {
    if (!dateStr) return null
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return null
    return (d - today) / 86400000
  }
  const expiringSoon = tenants.filter((t) => {
    const diff = diffDays(t.contract_end)
    return diff !== null && diff >= 0 && diff <= 7
  }).length
  const rentDueSoon = tenants.filter((t) => {
    if (t.status !== 'active') return false
    const diff = diffDays(t.rent_due_date)
    return diff !== null && diff >= 0 && diff <= 7
  }).length

  const storeMap = Object.fromEntries(stores.map((s) => [s.id, s]))
  const storeNameMap = Object.fromEntries(stores.map((s) => [s.id, s.name]))
  const roomMap = Object.fromEntries(rooms.map((r) => [r.id, r]))
  const rentDueList = tenants
    .filter((t) => t.status === 'active' && t.rent_due_date)
    .map((t) => {
      const room = roomMap[t.room_id]
      const store = storeMap[t.store_id]
      return {
        id: t.id,
        name: t.name,
        checkInDate: t.check_in_date,
        storeId: t.store_id,
        storeName: storeNameMap[t.store_id] || '-',
        roomId: t.room_id ?? null,
        roomNo: room ? room.room_no : '-',
        rentDueDate: t.rent_due_date,
        rent: room ? room.rent : 0,
        // 水电表：收缴时可带出上次读数与门店单价，用于按抄表计费
        waterMeter: room ? room.water_meter : 0,
        electricityMeter: room ? room.electricity_meter : 0,
        meterDate: room ? room.meter_date : '',
        waterPrice: store ? store.water_price : 0,
        electricityPrice: store ? store.electricity_price : 0
      }
    })
    .sort((a, b) => new Date(a.rentDueDate) - new Date(b.rentDueDate))

  res.json({
    storeCount,
    roomCount,
    rented,
    empty,
    tenantCount,
    expiringSoon,
    rentDueSoon,
    rentDueList
  })
})

export default router
