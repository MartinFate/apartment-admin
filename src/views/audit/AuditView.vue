<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">操作日志</span>
      <a-space>
        <a-button :loading="exporting" @click="exportCsv">
          <template #icon><DownloadOutlined /></template>
          导出 CSV
        </a-button>
        <a-button @click="refresh">
          <template #icon><ReloadOutlined /></template>
          刷新
        </a-button>
      </a-space>
    </div>

    <a-alert type="info" show-icon style="margin-bottom: 12px">
      <template #message>审计说明</template>
      <template #description>
        自 <b>{{ meta.since || '—' }}</b> 起记录，启用前的历史操作不可追溯（此前的删收款 / 改到期日为测试数据）。
        日志只追加、不提供删除，保留 {{ meta.retentionDays === 0 ? '永久' : (meta.retentionDays || 180) + ' 天' }}。
        {{ meta.logReads ? '当前记录全部查询请求。' : '普通列表查询默认不记录；登录、附件查看、日志导出与所有写操作均记录。' }}
      </template>
    </a-alert>

    <a-card size="small" style="margin-bottom: 12px">
      <a-row :gutter="16">
        <a-col :xs="12" :sm="6"><a-statistic title="累计日志" :value="meta.stats?.total ?? 0" /></a-col>
        <a-col :xs="12" :sm="6"><a-statistic title="今日" :value="meta.stats?.today ?? 0" /></a-col>
        <a-col :xs="12" :sm="6">
          <a-statistic title="失败操作" :value="meta.stats?.failed ?? 0" :value-style="{ color: '#cf1322' }" />
        </a-col>
        <a-col :xs="12" :sm="6"><a-statistic title="操作账号数" :value="meta.stats?.actors ?? 0" /></a-col>
      </a-row>
    </a-card>

    <a-card size="small" style="margin-bottom: 12px">
      <a-space wrap>
        <a-select
          v-model:value="filters.module"
          placeholder="模块"
          style="width: 150px"
          allow-clear
          :options="moduleOptions"
        />
        <a-select
          v-model:value="filters.action"
          placeholder="动作"
          style="width: 140px"
          allow-clear
          :options="actionOptions"
        />
        <a-select
          v-model:value="filters.status"
          placeholder="结果"
          style="width: 110px"
          allow-clear
          :options="statusOptions"
        />
        <a-input v-model:value="filters.dateFrom" type="date" style="width: 150px" />
        <span style="color: #8c8c8c">至</span>
        <a-input v-model:value="filters.dateTo" type="date" style="width: 150px" />
        <a-input
          v-model:value="filters.keyword"
          placeholder="操作人 / 对象 / 路径"
          style="width: 200px"
          allow-clear
          @press-enter="search"
        />
        <a-button type="primary" @click="search">查询</a-button>
        <a-button @click="reset">重置</a-button>
      </a-space>
    </a-card>

    <a-table
      :columns="columns"
      :data-source="list"
      :loading="loading"
      row-key="id"
      :pagination="pagination"
      :scroll="{ x: 'max-content' }"
      size="middle"
      @change="onTableChange"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'module'">{{ record.moduleLabel }}</template>
        <template v-else-if="column.key === 'action'"><a-tag>{{ record.actionLabel }}</a-tag></template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.status === 'fail' ? 'red' : 'green'">
            {{ record.status === 'fail' ? '失败' : '成功' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'target'">
          <span>{{ record.targetLabel || '—' }}</span>
          <span v-if="record.targetId" class="tid">#{{ record.targetId }}</span>
        </template>
        <template v-else-if="column.key === 'detail'">
          <a @click="openDetail(record)">查看明细</a>
        </template>
      </template>
    </a-table>

    <a-drawer v-model:open="drawerOpen" title="日志明细" :width="isMobile ? '92vw' : 560">
      <template v-if="current">
        <div class="kv">
          <div class="kv-item" v-for="row in baseRows" :key="row.label">
            <span class="kv-k">{{ row.label }}</span>
            <span class="kv-v">{{ row.value }}</span>
          </div>
        </div>

        <template v-if="current.detail?.before || current.detail?.after">
          <div class="sec">变更前 / 变更后</div>
          <div class="diff">
            <div>
              <div class="diff-h">变更前</div>
              <pre class="json">{{ fmt(current.detail.before) }}</pre>
            </div>
            <div>
              <div class="diff-h">变更后</div>
              <pre class="json">{{ fmt(current.detail.after) }}</pre>
            </div>
          </div>
        </template>

        <div class="sec">完整明细（已脱敏）</div>
        <pre class="json">{{ fmt(current.detail) }}</pre>
      </template>
    </a-drawer>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons-vue'
import { auditApi } from '@/api'
import { useIsMobile } from '@/composables/useIsMobile'

const { isMobile } = useIsMobile()

const meta = ref({ since: '', retentionDays: 180, logReads: false, modules: [], actions: [], stats: {} })
const list = ref([])
const loading = ref(false)
const exporting = ref(false)
const drawerOpen = ref(false)
const current = ref(null)

const emptyFilters = () => ({
  module: '', action: '', status: '', dateFrom: '', dateTo: '', keyword: ''
})
const filters = reactive(emptyFilters())
const pagination = reactive({
  current: 1,
  pageSize: 20,
  total: 0,
  showSizeChanger: true,
  showTotal: (t) => `共 ${t} 条`
})

const moduleOptions = computed(() => meta.value.modules || [])
const actionOptions = computed(() => meta.value.actions || [])
const statusOptions = [
  { value: 'success', label: '成功' },
  { value: 'fail', label: '失败' }
]

const columns = [
  { title: '时间', dataIndex: 'ts', key: 'ts', width: 165 },
  { title: '操作人', dataIndex: 'actorName', key: 'actorName', width: 110 },
  { title: '模块', key: 'module', width: 110 },
  { title: '动作', key: 'action', width: 100 },
  { title: '对象', key: 'target', width: 180 },
  { title: '结果', key: 'status', width: 80 },
  { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130 },
  { title: '请求路径', dataIndex: 'path', key: 'path', ellipsis: true },
  { title: '明细', key: 'detail', width: 90 }
]

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
  const p = { page: pagination.current, pageSize: pagination.pageSize }
  for (const [k, v] of Object.entries(filters)) if (v) p[k] = v
  return p
}

async function fetchList() {
  loading.value = true
  try {
    const res = await auditApi.list(queryParams())
    list.value = res.list || []
    pagination.total = res.total || 0
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
  pagination.current = 1
  fetchList()
}
function reset() {
  Object.assign(filters, emptyFilters())
  search()
}
function refresh() {
  fetchMeta()
  fetchList()
}
function onTableChange(pag) {
  pagination.current = pag.current || 1
  pagination.pageSize = pag.pageSize || 20
  fetchList()
}
function openDetail(r) {
  current.value = r
  drawerOpen.value = true
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
    message.success('已导出 CSV')
    // 导出本身会产生一条日志，刷新让界面立即反映
    refresh()
  } catch (e) {
    message.error(e?.message || '导出失败')
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
.page-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}
.page-title {
  font-size: 18px;
  font-weight: 600;
}
.tid {
  margin-left: 6px;
  font-size: 11px;
  color: #8c8c8c;
}
.kv {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}
.kv-item {
  display: flex;
  gap: 10px;
  font-size: 13px;
  line-height: 1.6;
}
.kv-k {
  flex: 0 0 92px;
  color: #8c8c8c;
}
.kv-v {
  flex: 1;
  min-width: 0;
  word-break: break-all;
}
.sec {
  font-size: 13px;
  font-weight: 600;
  margin: 18px 0 8px;
}
.diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.diff-h {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 4px;
}
.json {
  margin: 0;
  padding: 10px;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
}
@media (max-width: 640px) {
  .diff {
    grid-template-columns: 1fr;
  }
}
</style>
