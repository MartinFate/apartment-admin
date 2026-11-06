<template>
  <div>
    <div class="act-row">
      <van-button block round plain @click="openChangePwd">修改我的密码</van-button>
      <van-button block round type="primary" @click="openCreate">新增用户</van-button>
    </div>

    <div class="note">
      阶段一（本地部署）已实现账号与登录边界；角色用于标识职责，门店级数据隔离将在上云多人时启用。
    </div>

    <van-empty v-if="!list.length" description="暂无账号" />

    <div v-else class="list">
      <div class="card" v-for="u in list" :key="u.id">
        <div class="c-head">
          <span class="c-name">{{ u.name || u.username }}</span>
          <span class="c-tag" :class="u.status === 'active' ? 'on' : 'off'">
            {{ u.status === 'active' ? '正常' : '已禁用' }}
          </span>
        </div>
        <div class="c-sub">账号 {{ u.username }}</div>
        <div class="c-sub c-dim">
          <span class="role">{{ roleLabel(u.role) }}</span>
          <span v-if="u.storeName"> · {{ u.storeName }}</span>
        </div>
        <div class="c-actions">
          <van-button size="small" plain @click="openEdit(u)">编辑</van-button>
          <van-button
            v-if="u.status === 'active'"
            size="small"
            type="danger"
            plain
            @click="disable(u)"
          >
            禁用
          </van-button>
          <van-button v-else size="small" type="primary" plain @click="enable(u)">启用</van-button>
        </div>
      </div>
    </div>

    <!-- 新增 / 编辑用户 -->
    <MobileFormSheet
      v-model:show="formShow"
      :title="editingId ? '编辑用户' : '新增用户'"
      :loading="saving"
      @submit="submit"
    >
      <div class="grp">账号信息</div>
      <van-cell-group inset>
        <van-field
          v-if="!editingId"
          v-model="form.username"
          label="用户名"
          placeholder="登录用户名（不可重复）"
          required
        />
        <van-field
          v-model="form.password"
          :type="editingId ? 'password' : 'text'"
          :label="editingId ? '重置密码' : '初始密码'"
          :placeholder="editingId ? '留空表示不修改' : '至少 6 位'"
        />
        <van-field v-model="form.name" label="姓名" placeholder="显示姓名" required />
        <MobileSelectField v-model="form.role" label="角色" :options="roleOptions" />
        <MobileSelectField
          v-model="form.storeId"
          label="绑定门店"
          placeholder="可不绑定"
          :options="storeOptions"
        />
        <MobileSelectField
          v-if="editingId"
          v-model="form.status"
          label="状态"
          :options="statusOptions"
        />
      </van-cell-group>
    </MobileFormSheet>

    <!-- 修改我的密码 -->
    <MobileFormSheet
      v-model:show="pwdShow"
      title="修改我的密码"
      ok-text="确认修改"
      :loading="pwdSaving"
      @submit="submitPwd"
    >
      <div class="grp">修改后需要重新登录</div>
      <van-cell-group inset>
        <van-field
          v-model="pwdForm.oldPassword"
          type="password"
          label="原密码"
          placeholder="请输入当前密码"
          required
        />
        <van-field
          v-model="pwdForm.newPassword"
          type="password"
          label="新密码"
          placeholder="至少 6 位"
          required
        />
      </van-cell-group>
    </MobileFormSheet>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
// 显式按需引入 Vant 组件 + 共用样式
import {
  Button as VanButton,
  Empty as VanEmpty,
  CellGroup as VanCellGroup,
  Field as VanField,
  showToast
} from 'vant'
import './vant.css'
import MobileSelectField from './MobileSelectField.vue'
import MobileFormSheet from './MobileFormSheet.vue'
import { userApi, storeApi } from '@/api'
import { authApi } from '@/api/auth'
import { useAuthStore } from '@/store/auth'

const router = useRouter()
const auth = useAuthStore()

const list = ref([])
const stores = ref([])

const formShow = ref(false)
const saving = ref(false)
const editingId = ref(null)

const pwdShow = ref(false)
const pwdSaving = ref(false)

const ROLE_LABELS = {
  admin: '超级管理员',
  manager: '门店店长',
  operator: '运营专员',
  finance: '财务'
}
const roleOptions = Object.entries(ROLE_LABELS).map(([value, text]) => ({ text, value }))
const statusOptions = [
  { text: '正常', value: 'active' },
  { text: '禁用', value: 'disabled' }
]

const storeOptions = computed(() => [
  { text: '不绑定', value: '' },
  ...stores.value.map((s) => ({ text: s.name, value: s.id }))
])

function roleLabel(r) {
  return ROLE_LABELS[r] || r || '—'
}

function emptyForm() {
  return { username: '', password: '', name: '', role: 'operator', storeId: '', status: 'active' }
}
const form = reactive(emptyForm())
const pwdForm = reactive({ oldPassword: '', newPassword: '' })

async function fetchUsers() {
  const res = await userApi.list()
  const storeMap = Object.fromEntries(stores.value.map((s) => [s.id, s.name]))
  list.value = (res.list || []).map((u) => ({
    ...u,
    storeName: u.storeId ? storeMap[u.storeId] || '—' : ''
  }))
}

function openCreate() {
  editingId.value = null
  Object.assign(form, emptyForm())
  formShow.value = true
}

function openEdit(record) {
  editingId.value = record.id
  Object.assign(form, emptyForm(), {
    name: record.name || '',
    role: record.role || 'operator',
    storeId: record.storeId || '',
    status: record.status || 'active'
  })
  formShow.value = true
}

async function submit() {
  if (!editingId.value && !form.username.trim()) return showToast('请输入用户名')
  if (!editingId.value && !form.password) return showToast('请输入初始密码')
  if (!form.name.trim()) return showToast('请输入姓名')
  if (!editingId.value && form.password.length < 6) return showToast('初始密码至少 6 位')

  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      role: form.role,
      storeId: form.storeId || null,
      status: form.status
    }
    if (form.password) payload.password = form.password
    if (editingId.value) {
      await userApi.update(editingId.value, payload)
      showToast('已保存')
    } else {
      await userApi.create({ username: form.username.trim(), ...payload })
      showToast('已新增用户')
    }
    formShow.value = false
    fetchUsers()
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '操作失败')
  } finally {
    saving.value = false
  }
}

async function disable(record) {
  await userApi.remove(record.id)
  showToast(`已禁用 ${record.username}`)
  fetchUsers()
}
async function enable(record) {
  await userApi.enable(record.id)
  showToast(`已启用 ${record.username}`)
  fetchUsers()
}

function openChangePwd() {
  pwdForm.oldPassword = ''
  pwdForm.newPassword = ''
  pwdShow.value = true
}
async function submitPwd() {
  if (!pwdForm.oldPassword || !pwdForm.newPassword) return showToast('请填写原密码与新密码')
  if (pwdForm.newPassword.length < 6) return showToast('新密码至少 6 位')
  pwdSaving.value = true
  try {
    await authApi.changePassword({
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword
    })
    showToast('密码已修改，请重新登录')
    pwdShow.value = false
    auth.logout()
    router.push({ name: 'login' })
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '修改失败')
  } finally {
    pwdSaving.value = false
  }
}

onMounted(async () => {
  const s = await storeApi.list()
  stores.value = s.list || []
  await fetchUsers()
})
</script>

<style scoped>
.act-row {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.note {
  font-size: 12px;
  color: #8c8c8c;
  background: #f0f5ff;
  border-radius: 8px;
  padding: 8px 10px;
  margin-bottom: 12px;
  line-height: 1.5;
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
  gap: 8px;
}
.c-name {
  font-size: 15px;
  font-weight: 500;
}
.c-tag {
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
  white-space: nowrap;
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
.role {
  background: #f1efe8;
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 12px;
}
.c-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 10px;
}
.grp {
  font-size: 13px;
  color: #8c8c8c;
  padding: 14px 16px 6px;
}
</style>
