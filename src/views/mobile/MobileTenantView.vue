<template>
  <div>
    <van-search v-model="keyword" placeholder="搜索姓名 / 电话" @search="fetch" />

    <van-cell-group inset>
      <MobileSelectField
        v-model="filterStore"
        label="按门店"
        placeholder="全部"
        :options="storeFilterOptions"
        @change="fetch"
      />
      <MobileSelectField
        v-model="filterStatus"
        label="按状态"
        placeholder="全部"
        :options="statusFilterOptions"
        @change="fetch"
      />
    </van-cell-group>

    <MobileStatBar :items="statItems" />

    <div style="margin: 12px 0">
      <van-button type="primary" block round @click="openCreate">办理新入住</van-button>
    </div>

    <van-empty v-if="!list.length" description="暂无租户" />

    <div v-else class="list">
      <div class="card" v-for="t in list" :key="t.id">
        <div class="c-head">
          <span class="c-name">{{ t.name }}</span>
          <span class="c-tag" :class="t.status === 'active' ? 'on' : 'off'">
            {{ t.status === 'active' ? '在住' : '已退租' }}
          </span>
        </div>
        <div class="c-sub">{{ storeName(t.storeId) }} · {{ roomNo(t.roomId) }}</div>
        <div class="c-sub">押金 ¥{{ t.deposit ?? 0 }} · 月租 ¥{{ t.rent ?? 0 }}</div>
        <div class="c-sub c-dim">
          入住 {{ t.checkInDate || '—' }} · 房租到期 {{ t.rentDueDate || '—' }}
        </div>
        <div class="c-sub c-dim" v-if="t.checkOutDate">
          退房 {{ t.checkOutDate }}
        </div>
        <div class="c-actions">
          <van-button v-if="hasAttach(t)" size="small" plain @click="viewAttach(t)">附件</van-button>
          <van-button size="small" plain @click="openEdit(t)">编辑</van-button>
          <van-button size="small" type="danger" plain @click="remove(t)">删除</van-button>
        </div>
      </div>
    </div>

    <MobileTenantForm
      v-model:show="formShow"
      :record="editing"
      :stores="stores"
      :rooms="rooms"
      @saved="onSaved"
    />

    <van-popup v-model:show="attachShow" position="bottom" round>
      <div class="attach">
        <div class="sheet-title">附件 · {{ attachName }}</div>
        <template v-if="attachView.front || attachView.back || attachView.contracts.length">
          <div v-if="attachView.front" class="att">
            <div class="up-cap">身份证正面</div>
            <img :src="attachView.front" @click="preview(attachView.front)" />
          </div>
          <div v-if="attachView.back" class="att">
            <div class="up-cap">身份证反面</div>
            <img :src="attachView.back" @click="preview(attachView.back)" />
          </div>
          <div v-for="(c, i) in attachView.contracts" :key="i" class="att">
            <div class="up-cap">{{ c.name || '合同' }}</div>
            <img :src="c.url" @click="preview(c.url)" />
          </div>
        </template>
        <van-empty v-else description="该租户暂无附件" />
      </div>
    </van-popup>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
// 显式按需引入 Vant 组件 + 各自 CSS
import {
  Search as VanSearch,
  Button as VanButton,
  Empty as VanEmpty,
  Popup as VanPopup,
  showConfirmDialog,
  showImagePreview,
  showToast
} from 'vant'
import './vant.css'
import MobileSelectField from './MobileSelectField.vue'
import MobileTenantForm from './MobileTenantForm.vue'
import MobileStatBar from './MobileStatBar.vue'
import { tenantApi, storeApi, roomApi } from '@/api'
import { safeResolveImage, resolveImageList } from '@/utils/authImage'

const route = useRoute()

const list = ref([])
const stores = ref([])
const rooms = ref([])
const keyword = ref('')
const filterStore = ref('')
const filterStatus = ref('')

const formShow = ref(false)
const editing = ref(null)

const attachShow = ref(false)
const attachName = ref('')
const attachView = reactive({ front: null, back: null, contracts: [] })

const storeFilterOptions = computed(() => [
  { text: '全部', value: '' },
  ...stores.value.map((s) => ({ text: s.name, value: s.id }))
])
const statusFilterOptions = [
  { text: '全部', value: '' },
  { text: '在住', value: 'active' },
  { text: '已退租', value: 'left' }
]

function storeName(id) {
  return stores.value.find((s) => s.id === id)?.name || '—'
}
function roomNo(id) {
  if (!id) return '—'
  return rooms.value.find((r) => r.id === id)?.roomNo || '—'
}
function hasAttach(r) {
  const a = r.attachments || {}
  return !!(a.idCardFront?.url || a.idCardBack?.url || (a.contracts && a.contracts.length))
}
function countBy(status) {
  return list.value.filter((t) => t.status === status).length
}
// 统计随当前筛选联动，口径与桌面「租户管理」StatCards 一致
const statItems = computed(() => [
  { label: '总租户', value: list.value.length },
  { label: '在住', value: countBy('active'), color: '#389e0d' },
  { label: '已退租', value: countBy('left'), color: '#8c8c8c' }
])

async function fetch() {
  const params = {}
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  if (filterStore.value !== '') params.storeId = filterStore.value
  if (filterStatus.value !== '') params.status = filterStatus.value
  try {
    const res = await tenantApi.list(params)
    list.value = res.list || []
  } catch {
    // 错误提示已由统一请求拦截器给出，这里只避免未捕获的 Promise 异常
  }
}

function openCreate() {
  editing.value = null
  formShow.value = true
}
// 附件读取需 JWT：先把服务端 url 解析成 blob:，再交给表单缩略图 / 全屏预览
async function openEdit(record) {
  editing.value = await withResolvedAttachments(record)
  formShow.value = true
}
function onSaved() {
  fetch()
}

async function remove(record) {
  try {
    await showConfirmDialog({ title: '确认删除', message: `确定删除「${record.name}」吗？` })
  } catch {
    return
  }
  try {
    await tenantApi.remove(record.id)
    showToast('已删除')
    fetch()
  } catch {
    // 失败提示由统一请求拦截器给出
  }
}

// 把一条租户记录里的附件 url 全部转成可直接用于 <img>/预览的 blob: URL
async function withResolvedAttachments(record) {
  const a = record.attachments || {}
  const [urls, front, back] = await Promise.all([
    resolveImageList((a.contracts || []).map((c) => c.url)),
    safeResolveImage(a.idCardFront?.url),
    safeResolveImage(a.idCardBack?.url)
  ])
  return {
    ...record,
    attachments: {
      idCardFront: a.idCardFront?.url ? { ...a.idCardFront, url: front } : null,
      idCardBack: a.idCardBack?.url ? { ...a.idCardBack, url: back } : null,
      contracts: (a.contracts || []).map((c, i) => ({ ...c, url: urls[i] || c.url }))
    }
  }
}

async function viewAttach(record) {
  attachName.value = record.name
  attachView.front = null
  attachView.back = null
  attachView.contracts = []
  attachShow.value = true
  const a = await withResolvedAttachments(record)
  attachView.front = a.attachments.idCardFront?.url || null
  attachView.back = a.attachments.idCardBack?.url || null
  attachView.contracts = a.attachments.contracts
}
async function preview(url) {
  if (!url) return
  const src = await safeResolveImage(url)
  if (src) showImagePreview([src])
}

onMounted(async () => {
  const [s, r] = await Promise.all([storeApi.list(), roomApi.list()])
  stores.value = s.list || []
  rooms.value = r.list || []
  await fetch()
  if (route.query.create === '1') {
    openCreate()
  }
})
</script>

<style scoped>
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
}
.c-tag.on {
  background: #eaf3de;
  color: #27500a;
}
.c-tag.off {
  background: #f1efe8;
  color: #5f5e5a;
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
.attach {
  padding: 16px 14px 24px;
  max-height: 76vh;
  overflow-y: auto;
}
.sheet-title {
  font-size: 15px;
  font-weight: 500;
  margin-bottom: 10px;
}
.att {
  margin-bottom: 12px;
}
.att img {
  width: 100%;
  max-height: 220px;
  object-fit: contain;
  border: 1px solid #eee;
  border-radius: 8px;
  background: #fafafa;
}
</style>
