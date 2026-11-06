<template>
  <div>
    <van-search v-model="filters.keyword" placeholder="操作人 / 对象 / 路径" @search="search" />

    <div class="act-row">
      <van-button block round plain @click="filterShow = true">筛选</van-button>
      <van-button block round plain :loading="exporting" @click="exportCsv">导出</van-button>
    </div>

    <div class="note">
      审计自 {{ meta.since || '—' }} 起，启用前历史操作不可追溯；日志只追加、不可删除，保留
      {{ meta.retentionDays === 0 ? '永久' : (meta.retentionDays || 180) + ' 天' }}。
    </div>

    <div class="stat">
      <div class="stat-cell" v-for="s in statItems" :key="s.label">
        <div class="stat-v">{{ s.value }}</div>
        <div class="stat-l">{{ s.label }}</div>
      </div>
    </div>

    <van-empty v-if="!list.length && !loading" description="暂无日志" />

    <div v-else class="list">
      <div class="card" v-for="r in list" :key="r.id" @click="openDetail(r)">
        <div class="c-head">
          <span class="c-title">{{ r.actionLabel }}</span>
          <span class="c-tag" :class="r.status === 'fail' ? 'fail' : 'ok'">
            {{ r.status === 'fail' ? '失败' : '成功' }}
          </span>
        </div>
        <div class="c-sub">{{ r.moduleLabel }} · {{ r.actorName || '未登录' }}</div>
        <div class="c-sub c-dim">{{ r.ts }}</div>
        <div class="c-sub" v-if="r.targetLabel">
          {{ r.targetLabel }}<span v-if="r.targetId" class="tid">#{{ r.targetId }}</span>
        </div>
      </div>
    </div>

    <div class="more" v-if="list.length < total">
      <van-button block round plain :loading="loading" @click="loadMore">加载更多</van-button>
    </div>

    <!-- 筛选 -->
    <van-popup v-model:show="filterShow" position="bottom" round>
      <div class="fp">
        <div class="fp-title">筛选条件</div>
        <van-cell-group inset>
          <MobileSelectField v-model="filters.module" label="模块" :options="moduleFieldOptions" />
          <MobileSelectField v-model="filters.action" label="动作" :options="actionFieldOptions" />
          <MobileSelectField v-model="filters.status" label="结果" :options="statusFieldOptions" />
          <van-field v-model="filters.dateFrom" type="date" label="开始日期" />
          <van-field v-model="filters.dateTo" type="date" label="结束日期" />
        </van-cell-group>
        <div class="fp-actions">
          <van-button block round plain @click="resetFilters">重置</van-button>
          <van-button block round type="primary" @click="applyFilters">查询</van-button>
        </div>
      </div>
    </van-popup>

    <!-- 日志明细（只读） -->
    <van-popup v-model:show="detailShow" position="bottom" round closeable :style="{ height: '76%' }">
      <div class="detail">
        <div class="detail-title">日志明细</div>
        <div class="detail-scroll" v-if="current">
          <div class="kv">
            <div class="kv-row" v-for="row in baseRows" :key="row.label">
              <span class="kv-k">{{ row.label }}</span>
              <span class="kv-v">{{ row.value }}</span>
            </div>
          </div>
          <template v-if="current.detail?.before || current.detail?.after">
            <div class="sec">变更前</div>
            <pre class="json">{{ fmt(current.detail.before) }}</pre>
            <div class="sec">变更后</div>
            <pre class="json">{{ fmt(current.detail.after) }}</pre>
          </template>
          <div class="sec">完整明细（已脱敏）</div>
          <pre class="json">{{ fmt(current.detail) }}</pre>
        </div>
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
// 显式按需引入 Vant 组件 + 共用样式
import {
  Search as VanSearch,
  Button as VanButton,
  Empty as VanEmpty,
  Popup as VanPopup,
  CellGroup as VanCellGroup,
  Field as VanField,
  showToast
} from 'vant'
import './vant.css'
import MobileSelectField from './MobileSelectField.vue'
import { auditApi } from '@/api'

const meta = ref({ since: '', retentionDays: 180, logReads: false, modules: [], actions: [], stats: {} })
const list = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = 20
const loading = ref(false)
const exporting = ref(false)
const filterShow = ref(false)
const detailShow = ref(false)
const current = ref(null)

const emptyFilters = () => ({
  module: '', action: '', status: '', dateFrom: '', dateTo: '', keyword: ''
})
const filters = reactive(emptyFilters())

const moduleFieldOptions = computed(() => [
  { text: '全部', value: '' },
  ...(meta.value.modules || []).map((m) => ({ text: m.label, value: m.value }))
])
const actionFieldOptions = computed(() => [
  { text: '全部', value: '' },
  ...(meta.value.actions || []).map((a) => ({ text: a.label, value: a.value }))
])
const statusFieldOptions = [
  { text: '全部', value: '' },
  { text: '成功', value: 'success' },
  { text: '失败', value: 'fail' }
]

const statItems = computed(() => [
  { label: '累计', value: meta.value.stats?.total ?? 0 },
  { label: '今日', value: meta.value.stats?.today ?? 0 },
  { label: '失败', value: meta.value.stats?.failed ?? 0 },
  { label: '账号数', value: meta.value.stats?.actors ?? 0 }
])

const baseRows = computed(() => {
  const r = current.value
  if (!r) return []
  return [
    ['时间', r.ts],
    ['操作人', `${r.actorName || '未登录'}${r.actorRole ? ' · ' + r.actorRole : ''}`],
    ['模块 / 动作', `${r.moduleLabel} / ${r.actionLabel}`],
    ['对象', r.targetLabel || '—'],
    ['目标 ID', r.targetId || '—'],
    ['结果', `${r.status === 'fail' ? '失败' : '成功'}（${r.statusCode}）`],
    ['IP', r.ip || '—'],
    ['请求', `${r.method || ''} ${r.path || ''}`],
    ['请求 ID', r.requestId || '—']
  ].map(([label, value]) => ({ label, value }))
})

function queryParams() {
  const p = { page: page.value, pageSize }
  for (const [k, v] of Object.entries(filters)) if (v) p[k] = v
  return p
}

async function fetchList(append = false) {
  loading.value = true
  try {
    const res = await auditApi.list(queryParams())
    const rows = res.list || []
    list.value = append ? [...list.value, ...rows] : rows
    total.value = res.total || 0
  } finally {
    loading.value = false
  }
}

async function fetchMeta() {
  try {
    meta.value = await auditApi.meta()
  } catch {
    /* 拦截器已统一提示 */
  }
}

function search() {
  page.value = 1
  fetchList()
}
function loadMore() {
  page.value += 1
  fetchList(true)
}
function applyFilters() {
  filterShow.value = false
  search()
}
function resetFilters() {
  Object.assign(filters, emptyFilters())
  filters.keyword = ''
  filterShow.value = false
  search()
}
function openDetail(r) {
  current.value = r
  detailShow.value = true
}
function fmt(v) {
  if (v === undefined || v === null || v === '') return '—'
  try {
    return JSON.stringify(v, null, 2)
  } catch {
    return String(v)
  }
}
async function exportCsv() {
  exporting.value = true
  try {
    const p = { ...queryParams() }
    delete p.page
    delete p.pageSize
    await auditApi.exportCsv(p)
    showToast('已导出 CSV')
    fetchMeta()
    search()
  } catch (e) {
    showToast(e?.message || '导出失败')
  } finally {
    exporting.value = false
  }
}

onMounted(() => {
  fetchMeta()
  fetchList()
})
</script>

<style scoped>
.act-row {
  display: flex;
  gap: 10px;
  margin: 0 12px 12px;
}
.note {
  margin: 0 12px 12px;
  font-size: 12px;
  color: #8c8c8c;
  background: #f0f5ff;
  border-radius: 8px;
  padding: 8px 10px;
  line-height: 1.6;
}
.stat {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin: 0 12px 12px;
}
.stat-cell {
  background: #fafafa;
  border-radius: 8px;
  padding: 8px 4px;
  text-align: center;
}
.stat-v {
  font-size: 17px;
  font-weight: 500;
  color: #323233;
}
.stat-l {
  font-size: 11px;
  color: #969799;
  margin-top: 2px;
}
.list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 0 12px;
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
  gap: 8px;
}
.c-title {
  font-size: 15px;
  font-weight: 500;
}
.c-tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  white-space: nowrap;
}
.c-tag.ok {
  background: #eaf3de;
  color: #27500a;
}
.c-tag.fail {
  background: #fceff0;
  color: #a8071a;
}
.c-sub {
  font-size: 13px;
  color: #555;
  margin-top: 4px;
}
.c-dim {
  color: #999;
  font-size: 12px;
}
.tid {
  margin-left: 6px;
  font-size: 11px;
  color: #999;
}
.more {
  padding: 12px;
}
.fp {
  padding-bottom: 16px;
}
.fp-title {
  text-align: center;
  font-size: 15px;
  font-weight: 500;
  padding: 16px 0 8px;
}
.fp-actions {
  display: flex;
  gap: 8px;
  padding: 16px 16px 0;
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
.sec {
  font-size: 13px;
  font-weight: 500;
  margin: 16px 0 6px;
}
.json {
  margin: 0;
  padding: 10px;
  background: #fafafa;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
