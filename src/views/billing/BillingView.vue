<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">收费账单</span>
      <a-space wrap>
        <a-month-picker
          v-model:value="filterMonth"
          placeholder="选择月份查看"
          value-format="YYYY-MM"
          :allow-clear="true"
          @change="fetch"
        />
        <a-select
          v-model:value="filterStore"
          placeholder="按门店筛选"
          style="width: 180px"
          allow-clear
          @change="fetch"
        >
          <a-select-option v-for="s in stores" :key="s.id" :value="s.id">
            {{ s.name }}
          </a-select-option>
        </a-select>
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索单号/租户/房号"
          style="width: 220px"
          allow-clear
          @search="fetch"
        />
      </a-space>
    </div>

    <a-card size="small" style="margin-bottom: 12px">
      <a-row :gutter="16" align="middle">
        <a-col :xs="12" :sm="6">
          <a-statistic title="查看月份" :value="filterMonth || '全部'" />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic title="收款笔数" :value="list.length" suffix="笔" />
        </a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic
            title="合计金额"
            :value="totalAmount"
            prefix="¥"
            :value-style="{ color: '#cf1322' }"
          />
        </a-col>
        <a-col :xs="12" :sm="6">
          <div style="font-size: 12px; color: #8c8c8c; margin-bottom: 4px">按门店小计</div>
          <template v-if="monthlyByStore.length">
            <div v-for="s in monthlyByStore" :key="s.store" style="font-size: 12px; line-height: 18px">
              {{ s.store }}：¥{{ s.amount }}（{{ s.count }}笔）
            </div>
          </template>
          <div v-else style="font-size: 12px; color: #8c8c8c">—</div>
        </a-col>
      </a-row>
    </a-card>

    <a-table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      row-key="id"
      :pagination="{ pageSize: 10 }"
      size="middle"
      :scroll="{ x: 'max-content' }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'amount'">
          <span style="color: #cf1322; font-weight: 600">¥{{ record.amount }}</span>
        </template>
        <template v-else-if="column.key === 'utility'">
          <template v-if="hasUtility(record)">
            <div style="font-size: 12px; line-height: 16px">
              水 ¥{{ record.waterFee }}（{{ record.waterUsage }}）
              <span class="u-mode">{{ modeText(record.waterMode || record.utilityMode) }}</span>
            </div>
            <div style="font-size: 12px; line-height: 16px">
              电 ¥{{ record.electricityFee }}（{{ record.electricityUsage }}）
              <span class="u-mode">{{ modeText(record.electricityMode || record.utilityMode) }}</span>
            </div>
          </template>
          <span v-else style="color: #bfbfbf">—</span>
        </template>
        <template v-else-if="column.key === 'period'">
          <div class="due-new">{{ record.rentNewDue || '—' }}</div>
          <div v-if="record.rentOldDue || record.rentNewDue" class="due-range">
            起 {{ record.rentOldDue || '—' }} → 止 {{ record.rentNewDue || '—' }}
          </div>
        </template>
        <template v-else-if="column.key === 'action'">
          <a @click="openDetail(record)">查看详情</a>
        </template>
      </template>

      <template #emptyText>
        <span style="color: #8c8c8c">暂无收款记录。可在「工作台」当前在住里点击「房租收缴」生成。</span>
      </template>
    </a-table>

    <!-- 收款记录详情：删除入口收进详情，避免列表误触；删除前给出后果提醒 + 二次确认 -->
    <a-modal v-model:open="detailOpen" title="收款记录详情" :footer="null" :width="640">
      <template v-if="current">
        <div class="kv">
          <div class="kv-item" v-for="row in detailRows" :key="row.label">
            <span class="kv-k">{{ row.label }}</span>
            <span class="kv-v">{{ row.value }}</span>
          </div>
        </div>

        <a-alert
          type="warning"
          show-icon
          style="margin-top: 16px"
          message="删除收款记录需谨慎"
          description="删除后该笔收款将从账单中消失、合计金额随之变化，且不可撤销。若本笔为抄表计费，房间水电表读数不会回退，下次计费基数可能偏小；删除操作会记入操作日志，可追溯。"
        />

        <div class="detail-footer">
          <a-button @click="detailOpen = false">关闭</a-button>
          <a-popconfirm
            title="再次确认：删除后不可撤销"
            ok-text="确认删除"
            cancel-text="取消"
            @confirm="removeCurrent"
          >
            <a-button danger :loading="removing">删除该记录</a-button>
          </a-popconfirm>
        </div>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { paymentApi, storeApi } from '@/api'

const list = ref([])
const stores = ref([])
const loading = ref(false)
const keyword = ref('')
const filterStore = ref(undefined)
// 未选月份时默认显示当前月
const defaultMonth = (() => {
  const n = new Date()
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}`
})()
const filterMonth = ref(defaultMonth)

const columns = [
  { title: '收款单号', dataIndex: 'no', key: 'no', width: 120 },
  { title: '租户', dataIndex: 'tenantName', key: 'tenantName', width: 90 },
  { title: '所属门店', dataIndex: 'storeName', key: 'storeName' },
  { title: '房间', dataIndex: 'roomNo', key: 'roomNo', width: 80 },
  { title: '收取金额', key: 'amount', width: 100 },
  { title: '其中水电费', key: 'utility', width: 160 },
  { title: '房租到期日', key: 'period', width: 150 },
  { title: '收款日期', dataIndex: 'paidAt', key: 'paidAt', width: 160 },
  { title: '备注', dataIndex: 'remark', key: 'remark', ellipsis: true },
  { title: '操作', key: 'action', width: 90 }
]

const totalAmount = computed(() => list.value.reduce((sum, p) => sum + (p.amount || 0), 0))

// 是否包含水电费（水/电任一有费用或用量）
function hasUtility(p) {
  return (
    Number(p?.waterFee) > 0 ||
    Number(p?.electricityFee) > 0 ||
    Number(p?.waterUsage) > 0 ||
    Number(p?.electricityUsage) > 0
  )
}
// 计费方式标签：兼容旧数据（仅有统一的 utilityMode）
function modeText(mode) {
  if (mode === 'meter') return '抄表'
  if (mode === 'flat') return '包月'
  return ''
}

// 按月汇总小计：按门店拆分
const monthlyByStore = computed(() => {
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

async function fetch() {
  loading.value = true
  try {
    const res = await paymentApi.list({
      keyword: keyword.value,
      storeId: filterStore.value,
      month: filterMonth.value
    })
    list.value = res.list
  } finally {
    loading.value = false
  }
}

// ---------- 详情与删除 ----------
const detailOpen = ref(false)
const current = ref(null)
const removing = ref(false)

const detailRows = computed(() => {
  const p = current.value
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
  current.value = record
  detailOpen.value = true
}

async function removeCurrent() {
  if (!current.value) return
  removing.value = true
  try {
    await paymentApi.remove(current.value.id)
    message.success('已删除收款记录')
    detailOpen.value = false
    current.value = null
    fetch()
  } catch (e) {
    message.error(e?.response?.data?.message || e.message || '删除失败')
  } finally {
    removing.value = false
  }
}

onMounted(async () => {
  const s = await storeApi.list()
  stores.value = s.list
  fetch()
})
</script>

<style scoped>
.u-mode {
  display: inline-block;
  font-size: 11px;
  color: #1668dc;
  background: #e8f2ff;
  border-radius: 4px;
  padding: 0 5px;
  margin-left: 4px;
}
.due-new {
  font-weight: 600;
  color: rgba(0, 0, 0, 0.88);
}
.due-range {
  font-size: 11px;
  color: #8c8c8c;
  margin-top: 2px;
  line-height: 16px;
}
.kv {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}
.kv-item {
  display: flex;
  gap: 8px;
  font-size: 13px;
  line-height: 1.6;
  min-width: 0;
}
.kv-k {
  flex: 0 0 88px;
  color: #8c8c8c;
}
.kv-v {
  flex: 1;
  min-width: 0;
  color: rgba(0, 0, 0, 0.88);
  word-break: break-all;
}
.detail-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
}
@media (max-width: 640px) {
  .kv {
    grid-template-columns: 1fr;
  }
}
</style>
