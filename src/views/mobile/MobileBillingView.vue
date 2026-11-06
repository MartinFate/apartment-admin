<template>
  <div>
    <van-search v-model="keyword" placeholder="搜索单号 / 租户 / 房号" @search="fetch" />

    <van-cell-group inset>
      <van-field
        :model-value="filterMonth || '全部月份'"
        label="查看月份"
        readonly
        is-link
        clickable
        @click="monthShow = true"
      />
      <MobileSelectField
        v-model="filterStore"
        label="按门店"
        placeholder="全部"
        :options="storeFilterOptions"
        @change="fetch"
      />
      <div v-if="filterMonth" class="clear-row">
        <van-button size="small" plain @click="clearMonth">清除月份（看全部）</van-button>
      </div>
    </van-cell-group>

    <div class="sum">
      <div class="sum-main">
        <div class="sum-label">合计金额（{{ list.length }} 笔）</div>
        <div class="sum-val">¥{{ totalAmount }}</div>
      </div>
      <div class="sum-side">
        <div class="sum-label">按门店小计</div>
        <div v-if="byStore.length">
          <div class="sum-line" v-for="s in byStore" :key="s.store">
            {{ s.store }}：¥{{ s.amount }}（{{ s.count }}笔）
          </div>
        </div>
        <div v-else class="sum-line sum-dim">—</div>
      </div>
    </div>

    <van-empty v-if="!list.length" description="暂无收款记录" />

    <div v-else class="list">
      <div class="card" v-for="p in list" :key="p.id">
        <div class="c-head">
          <span class="c-no">{{ p.no }}</span>
          <span class="c-amt">¥{{ p.amount ?? 0 }}</span>
        </div>
        <div class="c-sub">
          {{ p.tenantName || '—' }} · {{ p.storeName || '—' }} {{ p.roomNo || '' }}
        </div>
        <div class="c-sub c-dim">
          房租到期日：{{ p.rentNewDue || '—' }}
        </div>
        <div class="c-sub c-dim" v-if="p.rentOldDue || p.rentNewDue">
          起止区间：{{ p.rentOldDue || '—' }} → {{ p.rentNewDue || '—' }}
        </div>
        <div class="c-sub c-dim">
          收款日期 {{ p.paidAt || '—' }}
          <span v-if="p.remark"> · {{ p.remark }}</span>
        </div>
        <div v-if="hasUtility(p)" class="c-util">
          <div>
            <span class="u-tag">{{ modeText(p.waterMode || p.utilityMode) }}</span>
            水 ¥{{ p.waterFee }}（{{ p.waterUsage }}）
          </div>
          <div>
            <span class="u-tag">{{ modeText(p.electricityMode || p.utilityMode) }}</span>
            电 ¥{{ p.electricityFee }}（{{ p.electricityUsage }}）
          </div>
        </div>
        <div class="c-actions">
          <van-button size="small" plain @click="openDetail(p)">查看详情</van-button>
        </div>
      </div>
    </div>

    <van-popup v-model:show="monthShow" position="bottom" round>
      <van-picker
        :columns="monthColumns"
        :model-value="monthValue"
        title="选择月份"
        @confirm="onMonthConfirm"
        @cancel="monthShow = false"
      />
    </van-popup>

    <!-- 收款详情：删除入口收进详情，展示完整信息与风险提醒后再二次确认 -->
    <van-popup
      v-model:show="detailShow"
      position="bottom"
      round
      closeable
      :style="{ height: '76%' }"
    >
      <div class="detail">
        <div class="detail-title">收款记录详情</div>
        <div class="detail-scroll" v-if="detail">
          <div class="kv">
            <div class="kv-row" v-for="row in detailRows" :key="row.label">
              <span class="kv-k">{{ row.label }}</span>
              <span class="kv-v">{{ row.value }}</span>
            </div>
          </div>
          <div class="warn">
            <div class="warn-t">删除收款记录需谨慎</div>
            <div class="warn-b">
              删除后该笔收款将从账单中消失、合计金额随之变化，且不可撤销。若本笔为抄表计费，房间水电表读数不会回退，下次计费基数可能偏小；删除操作会记入操作日志，可追溯。
            </div>
          </div>
        </div>
        <div class="detail-actions">
          <van-button block round plain @click="detailShow = false">关闭</van-button>
          <van-button block round type="danger" :loading="removing" @click="removeCurrent">
            删除该记录
          </van-button>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
// 显式按需引入 Vant 组件 + 共用样式
import {
  Search as VanSearch,
  Button as VanButton,
  Empty as VanEmpty,
  Popup as VanPopup,
  Picker as VanPicker,
  CellGroup as VanCellGroup,
  Field as VanField,
  showConfirmDialog,
  showToast
} from 'vant'
import './vant.css'
import MobileSelectField from './MobileSelectField.vue'
import { paymentApi, storeApi } from '@/api'

const list = ref([])
const stores = ref([])
const keyword = ref('')
const filterStore = ref('')
const monthShow = ref(false)

const now = new Date()
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
const filterMonth = ref(thisMonth)

const years = []
for (let y = now.getFullYear() - 2; y <= now.getFullYear() + 1; y++) years.push(String(y))
const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))

// Vant Picker 的多列写法是「数组的数组」：[[{text,value}...], [{text,value}...]]。
// 写成 [{values:[...]}] 会被当成单列，渲染出空白滚轮。
const monthColumns = [
  years.map((y) => ({ text: y + ' 年', value: y })),
  months.map((m) => ({ text: m + ' 月', value: m }))
]
// 默认滚到当前月
const monthValue = ref([String(now.getFullYear()), months[now.getMonth()]])

const storeFilterOptions = computed(() => [
  { text: '全部', value: '' },
  ...stores.value.map((s) => ({ text: s.name, value: s.id }))
])

const totalAmount = computed(() => list.value.reduce((s, p) => s + (p.amount || 0), 0))

function hasUtility(p) {
  return (
    Number(p?.waterFee) > 0 ||
    Number(p?.electricityFee) > 0 ||
    Number(p?.waterUsage) > 0 ||
    Number(p?.electricityUsage) > 0
  )
}
function modeText(mode) {
  if (mode === 'meter') return '抄表'
  if (mode === 'flat') return '包月'
  return ''
}

const byStore = computed(() => {
  const map = new Map()
  for (const p of list.value) {
    const k = p.storeName || '未分配'
    const cur = map.get(k) || { store: k, count: 0, amount: 0 }
    cur.count += 1
    cur.amount += p.amount || 0
    map.set(k, cur)
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount)
})

function onMonthConfirm({ selectedValues }) {
  monthShow.value = false
  filterMonth.value = `${selectedValues[0]}-${selectedValues[1]}`
  monthValue.value = [selectedValues[0], selectedValues[1]]
  fetch()
}

function clearMonth() {
  filterMonth.value = ''
  fetch()
}

async function fetch() {
  const params = {}
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  if (filterStore.value !== '') params.storeId = filterStore.value
  if (filterMonth.value) params.month = filterMonth.value
  const res = await paymentApi.list(params)
  list.value = res.list || []
}

// ---------- 详情与删除 ----------
const detailShow = ref(false)
const detail = ref(null)
const removing = ref(false)

const detailRows = computed(() => {
  const p = detail.value
  if (!p) return []
  const money = (n) => `¥${n ?? 0}`
  const rows = [
    ['收款单号', p.no || '—'],
    ['租户', p.tenantName || '—'],
    ['所属门店', p.storeName || '—'],
    ['房间', p.roomNo || '—'],
    ['收取金额', money(p.amount)],
    ['其中房租', money(p.rentAmount)],
    ['收款日期', p.paidAt || '—'],
    ['录入时间', p.createdAt || '—'],
    ['房租到期日', p.rentNewDue || '—'],
    [
      '房租起止区间',
      (p.rentOldDue || p.rentNewDue) ? `${p.rentOldDue || '—'} → ${p.rentNewDue || '—'}` : '—'
    ],
    ['备注', p.remark || '—']
  ]
  if (hasUtility(p)) {
    rows.push(
      ['水费', `${money(p.waterFee)} · ${modeText(p.waterMode || p.utilityMode) || '未标注'} · 用量 ${p.waterUsage ?? 0}`],
      ['电费', `${money(p.electricityFee)} · ${modeText(p.electricityMode || p.utilityMode) || '未标注'} · 用量 ${p.electricityUsage ?? 0}`],
      ['水表读数', String(p.waterReading ?? 0)],
      ['电表读数', String(p.electricityReading ?? 0)]
    )
  }
  return rows.map(([label, value]) => ({ label, value }))
})

function openDetail(record) {
  detail.value = record
  detailShow.value = true
}

async function removeCurrent() {
  const p = detail.value
  if (!p) return
  try {
    await showConfirmDialog({
      title: '确认删除收款记录',
      message: `单号 ${p.no} · ${p.amount ?? 0} 元\n\n删除后不可撤销；抄表计费的水电表读数不会回退；该操作会记入操作日志。`,
      messageAlign: 'left',
      confirmButtonText: '确认删除',
      confirmButtonColor: '#ee0a24'
    })
  } catch {
    return
  }
  removing.value = true
  try {
    await paymentApi.remove(p.id)
    showToast('已删除')
    detailShow.value = false
    detail.value = null
    fetch()
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '删除失败')
  } finally {
    removing.value = false
  }
}

onMounted(async () => {
  const s = await storeApi.list()
  stores.value = s.list || []
  await fetch()
})
</script>

<style scoped>
.sum {
  display: flex;
  gap: 10px;
  margin: 12px 0;
  padding: 12px;
  background: #fafafa;
  border-radius: 12px;
}
.sum-main {
  flex: 1;
  min-width: 0;
}
.sum-side {
  flex: 1;
  min-width: 0;
  border-left: 1px solid #f0f0f0;
  padding-left: 10px;
}
.sum-label {
  font-size: 11px;
  color: #8c8c8c;
  margin-bottom: 4px;
}
.sum-val {
  font-size: 20px;
  font-weight: 500;
  color: #cf1322;
  line-height: 1.2;
}
.sum-line {
  font-size: 12px;
  color: #555;
  line-height: 18px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sum-dim {
  color: #999;
}

.clear-row {
  padding: 8px 16px 10px;
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
.c-no {
  font-size: 13px;
  color: #8c8c8c;
}
.c-amt {
  font-size: 17px;
  font-weight: 500;
  color: #cf1322;
}
.c-sub {
  font-size: 13px;
  color: #555;
  margin-top: 4px;
}
.c-dim {
  color: #999;
}
.c-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 10px;
}
.c-util {
  margin-top: 6px;
  font-size: 12px;
  color: #6b6b6b;
  background: #fafafa;
  border-radius: 6px;
  padding: 6px 8px;
}
.u-tag {
  display: inline-block;
  font-size: 11px;
  color: #1668dc;
  background: #e8f2ff;
  border-radius: 4px;
  padding: 0 5px;
  margin-right: 6px;
}

.detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 20px 16px 16px;
  box-sizing: border-box;
}
.detail-title {
  font-size: 16px;
  font-weight: 500;
  text-align: center;
  margin-bottom: 14px;
}
.detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.kv {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.kv-row {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.5;
}
.kv-k {
  flex: 0 0 92px;
  color: #969799;
}
.kv-v {
  flex: 1;
  min-width: 0;
  color: #323233;
  word-break: break-all;
}
.warn {
  margin-top: 16px;
  padding: 10px 12px;
  background: #fffbe8;
  border: 1px solid #ffe58f;
  border-radius: 8px;
}
.warn-t {
  font-size: 13px;
  font-weight: 500;
  color: #ad6800;
  margin-bottom: 4px;
}
.warn-b {
  font-size: 12px;
  color: #874d00;
  line-height: 1.6;
}
.detail-actions {
  display: flex;
  gap: 8px;
  padding-top: 12px;
}
</style>
