<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">房源管理</span>
      <a-space wrap>
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
        <a-select
          v-model:value="filterStatus"
          placeholder="按状态筛选"
          style="width: 140px"
          allow-clear
          @change="fetch"
        >
          <a-select-option value="empty">空置</a-select-option>
          <a-select-option value="rented">已租</a-select-option>
          <a-select-option value="maintenance">维修中</a-select-option>
          <a-select-option value="cleaning">待清扫</a-select-option>
        </a-select>
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索房号"
          style="width: 200px"
          allow-clear
          @search="fetch"
        />
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新增房源
        </a-button>
      </a-space>
    </div>

    <StatCards :items="statItems" />

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
        <template v-if="column.key === 'storeName'">
          {{ storeName(record.storeId) }}
        </template>
        <template v-else-if="column.key === 'waterMeter'">
          <span>{{ record.waterMeter ?? 0 }}</span>
          <div v-if="record.meterDate" class="meter-date">{{ record.meterDate }}</div>
        </template>
        <template v-else-if="column.key === 'electricityMeter'">
          <span>{{ record.electricityMeter ?? 0 }}</span>
          <div v-if="record.meterDate" class="meter-date">{{ record.meterDate }}</div>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="statusColor(record.status)">{{ statusText(record.status) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'resident'">
          {{ record.resident || '—' }}
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a @click="openEdit(record)">编辑</a>
            <a-popconfirm title="确认删除该房源？" @confirm="remove(record)">
              <a style="color: #ff4d4f">删除</a>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <a-modal
      v-model:open="modalOpen"
      :title="modalTitle"
      @ok="submit"
      @cancel="resetForm"
      :confirm-loading="submitting"
      ok-text="保存"
      cancel-text="取消"
      :width="isMobile ? '92vw' : 560"
    >
      <a-form :model="form" :rules="rules" layout="vertical" ref="formRef">
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12">
            <a-form-item name="storeId" label="所属门店">
              <a-select v-model:value="form.storeId" placeholder="选择门店">
                <a-select-option v-for="s in stores" :key="s.id" :value="s.id">
                  {{ s.name }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="roomNo" label="房号">
              <a-input v-model:value="form.roomNo" placeholder="如 A-101" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="floor" label="楼层">
              <a-input-number v-model:value="form.floor" :min="1" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="area" label="面积(㎡)">
              <a-input-number v-model:value="form.area" :min="1" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="type" label="户型">
              <a-select v-model:value="form.type" placeholder="选择户型">
                <a-select-option v-for="t in types" :key="t" :value="t">{{ t }}</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="rent" label="月租(元)">
              <a-input-number v-model:value="form.rent" :min="0" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="deposit" label="押金(元)">
              <a-input-number v-model:value="form.deposit" :min="0" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="status" label="状态">
              <a-select v-model:value="form.status">
                <a-select-option value="empty">空置</a-select-option>
                <a-select-option value="rented">已租</a-select-option>
                <a-select-option value="maintenance">维修中</a-select-option>
                <a-select-option value="cleaning">待清扫</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
        </a-row>

        <a-divider orientation="left" plain style="margin: 4px 0 12px">水电表</a-divider>
        <a-row :gutter="16">
          <a-col :xs="24" :sm="8">
            <a-form-item name="waterMeter" label="水表读数">
              <a-input-number v-model:value="form.waterMeter" :min="0" :precision="1" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-form-item name="electricityMeter" label="电表读数">
              <a-input-number v-model:value="form.electricityMeter" :min="0" :precision="1" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="8">
            <a-form-item name="meterDate" label="抄表日期">
              <a-date-picker v-model:value="form.meterDate" value-format="YYYY-MM-DD" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { roomApi, storeApi } from '@/api'
import { useIsMobile } from '@/composables/useIsMobile'
import StatCards from '@/components/StatCards.vue'

const { isMobile } = useIsMobile()
const route = useRoute()

const list = ref([])
const stores = ref([])
const loading = ref(false)
const keyword = ref('')
const filterStore = ref(undefined)
const filterStatus = ref(undefined)
const modalOpen = ref(false)
const modalTitle = ref('')
const submitting = ref(false)
const editingId = ref(null)
const formRef = ref()

const types = ['单间', '一室一厅', '两室一厅', '三室一厅', '其他']

const form = reactive({
  storeId: undefined,
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
})

const rules = {
  storeId: [{ required: true, message: '请选择门店', trigger: 'change' }],
  roomNo: [{ required: true, message: '请输入房号', trigger: 'blur' }]
}

const columns = [
  { title: '房号', dataIndex: 'roomNo', key: 'roomNo' },
  { title: '所属门店', key: 'storeName' },
  { title: '楼层', dataIndex: 'floor', key: 'floor', width: 70 },
  { title: '面积(㎡)', dataIndex: 'area', key: 'area', width: 90 },
  { title: '户型', dataIndex: 'type', key: 'type', width: 100 },
  { title: '月租(元)', dataIndex: 'rent', key: 'rent', width: 110 },
  { title: '水表读数', key: 'waterMeter', width: 100 },
  { title: '电表读数', key: 'electricityMeter', width: 100 },
  { title: '状态', key: 'status', width: 90 },
  { title: '在住人', key: 'resident', width: 100 },
  { title: '操作', key: 'action', width: 120 }
]

function storeName(id) {
  return stores.value.find((s) => s.id === id)?.name || '-'
}
function countBy(status) {
  return list.value.filter((r) => r.status === status).length
}
// 统计随当前门店/状态/房号筛选联动，口径与移动端一致
const statItems = computed(() => [
  { label: '总房源', value: list.value.length },
  { label: '空置', value: countBy('empty'), color: '#1677ff' },
  { label: '已租', value: countBy('rented'), color: '#389e0d' },
  { label: '维修中', value: countBy('maintenance'), color: '#d46b08' },
  { label: '待清扫', value: countBy('cleaning'), color: '#faad14' }
])
function statusText(s) {
  return { empty: '空置', rented: '已租', maintenance: '维修中', cleaning: '待清扫' }[s] || s
}
function statusColor(s) {
  return { empty: 'blue', rented: 'green', maintenance: 'orange', cleaning: 'gold' }[s] || 'default'
}

async function fetch() {
  loading.value = true
  try {
    const res = await roomApi.list({
      keyword: keyword.value,
      storeId: filterStore.value,
      status: filterStatus.value
    })
    list.value = res.list
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formRef.value?.resetFields()
  Object.assign(form, {
    storeId: undefined,
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
  })
  editingId.value = null
}

function openCreate() {
  resetForm()
  modalTitle.value = '新增房源'
  modalOpen.value = true
}

function openEdit(record) {
  resetForm()
  editingId.value = record.id
  Object.assign(form, { ...record })
  modalTitle.value = '编辑房源'
  modalOpen.value = true
}

async function submit() {
  try {
    await formRef.value.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    if (editingId.value) {
      await roomApi.update(editingId.value, { ...form })
      message.success('已保存')
    } else {
      await roomApi.create({ ...form })
      message.success('已新增')
    }
    modalOpen.value = false
    fetch()
  } catch (e) {
    message.error(e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

async function remove(record) {
  await roomApi.remove(record.id)
  message.success('已删除')
  fetch()
}

// 从其他页面带 ?edit=房间id 跳过来时，自动打开该房间编辑
function tryOpenByQuery() {
  const id = Number(route.query.edit)
  if (!id) return
  const rec = list.value.find((r) => r.id === id)
  if (rec) openEdit(rec)
}

watch(
  () => route.query.edit,
  () => tryOpenByQuery()
)

onMounted(async () => {
  const res = await storeApi.list()
  stores.value = res.list
  await fetch()
  tryOpenByQuery()
})
</script>

<style scoped>
.meter-date {
  font-size: 11px;
  color: #8c8c8c;
  line-height: 1.2;
}
</style>
