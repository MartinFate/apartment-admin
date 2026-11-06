<template>
  <div>
    <van-search v-model="keyword" placeholder="搜索门店名称 / 负责人 / 电话" @search="fetch" />

    <div style="margin: 12px 0">
      <van-button type="primary" block round @click="openCreate">新增门店</van-button>
    </div>

    <van-empty v-if="!list.length" description="暂无门店" />

    <div v-else class="list">
      <div class="card" v-for="s in list" :key="s.id" @click="openEdit(s)">
        <div class="c-head">
          <span class="c-name">{{ s.name }}</span>
          <span class="c-tag" :class="s.status === 'active' ? 'on' : 'off'">
            {{ s.status === 'active' ? '启用' : '停用' }}
          </span>
        </div>
        <div class="c-sub">编号 {{ s.code || '—' }}</div>
        <div class="c-sub" v-if="s.address">{{ s.address }}</div>
        <div class="c-sub c-dim">
          {{ s.manager || '—' }}
          <span v-if="s.phone"> · {{ s.phone }}</span>
        </div>
      </div>
    </div>

    <MobileFormSheet
      v-model:show="formShow"
      :title="editingId ? '编辑门店' : '新增门店'"
      :loading="saving"
      @submit="submit"
    >
      <div class="grp">门店信息</div>
      <van-cell-group inset>
        <van-field
          v-model="form.code"
          label="门店编号"
          placeholder="留空自动生成，如 000003"
          maxlength="6"
        />
        <van-field v-model="form.name" label="门店名称" placeholder="如：阳光公寓（朝阳店）" required />
        <van-field v-model="form.address" label="门店地址" placeholder="详细地址" />
        <van-field v-model="form.manager" label="负责人" placeholder="负责人姓名" required />
        <van-field v-model="form.phone" label="联系电话" placeholder="手机号码" required />
        <MobileSelectField v-model="form.status" label="状态" :options="statusOptions" />
      </van-cell-group>

      <div class="grp">水电单价（按抄表计费时使用）</div>
      <van-cell-group inset>
        <van-field v-model="form.waterPrice" type="number" label="水费单价(元/吨)" placeholder="0" />
        <van-field
          v-model="form.electricityPrice"
          type="number"
          label="电费单价(元/度)"
          placeholder="0"
        />
      </van-cell-group>

      <div v-if="editingId" class="danger">
        <van-button block round plain type="danger" @click="remove">删除该门店</van-button>
      </div>
    </MobileFormSheet>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
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
import MobileFormSheet from './MobileFormSheet.vue'
import { storeApi } from '@/api'

const list = ref([])
const keyword = ref('')
const formShow = ref(false)
const saving = ref(false)
const editingId = ref(null)

const statusOptions = [
  { text: '启用', value: 'active' },
  { text: '停用', value: 'inactive' }
]

function emptyForm() {
  return {
    code: '',
    name: '',
    address: '',
    manager: '',
    phone: '',
    status: 'active',
    waterPrice: 0,
    electricityPrice: 0
  }
}
const form = reactive(emptyForm())

async function fetch() {
  const params = {}
  if (keyword.value.trim()) params.keyword = keyword.value.trim()
  const res = await storeApi.list(params)
  list.value = res.list || []
}

function nextCode() {
  const max = list.value.reduce((m, s) => Math.max(m, parseInt(s.code || '0', 10) || 0), 0)
  return String(max + 1).padStart(6, '0')
}

function openCreate() {
  editingId.value = null
  Object.assign(form, emptyForm())
  form.code = nextCode()
  formShow.value = true
}

function openEdit(record) {
  editingId.value = record.id
  Object.assign(form, emptyForm(), {
    code: record.code || '',
    name: record.name || '',
    address: record.address || '',
    manager: record.manager || '',
    phone: record.phone || '',
    status: record.status || 'active',
    waterPrice: record.waterPrice ?? 0,
    electricityPrice: record.electricityPrice ?? 0
  })
  formShow.value = true
}

async function submit() {
  if (!form.name.trim()) return showToast('请输入门店名称')
  if (!form.manager.trim()) return showToast('请输入负责人')
  if (!form.phone.trim()) return showToast('请输入联系电话')

  saving.value = true
  try {
    const payload = {
      code: form.code.trim(),
      name: form.name.trim(),
      address: form.address.trim(),
      manager: form.manager.trim(),
      phone: form.phone.trim(),
      status: form.status,
      waterPrice: Number(form.waterPrice) || 0,
      electricityPrice: Number(form.electricityPrice) || 0
    }
    if (editingId.value) {
      await storeApi.update(editingId.value, payload)
      showToast('已保存')
    } else {
      await storeApi.create(payload)
      showToast('已新增门店')
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
      message: `确定删除门店「${form.name}」吗？该操作不可撤销。`
    })
  } catch {
    return
  }
  await storeApi.remove(editingId.value)
  showToast('已删除')
  formShow.value = false
  fetch()
}

onMounted(fetch)
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
.grp {
  font-size: 13px;
  color: #8c8c8c;
  padding: 14px 16px 6px;
}
.danger {
  padding: 20px 16px 8px;
}
</style>
