<template>
  <div>
    <van-search v-model="keyword" placeholder="搜索房号" @search="fetch" />

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

    <div class="stat-row">
      <div class="stat"><b>{{ list.length }}</b><span>总房源</span></div>
      <div class="stat"><b class="c-empty">{{ countBy('empty') }}</b><span>空置</span></div>
      <div class="stat"><b class="c-rented">{{ countBy('rented') }}</b><span>已租</span></div>
      <div class="stat"><b class="c-fix">{{ countBy('maintenance') }}</b><span>维修中</span></div>
      <div class="stat"><b class="c-clean">{{ countBy('cleaning') }}</b><span>待清扫</span></div>
    </div>

    <div style="margin: 12px 0">
      <van-button type="primary" block round @click="openCreate">新增房源</van-button>
    </div>

    <van-empty v-if="!list.length" description="暂无房源" />

    <div v-else class="grid">
      <div
        class="room"
        :class="'s-' + (r.status || 'empty')"
        v-for="r in list"
        :key="r.id"
        @click="openEdit(r)"
      >
        <div class="r-head">
          <span class="r-no">{{ r.roomNo }}</span>
          <span class="r-tag">{{ statusText(r.status) }}</span>
        </div>
        <div class="r-sub">{{ storeName(r.storeId) }}</div>
        <div class="r-sub r-dim">{{ r.type || '—' }} · {{ r.area ?? '—' }}㎡ · {{ r.floor ?? '—' }}层</div>
        <div class="r-rent">¥{{ r.rent ?? 0 }}<span class="r-unit">/月</span></div>
        <div class="r-sub r-resident" v-if="r.resident">在住：{{ r.resident }}</div>
        <div class="r-meter">水 {{ r.waterMeter ?? 0 }} · 电 {{ r.electricityMeter ?? 0 }}</div>
      </div>
    </div>

    <MobileFormSheet
      v-model:show="formShow"
      :title="editingId ? '编辑房源' : '新增房源'"
      :loading="saving"
      @submit="submit"
    >
      <div class="grp">基本信息</div>
      <van-cell-group inset>
        <MobileSelectField
          v-model="form.storeId"
          label="所属门店"
          required
          :options="storeOptions"
        />
        <van-field v-model="form.roomNo" label="房号" placeholder="如 A-101" required />
        <van-field v-model="form.floor" type="number" label="楼层" placeholder="1" />
        <van-field v-model="form.area" type="number" label="面积(㎡)" placeholder="30" />
        <MobileSelectField v-model="form.type" label="户型" :options="typeOptions" />
      </van-cell-group>

      <div class="grp">费用与状态</div>
      <van-cell-group inset>
        <van-field v-model="form.rent" type="number" label="月租(元)" placeholder="0" />
        <van-field v-model="form.deposit" type="number" label="押金(元)" placeholder="0" />
        <MobileSelectField v-model="form.status" label="状态" :options="statusOptions" />
      </van-cell-group>

      <div class="grp">水电表</div>
      <van-cell-group inset>
        <van-field v-model="form.waterMeter" type="number" label="水表读数" placeholder="0" />
        <van-field v-model="form.electricityMeter" type="number" label="电表读数" placeholder="0" />
        <MobileDateField v-model="form.meterDate" label="抄表日期" />
      </van-cell-group>

      <div v-if="editingId" class="danger">
        <van-button block round plain type="danger" @click="remove">删除该房源</van-button>
      </div>
    </MobileFormSheet>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
// 显式按需引入 Vant 组件 + 共用样式
import {
  Search as VanSearch,
  Button as VanButton,
  Empty as VanEmpty,
  CellGroup as VanCellGroup,
  Field as VanField,
  showConfirmDialog,
  showToast
} from 'vant'
import './vant.css'
import MobileSelectField from './MobileSelectField.vue'
import MobileDateField from './MobileDateField.vue'
import MobileFormSheet from './MobileFormSheet.vue'
import { roomApi, storeApi } from '@/api'

const list = ref([])
const stores = ref([])
const keyword = ref('')
const filterStore = ref('')
const filterStatus = ref('')

const route = useRoute()

// 从首页点房号跳转而来（?edit=房间ID）：列表加载后自动打开该房间编辑
function openEditByQuery() {
  const id = route.query.edit
  if (id === undefined || id === null || id === '') return
  const room = list.value.find((r) => String(r.id) === String(id))
  if (room) openEdit(room)
}
watch(() => route.query.edit, openEditByQuery)

const formShow = ref(false)
const saving = ref(false)
const editingId = ref(null)

const TYPE_OPTIONS = ['单间', '一室一厅', '两室一厅', '三室一厅', '其他'].map((t) => ({
  text: t,
  value: t
}))
const typeOptions = TYPE_OPTIONS
const statusOptions = [
  { text: '空置', value: 'empty' },
  { text: '已租', value: 'rented' },
  { text: '维修中', value: 'maintenance' },
  { text: '待清扫', value: 'cleaning' }
]
const statusFilterOptions = [{ text: '全部', value: '' }, ...statusOptions]

const storeOptions = computed(() => stores.value.map((s) => ({ text: s.name, value: s.id })))
const storeFilterOptions = computed(() => [
  { text: '全部', value: '' },
  ...stores.value.map((s) => ({ text: s.name, value: s.id }))
])

function emptyForm() {
  return {
    storeId: '',
    roomNo: '',
    floor: 1,
    area: 30,
    type: '一室一厅',
    rent: 0,
    deposit: 0,
    status: 'empty',
    waterMeter: 0,
    electricityMeter: 0,
    meterDate: ''
  }
}
const form = reactive(emptyForm())

function statusText(s) {
  return { empty: '空置', rented: '已租', maintenance: '维修中', cleaning: '待清扫' }[s] || '空置'
}
function storeName(id) {
  return stores.value.find((s) => s.id === id)?.name || '—'
}
function countBy(status) {
  return list.value.filter((r) => r.status === status).length
}

async function fetch() {
  const params = {}
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  if (filterStore.value !== '') params.storeId = filterStore.value
  if (filterStatus.value !== '') params.status = filterStatus.value
  const res = await roomApi.list(params)
  list.value = res.list || []
}

function openCreate() {
  editingId.value = null
  Object.assign(form, emptyForm())
  if (stores.value.length) form.storeId = stores.value[0].id
  formShow.value = true
}

function openEdit(record) {
  editingId.value = record.id
  Object.assign(form, emptyForm(), {
    storeId: record.storeId ?? '',
    roomNo: record.roomNo || '',
    floor: record.floor ?? 1,
    area: record.area ?? 30,
    type: record.type || '一室一厅',
    rent: record.rent ?? 0,
    deposit: record.deposit ?? 0,
    status: record.status || 'empty',
    waterMeter: record.waterMeter ?? 0,
    electricityMeter: record.electricityMeter ?? 0,
    meterDate: record.meterDate || ''
  })
  formShow.value = true
}

async function submit() {
  if (!form.storeId) return showToast('请选择门店')
  if (!String(form.roomNo).trim()) return showToast('请输入房号')

  saving.value = true
  try {
    const payload = {
      storeId: form.storeId,
      roomNo: String(form.roomNo).trim(),
      floor: Number(form.floor) || 1,
      area: Number(form.area) || 0,
      type: form.type,
      rent: Number(form.rent) || 0,
      deposit: Number(form.deposit) || 0,
      status: form.status,
      waterMeter: Number(form.waterMeter) || 0,
      electricityMeter: Number(form.electricityMeter) || 0,
      meterDate: form.meterDate || ''
    }
    if (editingId.value) {
      await roomApi.update(editingId.value, payload)
      showToast('已保存')
    } else {
      await roomApi.create(payload)
      showToast('已新增房源')
    }
    formShow.value = false
    fetch()
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function remove() {
  try {
    await showConfirmDialog({
      title: '确认删除',
      message: `确定删除房源「${form.roomNo}」吗？该操作不可撤销。`
    })
  } catch {
    return
  }
  await roomApi.remove(editingId.value)
  showToast('已删除')
  formShow.value = false
  fetch()
}

onMounted(async () => {
  const s = await storeApi.list()
  stores.value = s.list || []
  await fetch()
  openEditByQuery()
})
</script>

<style scoped>
.stat-row {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
  margin: 12px 0 4px;
}
.stat {
  background: #fafafa;
  border-radius: 10px;
  padding: 10px 4px;
  text-align: center;
}
.stat b {
  display: block;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.2;
}
.stat span {
  font-size: 11px;
  color: #8c8c8c;
}
.c-empty {
  color: #1677ff;
}
.c-rented {
  color: #389e0d;
}
.c-fix {
  color: #d46b08;
}
.c-clean {
  color: #faad14;
}

.grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}
.room {
  border: 1px solid #f0f0f0;
  border-left-width: 4px;
  border-radius: 10px;
  padding: 10px;
  background: #fff;
}
.room.s-empty {
  border-left-color: #1677ff;
}
.room.s-rented {
  border-left-color: #389e0d;
}
.room.s-maintenance {
  border-left-color: #d46b08;
}
.room.s-cleaning {
  border-left-color: #faad14;
}
.room.s-cleaning .r-tag {
  background: #fff7e6;
  color: #ad6800;
}
.r-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.r-no {
  font-size: 16px;
  font-weight: 500;
}
.r-tag {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 8px;
  background: #f1efe8;
  color: #5f5e5a;
  white-space: nowrap;
}
.room.s-empty .r-tag {
  background: #e6f1fb;
  color: #185fa5;
}
.room.s-rented .r-tag {
  background: #eaf3de;
  color: #27500a;
}
.room.s-maintenance .r-tag {
  background: #faeeda;
  color: #854f0b;
}
.r-sub {
  font-size: 12px;
  color: #555;
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.r-dim {
  color: #999;
}
.r-resident {
  color: #389e0d;
}
.r-rent {
  margin-top: 6px;
  font-size: 15px;
  font-weight: 500;
  color: #cf1322;
}
.r-unit {
  font-size: 11px;
  color: #999;
  font-weight: 400;
}
.r-meter {
  margin-top: 4px;
  font-size: 11px;
  color: #8c8c8c;
}

.grp {
  font-size: 13px;
  color: #8c8c8c;
  padding: 14px 16px 6px;
}
.danger {
  padding: 20px 16px 8px;
}
</style>
