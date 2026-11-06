<template>
  <div>
    <div class="dash-header">
      <span class="page-title">工作台</span>
      <a-button type="primary" @click="goNewCheckIn">
        <template #icon><PlusOutlined /></template>
        办理新入住
      </a-button>
    </div>

    <a-row :gutter="16">
      <a-col :xs="24" :sm="12" :md="8" :lg="6" v-for="c in cards" :key="c.key">
        <a-card :bordered="false" style="margin-bottom: 16px">
          <a-statistic :title="c.title" :value="summary[c.key] ?? 0" :valueStyle="{ color: c.color }">
            <template #prefix><component :is="c.icon" /></template>
          </a-statistic>
        </a-card>
      </a-col>
    </a-row>

    <a-card :title="`当前在住（${rentDueList.length}）`" :bordered="false">
      <template #extra>
        <a-space :size="12" style="color: #8c8c8c; font-size: 12px">
          <span><a-badge status="error" text="已超期" /></span>
          <span><a-badge status="success" text="7天内" /></span>
          <span><a-badge status="default" text="正常" /></span>
        </a-space>
      </template>
      <a-table
        :columns="dueColumns"
        :data-source="rentDueList"
        :loading="loading"
        :pagination="{ pageSize: 8 }"
        row-key="id"
        size="middle"
        :scroll="{ x: 'max-content' }"
      >
        <template #emptyText>
          <span style="color: #8c8c8c">暂无在住且已填写房租到期日的租户。</span>
        </template>
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'roomNo'">
            <a v-if="record.roomId" @click="() => goRoom(record)">{{ record.roomNo }}</a>
            <span v-else>{{ record.roomNo }}</span>
          </template>
          <template v-else-if="column.key === 'rentDueDate'">
            <a-date-picker
              :value="record.rentDueDate"
              value-format="YYYY-MM-DD"
              size="small"
              style="width: 140px"
              @change="(val) => onDueDateChange(record, val)"
            />
          </template>
          <template v-else-if="column.key === 'status'">
            <a-tag :color="dueInfo(record.rentDueDate).color">
              {{ dueInfo(record.rentDueDate).text }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'action'">
            <a-space>
              <a @click="() => sendReminder(record)">发提醒</a>
              <a @click="() => openCollect(record)">房租收缴</a>
              <a-popconfirm
                title="确认办理退房？"
                description="退房后该房间将置为「待清扫」"
                ok-text="确认退房"
                cancel-text="取消"
                @confirm="() => checkout(record)"
              >
                <a style="color: #fa8c16">退房</a>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </a-card>

    <!-- 房租收缴确认框 -->
    <a-modal
      v-model:open="payModalOpen"
      title="房租收缴"
      @ok="confirmPay"
      @cancel="payModalOpen = false"
      :confirm-loading="paying"
      ok-text="确认收款"
      cancel-text="取消"
      :width="isMobile ? '94vw' : 520"
    >
      <a-descriptions :column="1" size="small" bordered style="margin-bottom: 16px">
        <a-descriptions-item label="租户">{{ payForm.tenantName }}</a-descriptions-item>
        <a-descriptions-item label="所属门店">{{ payForm.storeName }}</a-descriptions-item>
        <a-descriptions-item label="入住房间">{{ payForm.roomNo }}</a-descriptions-item>
        <a-descriptions-item label="本期到期日">{{ payForm.oldDue }}</a-descriptions-item>
      </a-descriptions>

      <a-form layout="vertical">
        <a-form-item label="收取房租（元）">
          <a-input-number v-model:value="payForm.rentAmount" :min="0" :precision="0" style="width: 100%" />
        </a-form-item>
        <a-form-item label="房租延期至（默认+1个月）">
          <a-date-picker v-model:value="payForm.newDue" value-format="YYYY-MM-DD" style="width: 100%" />
        </a-form-item>
        <a-form-item label="收款日期">
          <a-date-picker v-model:value="payForm.paidAt" value-format="YYYY-MM-DD" style="width: 100%" />
        </a-form-item>

        <a-divider orientation="left" plain style="margin: 4px 0 12px">水电费</a-divider>

        <!-- 水费：独立选择计费方式（不计 / 抄表 / 包月） -->
        <a-form-item label="水费计费方式">
          <a-radio-group v-model:value="payForm.waterMode" button-style="solid">
            <a-radio-button value="">不计水费</a-radio-button>
            <a-radio-button value="meter">按抄表</a-radio-button>
            <a-radio-button value="flat">包月</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <template v-if="payForm.waterMode === 'meter'">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px"
            :message="`上次抄表（${payForm.meterDate || '未记录'}）：水 ${payForm.lastWater}`"
          />
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="水表本次读数">
                <a-input-number v-model:value="payForm.waterReading" :min="0" :precision="1" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="水单价（元）">
                <a-input-number v-model:value="payForm.waterPrice" :min="0" :precision="2" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <div class="fee-line">
            用水 {{ waterUsage }} × ¥{{ payForm.waterPrice }} = <b>¥{{ waterFeeCalc }}</b>
          </div>
        </template>
        <template v-else-if="payForm.waterMode === 'flat'">
          <a-form-item label="水费（元）">
            <a-input-number v-model:value="payForm.waterFee" :min="0" :precision="2" style="width: 100%" />
          </a-form-item>
        </template>

        <!-- 电费：独立选择计费方式（不计 / 抄表 / 包月） -->
        <a-form-item label="电费计费方式">
          <a-radio-group v-model:value="payForm.electricityMode" button-style="solid">
            <a-radio-button value="">不计电费</a-radio-button>
            <a-radio-button value="meter">按抄表</a-radio-button>
            <a-radio-button value="flat">包月</a-radio-button>
          </a-radio-group>
        </a-form-item>
        <template v-if="payForm.electricityMode === 'meter'">
          <a-alert
            type="info"
            show-icon
            style="margin-bottom: 12px"
            :message="`上次抄表（${payForm.meterDate || '未记录'}）：电 ${payForm.lastElectricity}`"
          />
          <a-row :gutter="12">
            <a-col :span="12">
              <a-form-item label="电表本次读数">
                <a-input-number v-model:value="payForm.electricityReading" :min="0" :precision="1" style="width: 100%" />
              </a-form-item>
            </a-col>
            <a-col :span="12">
              <a-form-item label="电单价（元）">
                <a-input-number v-model:value="payForm.electricityPrice" :min="0" :precision="2" style="width: 100%" />
              </a-form-item>
            </a-col>
          </a-row>
          <div class="fee-line">
            用电 {{ electricityUsage }} × ¥{{ payForm.electricityPrice }} = <b>¥{{ electricityFeeCalc }}</b>
          </div>
        </template>
        <template v-else-if="payForm.electricityMode === 'flat'">
          <a-form-item label="电费（元）">
            <a-input-number v-model:value="payForm.electricityFee" :min="0" :precision="2" style="width: 100%" />
          </a-form-item>
        </template>

        <a-form-item label="备注">
          <a-input v-model:value="payForm.remark" placeholder="如：微信转账 / 现金" />
        </a-form-item>
      </a-form>
      <div class="total-line">
        本次应收合计：<b>¥{{ totalPay }}</b>
        <span v-if="utilityFee > 0" class="total-sub">（房租 ¥{{ payForm.rentAmount }} + 水电 ¥{{ utilityFee }}）</span>
      </div>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  ShopOutlined,
  HomeOutlined,
  UserOutlined,
  AlertOutlined,
  CheckCircleOutlined,
  InboxOutlined,
  CalendarOutlined,
  PlusOutlined
} from '@ant-design/icons-vue'
import { dashboardApi, tenantApi, reminderApi } from '@/api'
import { useIsMobile } from '@/composables/useIsMobile'
import { nextDueDate, localDateStr } from '@/utils/date'

const { isMobile } = useIsMobile()

// 「今天」：用于房租到期状态判定与默认收款日期，取浏览器本地日期
const TODAY = localDateStr()

const router = useRouter()
const loading = ref(false)
const summary = ref({})
const rentDueList = ref([])

const cards = [
  { key: 'storeCount', title: '门店数量', icon: ShopOutlined, color: '#1677ff' },
  { key: 'roomCount', title: '房源总数', icon: HomeOutlined, color: '#52c41a' },
  { key: 'tenantCount', title: '在住租户', icon: UserOutlined, color: '#722ed1' },
  { key: 'expiringSoon', title: '7天内合同到期', icon: AlertOutlined, color: '#fa8c16' },
  { key: 'rentDueSoon', title: '7天内房租到期', icon: CalendarOutlined, color: '#fa541c' },
  { key: 'rented', title: '已出租', icon: CheckCircleOutlined, color: '#13c2c2' },
  { key: 'empty', title: '空置房源', icon: InboxOutlined, color: '#eb2f96' }
]

const dueColumns = [
  { title: '姓名', dataIndex: 'name', key: 'name', width: 90 },
  { title: '所属门店', dataIndex: 'storeName', key: 'storeName' },
  { title: '入住房间', dataIndex: 'roomNo', key: 'roomNo', width: 80 },
  { title: '入住日期', dataIndex: 'checkInDate', key: 'checkInDate', width: 110 },
  { title: '房租到期日', key: 'rentDueDate', width: 160 },
  { title: '月租(元)', dataIndex: 'rent', key: 'rent', width: 90 },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'action', width: 150 }
]

// 状态判定：已超期(红) / 7天内(绿) / 正常(灰)
function dueState(date) {
  if (!date) return 'none'
  const today = new Date(TODAY)
  const diff = (new Date(date) - today) / 86400000
  if (diff < 0) return 'overdue'
  if (diff <= 7) return 'soon'
  return 'normal'
}
function dueInfo(date) {
  const map = {
    overdue: { color: 'red', text: '已超期' },
    soon: { color: 'green', text: '7天内' },
    normal: { color: 'default', text: '正常' }
  }
  return map[dueState(date)] || { color: 'default', text: '-' }
}

function goNewCheckIn() {
  router.push('/tenant?create=1')
}

// 点击房号：跳到房源管理并自动打开该房间编辑
function goRoom(record) {
  router.push({ path: '/room', query: { edit: record.roomId } })
}

// 交完房租后，直接在本列改到期日
async function onDueDateChange(record, val) {
  if (!val) return
  try {
    await tenantApi.update(record.id, { rentDueDate: val })
    message.success(`已将 ${record.name} 的房租到期日改为 ${val}`)
    load()
  } catch {
    // 失败提示由统一请求拦截器给出，这里只避免未捕获的 Promise 异常
  }
}

// 发站内提醒：防连点 + 后端 60 秒同内容去重兜底
const remindingIds = new Set()
async function sendReminder(record) {
  if (remindingIds.has(record.id)) return
  remindingIds.add(record.id)
  try {
    await reminderApi.send({
      tenantId: record.id,
      tenantName: record.name,
      storeName: record.storeName,
      roomNo: record.roomNo,
      type: 'rent',
      content: `请提醒 ${record.name}（${record.storeName} ${record.roomNo}）于 ${record.rentDueDate} 前缴纳房租 ¥${record.rent}。`
    })
    message.success(`已向「${record.name}」发送站内提醒`)
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    remindingIds.delete(record.id)
  }
}

// 退房：租户置为已退租，房间置为待清扫
async function checkout(record) {
  try {
    await tenantApi.checkout(record.id)
    message.success(`已为「${record.name}」办理退房，房间置为待清扫`)
    load()
  } catch (e) {
    message.error(e?.response?.data?.message || e.message || '退房失败')
  }
}

const payModalOpen = ref(false)
const paying = ref(false)
const payForm = reactive({
  tenantId: null,
  tenantName: '',
  storeId: null,
  storeName: '',
  roomId: null,
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
  payForm.waterMode === 'meter'
    ? Math.max(0, round2((Number(payForm.waterReading) || 0) - (Number(payForm.lastWater) || 0)))
    : 0
)
const electricityUsage = computed(() =>
  payForm.electricityMode === 'meter'
    ? Math.max(0, round2((Number(payForm.electricityReading) || 0) - (Number(payForm.lastElectricity) || 0)))
    : 0
)
const waterFeeCalc = computed(() => round2(waterUsage.value * (Number(payForm.waterPrice) || 0)))
const electricityFeeCalc = computed(() =>
  round2(electricityUsage.value * (Number(payForm.electricityPrice) || 0))
)
// 水：抄表用算出的费，包月用手填的费，不计为 0
const waterFeeTotal = computed(() => {
  if (payForm.waterMode === 'meter') return waterFeeCalc.value
  if (payForm.waterMode === 'flat') return round2(Number(payForm.waterFee) || 0)
  return 0
})
const electricityFeeTotal = computed(() => {
  if (payForm.electricityMode === 'meter') return electricityFeeCalc.value
  if (payForm.electricityMode === 'flat') return round2(Number(payForm.electricityFee) || 0)
  return 0
})
const utilityFee = computed(() => round2(waterFeeTotal.value + electricityFeeTotal.value))
const totalPay = computed(() => round2((Number(payForm.rentAmount) || 0) + utilityFee.value))

// 默认延期：本期到期日（若已超期则从今天起算）+ 1 个自然月（月末自动夹取，见 @/utils/date）

// 房租收缴：弹出确认框，带出住户信息与默认金额/到期日，可修改后确认
function openCollect(record) {
  Object.assign(payForm, {
    tenantId: record.id,
    tenantName: record.name,
    storeId: record.storeId,
    storeName: record.storeName,
    roomId: record.roomId ?? null,
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
  payModalOpen.value = true
}

async function confirmPay() {
  if (!payForm.newDue) {
    message.warning('请选择房租延期日')
    return
  }
  if (!payForm.rentAmount || payForm.rentAmount <= 0) {
    message.warning('请输入收取房租金额')
    return
  }
  if (payForm.waterMode === 'meter') {
    const w = Number(payForm.waterReading)
    if (!Number.isFinite(w)) {
      message.warning('水费按抄表计费请输入本次水表读数')
      return
    }
    if (w < Number(payForm.lastWater || 0)) {
      message.warning('水表本次读数不能小于上次读数')
      return
    }
  }
  if (payForm.electricityMode === 'meter') {
    const e = Number(payForm.electricityReading)
    if (!Number.isFinite(e)) {
      message.warning('电费按抄表计费请输入本次电表读数')
      return
    }
    if (e < Number(payForm.lastElectricity || 0)) {
      message.warning('电表本次读数不能小于上次读数')
      return
    }
  }
  paying.value = true
  try {
    // 单步原子接口：生成收款记录（含水电费）+ 顺延到期日 + 推进水电表读数
    await tenantApi.collect(payForm.tenantId, {
      rentAmount: payForm.rentAmount,
      newDue: payForm.newDue,
      paidAt: payForm.paidAt,
      remark: payForm.remark,
      waterMode: payForm.waterMode,
      electricityMode: payForm.electricityMode,
      waterReading: payForm.waterReading,
      electricityReading: payForm.electricityReading,
      waterPrice: payForm.waterPrice,
      electricityPrice: payForm.electricityPrice,
      waterFee: payForm.waterFee,
      electricityFee: payForm.electricityFee
    })
    const extra = utilityFee.value > 0 ? `（含水电 ¥${utilityFee.value}）` : ''
    message.success(
      `已收取「${payForm.tenantName}」¥${totalPay.value}${extra}，到期日延至 ${payForm.newDue}`
    )
    payModalOpen.value = false
    load()
  } catch (e) {
    message.error(e?.response?.data?.message || e.message || '收款失败')
  } finally {
    paying.value = false
  }
}

async function load() {
  loading.value = true
  try {
    const s = await dashboardApi.summary()
    summary.value = s
    rentDueList.value = s.rentDueList || []
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.dash-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.fee-line {
  font-size: 13px;
  color: #595959;
  background: #fafafa;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 12px;
}
.fee-line b {
  color: #cf1322;
}
.total-line {
  font-size: 15px;
  padding: 10px 12px;
  border-top: 1px solid #f0f0f0;
}
.total-line b {
  color: #cf1322;
  font-size: 18px;
}
.total-sub {
  font-size: 12px;
  color: #8c8c8c;
  margin-left: 4px;
}
</style>
