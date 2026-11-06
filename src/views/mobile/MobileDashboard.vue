<template>
  <div>
    <div class="stat-grid">
      <div class="stat" v-for="c in cards" :key="c.key">
        <div class="stat-val" :style="{ color: c.color }">{{ summary[c.key] ?? 0 }}</div>
        <div class="stat-label">{{ c.title }}</div>
      </div>
    </div>

    <van-button type="primary" block round @click="goNewCheckIn">办理新入住</van-button>

    <div class="sec">
      <span class="sec-title">当前在住</span>
      <span class="sec-count">（{{ rentDueList.length }}）</span>
    </div>

    <van-empty v-if="!rentDueList.length" description="暂无在住且已填写房租到期日的租户" />

    <div v-else class="list">
      <div class="card" v-for="r in rentDueList" :key="r.id">
        <div class="c-head">
          <span class="c-name">{{ r.name }}</span>
          <span class="c-tag" :class="dueState(r.rentDueDate)">{{ dueText(r.rentDueDate) }}</span>
        </div>
        <div class="c-sub">
          {{ r.storeName || '—' }} · <a @click="goRoom(r)">{{ r.roomNo || '—' }}</a> · 月租 ¥{{ r.rent ?? 0 }}
        </div>
        <div class="c-sub c-dim">
          入住 {{ r.checkInDate || '—' }} · 到期
          <a class="due-link" @click="openDueEdit(r)">{{ r.rentDueDate || '点击设置' }}</a>
        </div>
        <div class="c-actions">
          <van-button
            size="small"
            plain
            :loading="remindingId === r.id"
            @click="sendReminder(r)"
          >发提醒</van-button>
          <van-button size="small" type="primary" @click="openCollect(r)">房租收缴</van-button>
          <van-button size="small" type="danger" plain @click="checkout(r)">退房</van-button>
        </div>
      </div>
    </div>

    <van-popup v-model:show="collectShow" position="bottom" round>
      <div class="sheet">
        <div class="sheet-title">房租收缴 · {{ collectForm.tenantName }}</div>
        <van-cell-group inset>
          <van-cell title="房间" :value="`${collectForm.storeName} ${collectForm.roomNo}`" />
          <van-cell title="本期到期" :value="collectForm.oldDue || '—'" />
        </van-cell-group>
        <van-field
          v-model="collectForm.rentAmount"
          type="number"
          label="收取房租(元)"
          placeholder="请输入金额"
        />
        <MobileDateField v-model="collectForm.newDue" label="房租延期至" required />
        <MobileDateField v-model="collectForm.paidAt" label="收款日期" required />

        <div class="grp">水费</div>
        <van-radio-group v-model="collectForm.waterMode" direction="horizontal" class="mode-row">
          <van-radio name="">不计水费</van-radio>
          <van-radio name="meter">按抄表</van-radio>
          <van-radio name="flat">包月</van-radio>
        </van-radio-group>
        <template v-if="collectForm.waterMode === 'meter'">
          <div class="tip">
            上次抄表（{{ collectForm.meterDate || '未记录' }}）：水 {{ collectForm.lastWater }}
          </div>
          <van-cell-group inset>
            <van-field v-model="collectForm.waterReading" type="number" label="水表本次" placeholder="读数" />
            <van-field v-model="collectForm.waterPrice" type="number" label="水单价(元)" />
          </van-cell-group>
          <div class="tip">
            用水 {{ waterUsage }} × ¥{{ collectForm.waterPrice }} = <b>¥{{ waterFeeCalc }}</b>
          </div>
        </template>
        <template v-else-if="collectForm.waterMode === 'flat'">
          <van-cell-group inset>
            <van-field v-model="collectForm.waterFee" type="number" label="水费(元)" placeholder="0" />
          </van-cell-group>
        </template>

        <div class="grp">电费</div>
        <van-radio-group v-model="collectForm.electricityMode" direction="horizontal" class="mode-row">
          <van-radio name="">不计电费</van-radio>
          <van-radio name="meter">按抄表</van-radio>
          <van-radio name="flat">包月</van-radio>
        </van-radio-group>
        <template v-if="collectForm.electricityMode === 'meter'">
          <div class="tip">
            上次抄表（{{ collectForm.meterDate || '未记录' }}）：电 {{ collectForm.lastElectricity }}
          </div>
          <van-cell-group inset>
            <van-field v-model="collectForm.electricityReading" type="number" label="电表本次" placeholder="读数" />
            <van-field v-model="collectForm.electricityPrice" type="number" label="电单价(元)" />
          </van-cell-group>
          <div class="tip">
            用电 {{ electricityUsage }} × ¥{{ collectForm.electricityPrice }} =
            <b>¥{{ electricityFeeCalc }}</b>
          </div>
        </template>
        <template v-else-if="collectForm.electricityMode === 'flat'">
          <van-cell-group inset>
            <van-field v-model="collectForm.electricityFee" type="number" label="电费(元)" placeholder="0" />
          </van-cell-group>
        </template>

        <van-field v-model="collectForm.remark" label="备注" placeholder="如：微信转账 / 现金" />

        <div class="total">
          本次应收合计：<b>¥{{ totalPay }}</b>
          <span v-if="utilityFee > 0" class="total-sub">（房租 ¥{{ collectForm.rentAmount }} + 水电 ¥{{ utilityFee }}）</span>
        </div>
        <van-button
          type="primary"
          block
          round
          :loading="paying"
          @click="confirmCollect"
        >
          确认收款 ¥{{ totalPay }}
        </van-button>
      </div>
    </van-popup>

    <!-- 内联修改房租到期日（与桌面端表格里的 date-picker 对齐） -->
    <van-popup v-model:show="dueShow" position="bottom" round>
      <div class="sheet">
        <div class="sheet-title">修改房租到期日 · {{ dueForm.name }}</div>
        <MobileDateField v-model="dueForm.date" label="房租到期日" @change="saveDueDate" />
        <div class="tip">选定日期后立即保存，并刷新首页到期状态</div>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
// 显式按需引入 Vant 组件 + 各自 CSS
import {
  Button as VanButton,
  Empty as VanEmpty,
  Popup as VanPopup,
  Cell as VanCell,
  CellGroup as VanCellGroup,
  Field as VanField,
  Radio as VanRadio,
  RadioGroup as VanRadioGroup,
  showToast,
  showConfirmDialog
} from 'vant'
import './vant.css'
import MobileDateField from './MobileDateField.vue'
import { dashboardApi, tenantApi, reminderApi } from '@/api'
import { nextDueDate, localDateStr } from '@/utils/date'

const router = useRouter()
const summary = ref({})
const rentDueList = ref([])

const TODAY = localDateStr()

const cards = [
  { key: 'storeCount', title: '门店数量', color: '#1677ff' },
  { key: 'roomCount', title: '房源总数', color: '#52c41a' },
  { key: 'tenantCount', title: '在住租户', color: '#722ed1' },
  { key: 'expiringSoon', title: '7天内合同到期', color: '#fa8c16' },
  { key: 'rentDueSoon', title: '7天内房租到期', color: '#fa541c' },
  { key: 'rented', title: '已出租', color: '#13c2c2' },
  { key: 'empty', title: '空置房源', color: '#eb2f96' }
]

function dueState(date) {
  if (!date) return 'none'
  const diff = (new Date(date) - new Date(TODAY)) / 86400000
  if (diff < 0) return 'overdue'
  if (diff <= 7) return 'soon'
  return 'normal'
}
function dueText(date) {
  const map = { overdue: '已超期', soon: '7天内', normal: '正常', none: '未设置' }
  return map[dueState(date)]
}

function goNewCheckIn() {
  router.push('/tenant?create=1')
}

// 点击房号：跳到房源管理并自动打开该房间编辑
function goRoom(record) {
  router.push({ path: '/room', query: { edit: record.roomId } })
}

// 发提醒防连点：按钮 loading 期间禁用；后端另有 60 秒同内容去重兜底
const remindingId = ref(null)
async function sendReminder(record) {
  if (remindingId.value !== null) return
  remindingId.value = record.id
  try {
    await reminderApi.send({
      tenantId: record.id,
      tenantName: record.name,
      storeName: record.storeName,
      roomNo: record.roomNo,
      type: 'rent',
      content: `请提醒 ${record.name}（${record.storeName} ${record.roomNo}）于 ${record.rentDueDate} 前缴纳房租 ¥${record.rent}。`
    })
    showToast(`已向「${record.name}」发送提醒`)
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    remindingId.value = null
  }
}

// ---------- 内联改房租到期日 ----------
const dueShow = ref(false)
const dueSaving = ref(false)
const dueForm = reactive({ id: null, name: '', date: '' })

function openDueEdit(record) {
  dueForm.id = record.id
  dueForm.name = record.name
  dueForm.date = record.rentDueDate || ''
  dueShow.value = true
}
async function saveDueDate(val) {
  if (!val || !dueForm.id || dueSaving.value) return
  dueSaving.value = true
  try {
    await tenantApi.updateDueDate(dueForm.id, val)
    showToast(`已将 ${dueForm.name} 的房租到期日改为 ${val}`)
    dueShow.value = false
    await load()
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    dueSaving.value = false
  }
}

// 退房：带确认，调用后端接口（租户转已退租、房间转待清扫）
async function checkout(record) {
  try {
    await showConfirmDialog({
      title: '确认退房',
      message: `确定让「${record.name}」（${record.roomNo}）办理退房吗？\n退房后房间状态将变为「待清扫」。`
    })
  } catch {
    return
  }
  try {
    await tenantApi.checkout(record.id)
    showToast(`已为「${record.name}」办理退房，房间转为待清扫`)
    load()
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '退房失败')
  }
}

// 顺延一个月由 @/utils/date 统一处理（含月末夹取，避免 1/31 → 3/3）

const collectShow = ref(false)
const paying = ref(false)
const collectForm = reactive({
  tenantId: null,
  tenantName: '',
  storeId: null,
  storeName: '',
  roomNo: '',
  rentAmount: 0,
  oldDue: '',
  newDue: '',
  paidAt: TODAY,
  remark: '',
  // 水电费：水/电各自独立选择计费方式（'' 不计 / 'meter' 按抄表 / 'flat' 包月）
  waterMode: '',
  electricityMode: '',
  lastWater: 0,
  lastElectricity: 0,
  meterDate: '',
  waterReading: null,
  electricityReading: null,
  waterPrice: 0,
  electricityPrice: 0,
  waterFee: 0,
  electricityFee: 0
})

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100
const waterUsage = computed(() =>
  collectForm.waterMode === 'meter'
    ? Math.max(0, round2((Number(collectForm.waterReading) || 0) - (Number(collectForm.lastWater) || 0)))
    : 0
)
const electricityUsage = computed(() =>
  collectForm.electricityMode === 'meter'
    ? Math.max(
        0,
        round2((Number(collectForm.electricityReading) || 0) - (Number(collectForm.lastElectricity) || 0))
      )
    : 0
)
const waterFeeCalc = computed(() => round2(waterUsage.value * (Number(collectForm.waterPrice) || 0)))
const electricityFeeCalc = computed(() =>
  round2(electricityUsage.value * (Number(collectForm.electricityPrice) || 0))
)
const waterFeeTotal = computed(() => {
  if (collectForm.waterMode === 'meter') return waterFeeCalc.value
  if (collectForm.waterMode === 'flat') return round2(Number(collectForm.waterFee) || 0)
  return 0
})
const electricityFeeTotal = computed(() => {
  if (collectForm.electricityMode === 'meter') return electricityFeeCalc.value
  if (collectForm.electricityMode === 'flat') return round2(Number(collectForm.electricityFee) || 0)
  return 0
})
const utilityFee = computed(() => round2(waterFeeTotal.value + electricityFeeTotal.value))
const totalPay = computed(() => round2((Number(collectForm.rentAmount) || 0) + utilityFee.value))

function openCollect(record) {
  Object.assign(collectForm, {
    tenantId: record.id,
    tenantName: record.name,
    storeId: record.storeId,
    storeName: record.storeName,
    roomNo: record.roomNo,
    rentAmount: record.rent,
    oldDue: record.rentDueDate,
    newDue: nextDueDate(record.rentDueDate),
    paidAt: TODAY,
    remark: '',
    waterMode: '',
    electricityMode: '',
    lastWater: record.waterMeter ?? 0,
    lastElectricity: record.electricityMeter ?? 0,
    meterDate: record.meterDate || '',
    waterReading: null,
    electricityReading: null,
    waterPrice: record.waterPrice ?? 0,
    electricityPrice: record.electricityPrice ?? 0,
    waterFee: 0,
    electricityFee: 0
  })
  collectShow.value = true
}

async function confirmCollect() {
  const rentAmount = Number(collectForm.rentAmount)
  if (!collectForm.newDue) {
    showToast('请选择房租延期日')
    return
  }
  if (!rentAmount || rentAmount <= 0) {
    showToast('请输入收取房租金额')
    return
  }
  if (collectForm.waterMode === 'meter') {
    const w = Number(collectForm.waterReading)
    if (!Number.isFinite(w)) {
      showToast('水费按抄表计费请输入本次水表读数')
      return
    }
    if (w < Number(collectForm.lastWater || 0)) {
      showToast('水表本次读数不能小于上次读数')
      return
    }
  }
  if (collectForm.electricityMode === 'meter') {
    const e = Number(collectForm.electricityReading)
    if (!Number.isFinite(e)) {
      showToast('电费按抄表计费请输入本次电表读数')
      return
    }
    if (e < Number(collectForm.lastElectricity || 0)) {
      showToast('电表本次读数不能小于上次读数')
      return
    }
  }
  paying.value = true
  try {
    // 用后端原子接口：一条收款记录（含水电费）+ 顺延到期日 + 推进水电表读数
    await tenantApi.collect(collectForm.tenantId, {
      rentAmount,
      newDue: collectForm.newDue,
      paidAt: collectForm.paidAt,
      remark: collectForm.remark,
      waterMode: collectForm.waterMode,
      electricityMode: collectForm.electricityMode,
      waterReading: collectForm.waterReading,
      electricityReading: collectForm.electricityReading,
      waterPrice: collectForm.waterPrice,
      electricityPrice: collectForm.electricityPrice,
      waterFee: collectForm.waterFee,
      electricityFee: collectForm.electricityFee
    })
    const extra = utilityFee.value > 0 ? `（含水电 ¥${utilityFee.value}）` : ''
    showToast(`已收「${collectForm.tenantName}」¥${totalPay.value}${extra}，到期日延至 ${collectForm.newDue}`)
    collectShow.value = false
    load()
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '收款失败')
  } finally {
    paying.value = false
  }
}

async function load() {
  const s = await dashboardApi.summary()
  summary.value = s
  rentDueList.value = s.rentDueList || []
}

onMounted(load)
</script>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 12px;
}
.stat {
  background: #fafafa;
  border-radius: 10px;
  padding: 12px;
  text-align: center;
}
.stat-val {
  font-size: 22px;
  font-weight: 500;
  line-height: 1.2;
}
.stat-label {
  font-size: 12px;
  color: #8c8c8c;
  margin-top: 4px;
}
.sec {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 20px 0 10px;
}
.sec-title {
  font-size: 15px;
  font-weight: 500;
}
.sec-count {
  font-size: 12px;
  color: #8c8c8c;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  border: 1px solid #f0f0f0;
  border-radius: 12px;
  padding: 12px;
}
.c-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.c-name {
  font-size: 15px;
  font-weight: 500;
}
.c-tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  background: #f1efe8;
  color: #5f5e5a;
}
.c-tag.overdue {
  background: #fcebeb;
  color: #a32d2d;
}
.c-tag.soon {
  background: #faeeda;
  color: #854f0b;
}
.c-sub {
  font-size: 13px;
  color: #555;
  margin-top: 4px;
}
.c-dim {
  color: #999;
}
.due-link {
  color: #1677ff;
  text-decoration: underline;
  text-underline-offset: 2px;
}
.c-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 10px;
}
.sheet {
  padding: 16px 12px 20px;
}
.sheet-title {
  font-size: 15px;
  font-weight: 500;
  margin-bottom: 10px;
  padding: 0 4px;
}
.grp {
  font-size: 13px;
  color: #8c8c8c;
  padding: 14px 4px 8px;
}
.mode-row {
  padding: 0 4px 8px;
}
.mode-row :deep(.van-radio) {
  margin-right: 14px;
}
.tip {
  font-size: 12px;
  color: #6b6b6b;
  background: #fafafa;
  border-radius: 8px;
  padding: 8px 10px;
  margin: 8px 4px;
  line-height: 1.6;
}
.tip b {
  color: #cf1322;
}
.total {
  font-size: 15px;
  padding: 12px 4px;
  margin-top: 10px;
  border-top: 1px solid #f0f0f0;
}
.total b {
  color: #cf1322;
  font-size: 18px;
}
.total-sub {
  font-size: 12px;
  color: #8c8c8c;
}
</style>
