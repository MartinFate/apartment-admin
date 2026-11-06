<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">系统设置 · 账号管理</span>
      <a-space>
        <a-button @click="openChangePwd">
          <template #icon><LockOutlined /></template>
          修改我的密码
        </a-button>
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新增用户
        </a-button>
      </a-space>
    </div>

    <a-alert
      type="info"
      show-icon
      style="margin-bottom: 16px"
      message="阶段一（本地部署）已实现账号与登录边界；角色用于标识职责，门店级数据隔离将在上云多人时启用。"
    />

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
        <template v-if="column.key === 'role'">
          <a-tag :color="roleColor(record.role)">{{ roleLabel(record.role) }}</a-tag>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.status === 'active' ? 'green' : 'red'">
            {{ record.status === 'active' ? '正常' : '已禁用' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a @click="openEdit(record)">编辑</a>
            <a v-if="record.status === 'active'" style="color: #ff4d4f" @click="disable(record)">禁用</a>
            <a v-else @click="enable(record)">启用</a>
          </a-space>
        </template>
      </template>
    </a-table>

    <!-- 新增/编辑用户 -->
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
        <a-form-item name="username" label="用户名" v-if="!editingId">
          <a-input v-model:value="form.username" placeholder="登录用户名（不可重复）" />
        </a-form-item>
        <a-form-item :name="editingId ? 'passwordOpt' : 'password'" :label="editingId ? '重置密码（留空则不修改）' : '初始密码'">
          <a-input-password v-model:value="form.password" :placeholder="editingId ? '留空表示不修改' : '至少 6 位'" />
        </a-form-item>
        <a-form-item name="name" label="姓名">
          <a-input v-model:value="form.name" placeholder="显示姓名" />
        </a-form-item>
        <a-form-item name="role" label="角色">
          <a-select v-model:value="form.role">
            <a-select-option value="admin">超级管理员</a-select-option>
            <a-select-option value="manager">门店店长</a-select-option>
            <a-select-option value="operator">运营专员</a-select-option>
            <a-select-option value="finance">财务</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item name="storeId" label="绑定门店（店长可选）">
          <a-select v-model:value="form.storeId" placeholder="可不绑定" allow-clear>
            <a-select-option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</a-select-option>
          </a-select>
        </a-form-item>
        <a-form-item name="status" label="状态" v-if="editingId">
          <a-select v-model:value="form.status">
            <a-select-option value="active">正常</a-select-option>
            <a-select-option value="disabled">禁用</a-select-option>
          </a-select>
        </a-form-item>
      </a-form>
    </a-modal>

    <!-- 修改我的密码 -->
    <a-modal
      v-model:open="pwdOpen"
      title="修改我的密码"
      @ok="submitPwd"
      :confirm-loading="pwdSubmitting"
      ok-text="确认修改"
      cancel-text="取消"
      :width="isMobile ? '92vw' : 420"
    >
      <a-form :model="pwdForm" layout="vertical" ref="pwdRef">
        <a-form-item label="原密码" required>
          <a-input-password v-model:value="pwdForm.oldPassword" />
        </a-form-item>
        <a-form-item label="新密码（至少 6 位）" required>
          <a-input-password v-model:value="pwdForm.newPassword" />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import { PlusOutlined, LockOutlined } from '@ant-design/icons-vue'
import { userApi, storeApi } from '@/api'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/auth'
import { useIsMobile } from '@/composables/useIsMobile'

const { isMobile } = useIsMobile()

const auth = useAuthStore()
const list = ref([])
const stores = ref([])
const loading = ref(false)

const modalOpen = ref(false)
const modalTitle = ref('')
const submitting = ref(false)
const editingId = ref(null)
const formRef = ref()
const form = reactive({
  username: '',
  password: '',
  name: '',
  role: 'operator',
  storeId: undefined,
  status: 'active'
})
const rules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 6, message: '密码至少 6 位', trigger: 'blur' }
  ],
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }]
}

const columns = [
  { title: '用户名', dataIndex: 'username', key: 'username' },
  { title: '姓名', dataIndex: 'name', key: 'name' },
  { title: '角色', key: 'role', width: 130 },
  { title: '绑定门店', dataIndex: 'storeName', key: 'storeName', width: 160 },
  { title: '状态', key: 'status', width: 100 },
  { title: '操作', key: 'action', width: 140 }
]

const ROLE_LABELS = { admin: '超级管理员', manager: '门店店长', operator: '运营专员', finance: '财务' }
function roleLabel(r) { return ROLE_LABELS[r] || r }
function roleColor(r) {
  return { admin: 'red', manager: 'blue', operator: 'default', finance: 'purple' }[r] || 'default'
}

async function fetchUsers() {
  loading.value = true
  try {
    const res = await userApi.list()
    const storeMap = Object.fromEntries(stores.value.map((s) => [s.id, s.name]))
    list.value = res.list.map((u) => ({ ...u, storeName: u.storeId ? storeMap[u.storeId] || '-' : '—' }))
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formRef.value?.resetFields()
  Object.assign(form, {
    username: '',
    password: '',
    name: '',
    role: 'operator',
    storeId: undefined,
    status: 'active'
  })
  editingId.value = null
}

function openCreate() {
  resetForm()
  modalTitle.value = '新增用户'
  modalOpen.value = true
}

function openEdit(record) {
  resetForm()
  editingId.value = record.id
  Object.assign(form, {
    name: record.name,
    role: record.role,
    storeId: record.storeId || undefined,
    status: record.status
  })
  modalTitle.value = '编辑用户'
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
    const payload = {
      name: form.name,
      role: form.role,
      storeId: form.storeId || null,
      status: form.status
    }
    if (form.password) payload.password = form.password
    if (editingId.value) {
      await userApi.update(editingId.value, payload)
      message.success('已保存')
    } else {
      await userApi.create({ username: form.username, ...payload })
      message.success('已新增')
    }
    modalOpen.value = false
    fetchUsers()
  } catch (e) {
    message.error(e?.response?.data?.message || e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

async function disable(record) {
  await userApi.remove(record.id)
  message.success(`已禁用 ${record.username}`)
  fetchUsers()
}
async function enable(record) {
  await userApi.enable(record.id)
  message.success(`已启用 ${record.username}`)
  fetchUsers()
}

// 修改我的密码
const pwdOpen = ref(false)
const pwdSubmitting = ref(false)
const pwdRef = ref()
const pwdForm = reactive({ oldPassword: '', newPassword: '' })
function openChangePwd() {
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdOpen.value = true
}
async function submitPwd() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) {
    message.warning('请填写原密码与新密码')
    return
  }
  if (pwdForm.newPassword.length < 6) {
    message.warning('新密码至少 6 位')
    return
  }
  pwdSubmitting.value = true
  try {
    await authApi.changePassword({ oldPassword: pwdForm.oldPassword, newPassword: pwdForm.newPassword })
    message.success('密码已修改，请重新登录')
    pwdOpen.value = false
    auth.logout()
    window.location.href = '/login'
  } catch (e) {
    message.error(e?.response?.data?.message || e.message || '修改失败')
  } finally {
    pwdSubmitting.value = false
  }
}

onMounted(async () => {
  const s = await storeApi.list()
  stores.value = s.list
  fetchUsers()
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
</style>
