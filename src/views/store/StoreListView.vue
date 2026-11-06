<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">门店管理</span>
      <a-space wrap>
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索门店名称/负责人/电话"
          style="width: 260px"
          allow-clear
          @search="fetch"
        />
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新增门店
        </a-button>
      </a-space>
    </div>

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
        <template v-if="column.key === 'status'">
          <a-tag :color="record.status === 'active' ? 'green' : 'red'">
            {{ record.status === 'active' ? '启用' : '停用' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space wrap>
            <a @click="openEdit(record)">编辑</a>
            <a-popconfirm title="确认删除该门店？" @confirm="remove(record)">
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
      :width="isMobile ? '92vw' : 520"
    >
      <a-form :model="form" :rules="rules" layout="vertical" ref="formRef">
        <a-form-item name="code" label="门店编号（6位）">
          <a-input v-model:value="form.code" placeholder="留空自动生成，如 000003" maxlength="6" />
        </a-form-item>
        <a-form-item name="name" label="门店名称">
          <a-input v-model:value="form.name" placeholder="如：阳光公寓（朝阳店）" />
        </a-form-item>
        <a-form-item name="address" label="门店地址">
          <a-input v-model:value="form.address" placeholder="详细地址" />
        </a-form-item>
        <a-form-item name="manager" label="负责人">
          <a-input v-model:value="form.manager" placeholder="负责人姓名" />
        </a-form-item>
        <a-form-item name="phone" label="联系电话">
          <a-input v-model:value="form.phone" placeholder="手机号码" />
        </a-form-item>
        <a-form-item name="status" label="状态">
          <a-select v-model:value="form.status">
            <a-select-option value="active">启用</a-select-option>
            <a-select-option value="inactive">停用</a-select-option>
          </a-select>
        </a-form-item>
        <a-divider orientation="left" plain style="margin: 4px 0 12px">水电单价（按抄表计费时使用）</a-divider>
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12">
            <a-form-item name="waterPrice" label="水费单价（元/吨）">
              <a-input-number v-model:value="form.waterPrice" :min="0" :precision="2" style="width: 100%" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="electricityPrice" label="电费单价（元/度）">
              <a-input-number v-model:value="form.electricityPrice" :min="0" :precision="2" style="width: 100%" />
            </a-form-item>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { storeApi } from '@/api'
import { useIsMobile } from '@/composables/useIsMobile'

const { isMobile } = useIsMobile()

const list = ref([])
const loading = ref(false)
const keyword = ref('')
const modalOpen = ref(false)
const modalTitle = ref('')
const submitting = ref(false)
const editingId = ref(null)
const formRef = ref()

const form = reactive({
  code: '',
  name: '',
  address: '',
  manager: '',
  phone: '',
  status: 'active',
  waterPrice: 0,
  electricityPrice: 0
})

const rules = {
  name: [{ required: true, message: '请输入门店名称', trigger: 'blur' }],
  manager: [{ required: true, message: '请输入负责人', trigger: 'blur' }],
  phone: [{ required: true, message: '请输入联系电话', trigger: 'blur' }]
}

const columns = [
  { title: '门店编号', dataIndex: 'code', key: 'code', width: 110 },
  { title: '门店名称', dataIndex: 'name', key: 'name' },
  { title: '地址', dataIndex: 'address', key: 'address', ellipsis: true },
  { title: '负责人', dataIndex: 'manager', key: 'manager' },
  { title: '联系电话', dataIndex: 'phone', key: 'phone' },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'action', width: 120 }
]

async function fetch() {
  loading.value = true
  try {
    const res = await storeApi.list({ keyword: keyword.value })
    list.value = res.list
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formRef.value?.resetFields()
  Object.assign(form, {
    code: '',
    name: '',
    address: '',
    manager: '',
    phone: '',
    status: 'active',
    waterPrice: 0,
    electricityPrice: 0
  })
  editingId.value = null
}

function nextCode() {
  const max = list.value.reduce((m, s) => Math.max(m, parseInt(s.code || '0', 10) || 0), 0)
  return String(max + 1).padStart(6, '0')
}

function openCreate() {
  resetForm()
  form.code = nextCode()
  modalTitle.value = '新增门店'
  modalOpen.value = true
}

function openEdit(record) {
  resetForm()
  editingId.value = record.id
  Object.assign(form, { ...record })
  modalTitle.value = '编辑门店'
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
      await storeApi.update(editingId.value, { ...form })
      message.success('已保存')
    } else {
      await storeApi.create({ ...form })
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
  await storeApi.remove(record.id)
  message.success('已删除')
  fetch()
}

onMounted(fetch)
</script>
