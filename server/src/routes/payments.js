import { Router } from 'express'
import db from '../db.js'
import { parseRow, todayStr, nowHms, nowLocal } from '../lib/helpers.js'
import { applyMeterReadings, calcUtility } from '../lib/utility.js'
import { setAuditDetail } from '../lib/audit.js'

const router = Router()

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

router.get('/', (req, res) => {
  const { storeId, month, keyword } = req.query
  const where = []
  const params = []
  if (storeId) { where.push('store_id=?'); params.push(+storeId) }
  if (month) { where.push("(substr(p.paid_at,1,7)=? OR substr(p.created_at,1,7)=?)"); params.push(month, month) }
  if (keyword) { where.push('(tenant_name LIKE ? OR room_no LIKE ? OR no LIKE ?)'); const kw = `%${keyword}%`; params.push(kw, kw, kw) }
  const sql = `SELECT p.*, s.name AS store_name FROM payments p LEFT JOIN stores s ON s.id = p.store_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.id DESC`
  const rows = db.prepare(sql).all(...params)
  res.json({ list: rows.map(parseRow), total: rows.length })
})

router.post('/', (req, res) => {
  const b = req.body || {}

  // 房间 id：优先前端传，否则从租户反查（按抄表计费需要它取上次读数）
  let roomId = b.roomId ? +b.roomId : null
  if (!roomId && b.tenantId) {
    const t = db.prepare('SELECT room_id FROM tenants WHERE id=?').get(+b.tenantId)
    roomId = t?.room_id || null
  }

  // 房租部分（未单独传 rentAmount 时沿用 amount，兼容旧调用）
  const rentAmount = Number(b.rentAmount ?? b.amount) || 0
  // 水电费明细：水/电各自独立（不计/抄表/包月）
  const u = calcUtility(b, roomId)
  const total = round2(rentAmount + u.waterFee + u.electricityFee)
  if (!total || total <= 0) return res.status(400).json({ message: '请输入收取金额' })

  const no = db.prepare("SELECT no FROM payments WHERE no LIKE 'SF%' ORDER BY id DESC LIMIT 1").get()
  let seq = no && no.no ? parseInt(no.no.slice(2), 10) || 0 : 0
  const payNo = `SF${String(seq + 1).padStart(6, '0')}`
  // 审计明细：单号与计费方式是中间件从请求体里拿不全的业务事实
  setAuditDetail(req, {
    paymentNo: payNo,
    amount: total,
    tenantName: b.tenantName || '',
    roomNo: b.roomNo || '',
    waterMode: u.waterMode,
    electricityMode: u.electricityMode
  })
  // 收款时间：日期取前端所选，时间取北京时间当前时刻（修正时区，保证显示到时分秒）
  const paidAtDate = b.paidAt || todayStr()
  const paidAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(paidAtDate)
    ? paidAtDate
    : `${paidAtDate} ${nowHms()}`
  const info = db
    .prepare(
      `INSERT INTO payments (no, tenant_id, tenant_name, store_id, room_no, amount, paid_at, remark,
        rent_amount, utility_mode, water_mode, electricity_mode,
        rent_old_due, rent_new_due,
        water_reading, water_usage, water_price, water_fee,
        electricity_reading, electricity_usage, electricity_price, electricity_fee, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      payNo,
      b.tenantId || null,
      b.tenantName || '',
      b.storeId || null,
      b.roomNo || '',
      total,
      paidAt,
      b.remark || '',
      rentAmount,
      u.utilityMode,
      u.waterMode,
      u.electricityMode,
      b.rentOldDue || '',
      b.rentNewDue || '',
      u.waterReading,
      u.waterUsage,
      u.waterPrice,
      u.waterFee,
      u.electricityReading,
      u.electricityUsage,
      u.electricityPrice,
      u.electricityFee,
      nowLocal()
    )
  // 按抄表收款后，房间水电表读数推进到本次读数
  applyMeterReadings(roomId, b, b.paidAt || todayStr())
  res.status(201).json(parseRow(db.prepare('SELECT * FROM payments WHERE id=?').get(info.lastInsertRowid)))
})

router.delete('/:id', (req, res) => {
  const id = +req.params.id
  // 硬删除前留存快照：否则记录消失后审计日志里只剩「谁删了一条 ID」，无法回答删了多少钱。
  const cur = db
    .prepare(
      `SELECT id, no, tenant_name, room_no, amount, paid_at, rent_amount,
              rent_old_due, rent_new_due, water_fee, electricity_fee
       FROM payments WHERE id=?`
    )
    .get(id)
  if (cur) {
    setAuditDetail(req, {
      paymentNo: cur.no,
      tenantName: cur.tenant_name,
      roomNo: cur.room_no,
      before: {
        amount: cur.amount,
        paidAt: cur.paid_at,
        rentAmount: cur.rent_amount,
        rentOldDue: cur.rent_old_due,
        rentNewDue: cur.rent_new_due,
        waterFee: cur.water_fee,
        electricityFee: cur.electricity_fee
      },
      notice: '删除收款记录不会回滚水电表读数'
    })
  }
  db.prepare('DELETE FROM payments WHERE id=?').run(id)
  res.json(true)
})

export default router
