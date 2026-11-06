import db from '../db.js'
import { todayStr } from './helpers.js'

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function storePrice(storeId, col) {
  if (!storeId) return 0
  const s = db.prepare(`SELECT ${col} AS p FROM stores WHERE id=?`).get(+storeId)
  return num(s?.p)
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100
}

// 计算单个能源（水/电）的本期明细，互不影响
// prefix: 'water' | 'electricity'；mode: '' 不计 / 'meter' 按抄表 / 'flat' 包月
function calcOne(prefix, mode, b = {}, room = null, storeId = null) {
  const empty = {
    mode: '',
    reading: 0,
    usage: 0,
    price: 0,
    fee: 0
  }
  if (!mode || mode === 'none') return empty

  const readingKey = `${prefix}Reading`
  const priceKey = `${prefix}Price`
  const feeKey = `${prefix}Fee`

  // 包月：费用直接手填，不涉及抄表
  if (mode === 'flat') {
    return { mode: 'flat', reading: 0, usage: 0, price: 0, fee: num(b[feeKey]) }
  }

  // 按抄表：用量 = 本次读数 - 上次读数；费用 = 用量 × 单价
  const last = num(prefix === 'water' ? room?.water_meter : room?.electricity_meter)
  const newReading = Number(b[readingKey])

  let usage = 0
  if (Number.isFinite(newReading)) usage = Math.max(0, newReading - last)

  // 单价：本次传入优先，缺省回落门店单价
  let price = Number(b[priceKey])
  if (!Number.isFinite(price) || price <= 0) {
    price = storePrice(storeId, prefix === 'water' ? 'water_price' : 'electricity_price')
  }

  return {
    mode: 'meter',
    reading: Number.isFinite(newReading) ? newReading : 0,
    usage,
    price,
    fee: round2(usage * price)
  }
}

/**
 * 计算本次收款的水电费明细（不写库）
 * 水、电各自独立选择计费方式：waterMode / electricityMode = '' | 'meter' | 'flat'
 * @param {object} b 收款参数
 * @param {number|null} roomId 房间 id，用于取上次读数与门店单价
 * @returns {object} 水电费明细字段
 */
export function calcUtility(b = {}, roomId = null) {
  const room = roomId ? db.prepare('SELECT * FROM rooms WHERE id=?').get(+roomId) : null
  const storeId = room?.store_id ?? b.storeId ?? null

  const w = calcOne('water', b.waterMode || '', b, room, storeId)
  const e = calcOne('electricity', b.electricityMode || '', b, room, storeId)

  // 兼容旧调用：仅传了统一的 utilityMode 时，水/电同方式
  if (!b.waterMode && !b.electricityMode && b.utilityMode) {
    const legacy = calcOne('water', b.utilityMode, b, room, storeId)
    const legacyE = calcOne('electricity', b.utilityMode, b, room, storeId)
    return {
      waterMode: legacy.mode,
      waterReading: legacy.reading,
      waterUsage: legacy.usage,
      waterPrice: legacy.price,
      waterFee: legacy.fee,
      electricityMode: legacyE.mode,
      electricityReading: legacyE.reading,
      electricityUsage: legacyE.usage,
      electricityPrice: legacyE.price,
      electricityFee: legacyE.fee,
      // 兼容字段：旧账单只有统一的 utility_mode，供历史数据与旧展示逻辑使用
      utilityMode: legacy.mode || legacyE.mode || ''
    }
  }

  return {
    // 兼容字段：混合计费（如水包月+电抄表）时取任一非空方式；前端优先读分项字段
    utilityMode: w.mode || e.mode || '',
    waterMode: w.mode,
    waterReading: w.reading,
    waterUsage: w.usage,
    waterPrice: w.price,
    waterFee: w.fee,
    electricityMode: e.mode,
    electricityReading: e.reading,
    electricityUsage: e.usage,
    electricityPrice: e.price,
    electricityFee: e.fee
  }
}

/**
 * 按抄表收款后，把房间的水电表读数更新为本次读数。
 * 仅推进各自选择「按抄表」的那一项；另一项若不是抄表则保持不动（如：水包月、电抄表）。
 */
export function applyMeterReadings(roomId, b = {}, date = todayStr()) {
  if (!roomId) return
  const wMeter = b.waterMode === 'meter'
  const eMeter = b.electricityMode === 'meter'
  if (!wMeter && !eMeter) return

  const cur = db.prepare('SELECT * FROM rooms WHERE id=?').get(+roomId)
  if (!cur) return

  const newW = Number(b.waterReading)
  const newE = Number(b.electricityReading)
  const setW = wMeter && Number.isFinite(newW) ? newW : cur.water_meter
  const setE = eMeter && Number.isFinite(newE) ? newE : cur.electricity_meter
  // 只有至少一项抄表时才更新抄表日期
  const meterDate = wMeter || eMeter ? date : cur.meter_date

  db.prepare('UPDATE rooms SET water_meter=?, electricity_meter=?, meter_date=? WHERE id=?').run(
    setW,
    setE,
    meterDate,
    +roomId
  )
}
