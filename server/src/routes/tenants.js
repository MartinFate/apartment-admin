import { Router } from 'express'
import db from '../db.js'
import { syncRoomStatus, parseRow, todayStr, nowHms, nowLocal } from '../lib/helpers.js'
import { applyMeterReadings, calcUtility } from '../lib/utility.js'
import { setAuditDetail } from '../lib/audit.js'

const router = Router()

function roomNoOf(roomId) {
  if (!roomId) return ''
  return db.prepare('SELECT room_no FROM rooms WHERE id=?').get(roomId)?.room_no || ''
}

router.get('/', (req, res) => {
  const { storeId, status, keyword } = req.query
  const where = []
  const params = []
  if (storeId) { where.push('store_id=?'); params.push(+storeId) }
  if (status) { where.push('status=?'); params.push(status) }
  if (keyword) { where.push('(name LIKE ? OR phone LIKE ?)'); const kw = `%${keyword}%`; params.push(kw, kw) }
  const sql = `SELECT * FROM tenants ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC`
  const rows = db.prepare(sql).all(...params)
  res.json({ list: rows.map(parseRow), total: rows.length })
})

router.post('/', (req, res) => {
  const b = req.body || {}
  if (!b.name) return res.status(400).json({ message: '姓名必填' })
  if (!b.storeId) return res.status(400).json({ message: '请选择门店' })
  if (!b.roomId) return res.status(400).json({ message: '请选择入住房间' })
  if (b.status !== 'left') {
    const occupied = db
      .prepare("SELECT 1 FROM tenants WHERE room_id=? AND status='active' LIMIT 1")
      .get(+b.roomId)
    if (occupied) return res.status(400).json({ message: '该房间已有在住租户，不能重复入住' })
  }
  const info = db
    .prepare(
      `INSERT INTO tenants (name, phone, id_card, store_id, room_id, check_in_date, contract_end, rent_due_date, deposit, rent, status, attachments, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      b.name,
      b.phone || '',
      b.idCard || '',
      +b.storeId,
      b.roomId ? +b.roomId : null,
      b.checkInDate || '',
      b.contractEnd || '',
      b.rentDueDate || '',
      b.deposit ? +b.deposit : 0,
      b.rent ? +b.rent : 0,
      b.status || 'active',
      JSON.stringify(b.attachments || {}),
      nowLocal()
    )
  const newId = info.lastInsertRowid
  syncRoomStatus(b.roomId ? +b.roomId : null)
  // 新办理入住：自动生成首期房租收款记录（编辑 PUT 不触发此逻辑）
  const rentAmount = b.rent ? +b.rent : 0
  if (rentAmount > 0) {
    const lastPay = db.prepare("SELECT no FROM payments WHERE no LIKE 'SF%' ORDER BY id DESC LIMIT 1").get()
    const seq = lastPay && lastPay.no ? parseInt(lastPay.no.slice(2), 10) || 0 : 0
    const firstPayNo = `SF${String(seq + 1).padStart(6, '0')}`
    // 收款时间取实际录入时间（今天，北京时间带时分秒）；房租覆盖区间：起=入住日，止=房租到期日
    db.prepare(
      `INSERT INTO payments (no, tenant_id, tenant_name, store_id, room_no, amount, paid_at, remark,
        rent_amount, rent_old_due, rent_new_due, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      firstPayNo,
      newId,
      b.name,
      +b.storeId,
      roomNoOf(b.roomId ? +b.roomId : null),
      rentAmount,
      nowLocal(),
      '入住首期房租',
      rentAmount,
      b.checkInDate || '',
      b.rentDueDate || '',
      nowLocal()
    )
    setAuditDetail(req, {
      firstPaymentNo: firstPayNo,
      firstRentAmount: rentAmount,
      tenantName: b.name,
      roomNo: roomNoOf(b.roomId ? +b.roomId : null)
    })
  }
  res.status(201).json(parseRow(db.prepare('SELECT * FROM tenants WHERE id=?').get(newId)))
})

router.put('/:id', (req, res) => {
  const id = +req.params.id
  const b = req.body || {}
  const cur = db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
  if (!cur) return res.status(404).json({ message: '租户不存在' })
  const oldRoom = cur.room_id
  const newRoom = b.roomId !== undefined ? (b.roomId ? +b.roomId : null) : cur.room_id
  const newStatus = b.status !== undefined ? b.status : cur.status
  // 退房时间：状态变为 left 时记录（恢复入住则清空），保证与首页退房按钮口径一致
  const checkoutDate = newStatus === 'left'
    ? (cur.status !== 'left' ? nowLocal() : (cur.check_out_date || nowLocal()))
    : ''
  if (newRoom && newStatus !== 'left') {
    const occupied = db
      .prepare("SELECT 1 FROM tenants WHERE room_id=? AND status='active' AND id!=? LIMIT 1")
      .get(newRoom, id)
    if (occupied) return res.status(400).json({ message: '该房间已有在住租户，不能重复入住' })
  }
  const newAttachments = b.attachments !== undefined ? JSON.stringify(b.attachments) : cur.attachments
  db.prepare(
    `UPDATE tenants SET name=?, phone=?, id_card=?, store_id=?, room_id=?, check_in_date=?, contract_end=?, rent_due_date=?, deposit=?, rent=?, status=?, attachments=?, check_out_date=? WHERE id=?`
  ).run(
    b.name ?? cur.name,
    b.phone ?? cur.phone,
    b.idCard ?? cur.id_card,
    b.storeId ? +b.storeId : cur.store_id,
    newRoom,
    b.checkInDate ?? cur.check_in_date,
    b.contractEnd ?? cur.contract_end,
    b.rentDueDate ?? cur.rent_due_date,
    b.deposit !== undefined ? +b.deposit : cur.deposit,
    b.rent !== undefined ? +b.rent : cur.rent,
    b.status ?? cur.status,
    newAttachments,
    checkoutDate,
    id
  )
  // 审计明细：记录关键字段改前 / 改后，便于区分「续缴顺延」与「手动改到期日」
  setAuditDetail(req, {
    tenantName: cur.name,
    before: {
      name: cur.name,
      roomNo: roomNoOf(cur.room_id),
      rent: cur.rent,
      rentDueDate: cur.rent_due_date,
      status: cur.status
    },
    after: {
      name: b.name ?? cur.name,
      roomNo: roomNoOf(newRoom),
      rent: b.rent !== undefined ? +b.rent : cur.rent,
      rentDueDate: b.rentDueDate ?? cur.rent_due_date,
      status: b.status ?? cur.status
    }
  })
  syncRoomStatus(oldRoom)
  if (newRoom && newRoom !== oldRoom) syncRoomStatus(newRoom)
  res.json(parseRow(db.prepare('SELECT * FROM tenants WHERE id=?').get(id)))
})

router.delete('/:id', (req, res) => {
  const id = +req.params.id
  const cur = db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
  if (cur) {
    setAuditDetail(req, {
      tenantName: cur.name,
      before: {
        name: cur.name,
        phone: cur.phone,
        roomNo: roomNoOf(cur.room_id),
        status: cur.status,
        rentDueDate: cur.rent_due_date,
        checkInDate: cur.check_in_date
      }
    })
  }
  db.prepare('DELETE FROM tenants WHERE id=?').run(id)
  syncRoomStatus(cur?.room_id)
  res.json(true)
})

// 内联修改房租到期日（工作台直接改）
router.post('/:id/due-date', (req, res) => {
  const id = +req.params.id
  const { rentDueDate } = req.body || {}
  if (!rentDueDate) return res.status(400).json({ message: '请选择日期' })
  const cur = db.prepare('SELECT name, room_id, rent_due_date FROM tenants WHERE id=?').get(id)
  setAuditDetail(req, {
    tenantName: cur?.name || '',
    roomNo: roomNoOf(cur?.room_id),
    before: { rentDueDate: cur?.rent_due_date || '' },
    after: { rentDueDate }
  })
  db.prepare('UPDATE tenants SET rent_due_date=? WHERE id=?').run(rentDueDate, id)
  res.json(parseRow(db.prepare('SELECT * FROM tenants WHERE id=?').get(id)))
})

// 房租收缴：生成收款记录（含水电费）+ 顺延到期日 + 推进水电表读数
router.post('/:id/collect', (req, res) => {
  const id = +req.params.id
  const b = req.body || {}
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
  if (!t) return res.status(404).json({ message: '租户不存在' })
  if (!b.newDue) return res.status(400).json({ message: '请选择房租延期日' })

  const rentAmount = Number(b.rentAmount ?? b.amount) || 0
  const u = calcUtility(b, t.room_id)
  const total = Math.round((rentAmount + u.waterFee + u.electricityFee) * 100) / 100
  if (!total || total <= 0) return res.status(400).json({ message: '请输入收取金额' })

  const no = db.prepare("SELECT no FROM payments WHERE no LIKE 'SF%' ORDER BY id DESC LIMIT 1").get()
  let seq = no && no.no ? parseInt(no.no.slice(2), 10) || 0 : 0
  const payNo = `SF${String(seq + 1).padStart(6, '0')}`
  setAuditDetail(req, {
    paymentNo: payNo,
    amount: total,
    tenantName: t.name,
    roomNo: roomNoOf(t.room_id),
    before: { rentDueDate: t.rent_due_date || '' },
    after: { rentDueDate: b.newDue },
    waterMode: u.waterMode,
    electricityMode: u.electricityMode
  })
  // 收款时间：日期取前端所选，时间取北京时间当前时刻（修正时区，保证显示到时分秒）
  const paidAtDate = b.paidAt || todayStr()
  const paidAt = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(paidAtDate)
    ? paidAtDate
    : `${paidAtDate} ${nowHms()}`
  db.prepare(
    `INSERT INTO payments (no, tenant_id, tenant_name, store_id, room_no, amount, paid_at, remark,
      rent_amount, utility_mode, water_mode, electricity_mode,
      rent_old_due, rent_new_due,
      water_reading, water_usage, water_price, water_fee,
      electricity_reading, electricity_usage, electricity_price, electricity_fee, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    payNo,
    t.id,
    t.name,
    t.store_id,
    roomNoOf(t.room_id),
    total,
    paidAt,
    b.remark || '',
    rentAmount,
    u.utilityMode,
    u.waterMode,
    u.electricityMode,
    t.rent_due_date || '',
    b.newDue,
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
  db.prepare('UPDATE tenants SET rent_due_date=? WHERE id=?').run(b.newDue, id)
  applyMeterReadings(t.room_id, b, b.paidAt || todayStr())
  res.json(parseRow(db.prepare('SELECT * FROM tenants WHERE id=?').get(id)))
})

// 退房：租户置为已退租(left)，对应房间置为待清扫(cleaning)，等待保洁后由管理员改为空置
router.post('/:id/checkout', (req, res) => {
  const id = +req.params.id
  const t = db.prepare('SELECT * FROM tenants WHERE id=?').get(id)
  if (!t) return res.status(404).json({ message: '租户不存在' })
  // 记录退房时间（北京时间，带时分秒）
  const outAt = nowLocal()
  const roomNo = roomNoOf(t.room_id)
  db.prepare("UPDATE tenants SET status='left', check_out_date=? WHERE id=?").run(outAt, id)
  // 房间直接置为待清扫：不调用 syncRoomStatus（否则会因无在住租户被判为空置）
  if (t.room_id) {
    db.prepare("UPDATE rooms SET status='cleaning' WHERE id=?").run(t.room_id)
  }
  setAuditDetail(req, {
    tenantName: t.name,
    roomNo,
    before: { status: t.status, rentDueDate: t.rent_due_date || '' },
    after: { status: 'left', checkOutDate: outAt, roomStatus: 'cleaning' }
  })
  res.json(parseRow(db.prepare('SELECT * FROM tenants WHERE id=?').get(id)))
})

export default router
