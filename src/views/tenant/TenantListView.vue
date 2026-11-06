<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">租户管理</span>
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
          <a-select-option value="active">在住</a-select-option>
          <a-select-option value="left">已退租</a-select-option>
        </a-select>
        <a-input-search
          v-model:value="keyword"
          placeholder="搜索姓名/电话"
          style="width: 200px"
          allow-clear
          @search="fetch"
        />
        <a-button type="primary" @click="openCreate">
          <template #icon><PlusOutlined /></template>
          新增租户
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
        <template v-else-if="column.key === 'roomNo'">
          {{ roomNo(record.roomId) }}
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.status === 'active' ? 'green' : 'default'">
            {{ record.status === 'active' ? '在住' : '已退租' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'checkOutDate'">
          {{ record.checkOutDate || '—' }}
        </template>
        <template v-else-if="column.key === 'attach'">
          <a v-if="hasAttach(record)" @click="openAttachments(record)">查看</a>
          <span v-else style="color: #bbb">—</span>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space>
            <a @click="openEdit(record)">编辑</a>
            <a-popconfirm title="确认删除该租户？" @confirm="remove(record)">
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
      :width="modalWidth"
    >
      <a-form :model="form" :rules="rules" layout="vertical" ref="formRef">
        <a-row :gutter="16">
          <a-col :xs="24" :sm="12">
            <a-form-item name="name" label="姓名">
              <a-input v-model:value="form.name" placeholder="租户姓名" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="phone" label="联系电话">
              <a-input v-model:value="form.phone" placeholder="手机号码" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="idCard" label="身份证号">
              <a-input v-model:value="form.idCard" placeholder="身份证号" />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="storeId" label="所属门店">
              <a-select v-model:value="form.storeId" placeholder="选择门店" @change="onStoreChange">
                <a-select-option v-for="s in stores" :key="s.id" :value="s.id">
                  {{ s.name }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="roomId" label="入住房间">
              <a-select
                v-model:value="form.roomId"
                placeholder="选择房间"
                allow-clear
                :disabled="!form.storeId"
                @change="onRoomChange"
              >
                <a-select-option v-for="r in roomOptions" :key="r.id" :value="r.id">
                  {{ r.roomNo }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="status" label="状态">
              <a-select v-model:value="form.status">
                <a-select-option value="active">在住</a-select-option>
                <a-select-option value="left">已退租</a-select-option>
              </a-select>
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="checkInDate" label="入住日期">
              <a-date-picker
                v-model:value="form.checkInDate"
                value-format="YYYY-MM-DD"
                style="width: 100%"
                @change="onCheckInChange"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="contractEnd" label="合同到期">
              <a-date-picker
                v-model:value="form.contractEnd"
                value-format="YYYY-MM-DD"
                style="width: 100%"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="rentDueDate" label="房租到期（下次收缴）">
              <a-date-picker
                v-model:value="form.rentDueDate"
                value-format="YYYY-MM-DD"
                style="width: 100%"
                placeholder="按月付，默认入住日+1个月"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="deposit" label="押金(元)">
              <a-input-number
                v-model:value="form.deposit"
                :min="0"
                :precision="0"
                style="width: 100%"
                placeholder="默认取房间预设"
              />
            </a-form-item>
          </a-col>
          <a-col :xs="24" :sm="12">
            <a-form-item name="rent" label="房租金额(元/月)">
              <a-input-number
                v-model:value="form.rent"
                :min="0"
                :precision="0"
                style="width: 100%"
                placeholder="默认取房间预设"
              />
            </a-form-item>
          </a-col>
        </a-row>

        <a-divider orientation="left" style="margin: 4px 0 12px">附件上传</a-divider>
        <a-row :gutter="16">
          <a-col :span="8">
            <div class="upload-label">身份证正面</div>
            <a-upload
              list-type="picture-card"
              accept="image/*"
              :before-upload="(f) => onPickFile(f, 'idCardFront')"
              :show-upload-list="false"
            >
              <img v-if="form.attachments.idCardFront" :src="form.attachments.idCardFront.url" class="thumb" />
              <div v-else class="up-placeholder"><PlusOutlined /><div>上传正面</div></div>
            </a-upload>
            <a v-if="form.attachments.idCardFront" class="up-remove" @click="clearFile('idCardFront')">移除</a>
          </a-col>
          <a-col :span="8">
            <div class="upload-label">身份证反面</div>
            <a-upload
              list-type="picture-card"
              accept="image/*"
              :before-upload="(f) => onPickFile(f, 'idCardBack')"
              :show-upload-list="false"
            >
              <img v-if="form.attachments.idCardBack" :src="form.attachments.idCardBack.url" class="thumb" />
              <div v-else class="up-placeholder"><PlusOutlined /><div>上传反面</div></div>
            </a-upload>
            <a v-if="form.attachments.idCardBack" class="up-remove" @click="clearFile('idCardBack')">移除</a>
          </a-col>
          <a-col :span="8">
            <div class="upload-label">合同扫描件（可多张）</div>
            <a-upload
              list-type="picture-card"
              accept="image/*"
              :before-upload="onAddContract"
              :show-upload-list="false"
            >
              <div class="up-placeholder"><PlusOutlined /><div>添加扫描件</div></div>
            </a-upload>
            <div class="contract-thumbs">
              <div v-for="(c, i) in form.attachments.contracts" :key="i" class="thumb-wrap">
                <img :src="c.url" class="thumb" />
                <a class="up-remove" @click="removeContract(i)">移除</a>
              </div>
            </div>
          </a-col>
        </a-row>
      </a-form>
    </a-modal>

    <!-- 查看附件 -->
    <a-modal
      v-model:open="attachModalOpen"
      title="租户附件"
      :width="isMobile ? '94vw' : 720"
      :footer="null"
    >
      <a-empty v-if="!attachView.front && !attachView.back && !attachView.contracts.length" description="该租户暂无附件" />
      <template v-else>
        <h4 style="margin: 8px 0">身份证</h4>
        <div class="attach-row">
          <div v-if="attachView.front">
            <div class="attach-cap">正面</div>
            <a-image :src="attachView.front" class="attach-img" />
          </div>
          <div v-if="attachView.back">
            <div class="attach-cap">反面</div>
            <a-image :src="attachView.back" class="attach-img" />
          </div>
        </div>
        <h4 style="margin: 16px 0 8px">合同扫描件</h4>
        <div class="attach-row">
          <div v-for="(c, i) in attachView.contracts" :key="i">
            <div class="attach-cap">{{ c.name }}</div>
            <a-image :src="c.url" class="attach-img" />
          </div>
        </div>
      </template>
    </a-modal>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { tenantApi, storeApi, roomApi } from '@/api'
import request from '@/api/request'
import { useIsMobile } from '@/composables/useIsMobile'
import StatCards from '@/components/StatCards.vue'
import { addMonths } from '@/utils/date'
import { safeResolveImage, resolveImageList } from '@/utils/authImage'

const { isMobile } = useIsMobile()

const route = useRoute()

const list = ref([])
const stores = ref([])
const allRooms = ref([])
const loading = ref(false)
const keyword = ref('')
const filterStore = ref(undefined)
const filterStatus = ref(undefined)
const modalOpen = ref(false)
const modalTitle = ref('')
const submitting = ref(false)
const editingId = ref(null)
const formRef = ref()

// 删除时需要在服务端删除的原有附件（仅针对「已在服务端」的）
const removedServer = ref([])
// 打开编辑弹窗时的原始合同快照：删除按对象引用比对算原始下标，避免 splice 后下标漂移
const origContracts = ref([])
const attachModalOpen = ref(false)
const attachView = reactive({ front: null, back: null, contracts: [] })

// 弹窗宽度：窄屏自适应铺满；直接复用统一断点，不再单独挂 resize 监听（避免监听器泄漏）
const modalWidth = computed(() => (isMobile.value ? '94%' : 680))

// 附件结构：{ name, url }；新选文件额外带 _file 与本地预览 url（blob:）
const form = reactive({
  name: '',
  phone: '',
  idCard: '',
  storeId: undefined,
  roomId: undefined,
  status: 'active',
  checkInDate: '',
  contractEnd: '',
  rentDueDate: '',
  deposit: 0,
  rent: 0,
  attachments: { idCardFront: null, idCardBack: null, contracts: [] }
})

const rules = {
  name: [{ required: true, message: '请输入姓名', trigger: 'blur' }],
  phone: [{ required: true, message: '请输入联系电话', trigger: 'blur' }],
  storeId: [{ required: true, message: '请选择门店', trigger: 'change' }],
  roomId: [{ required: true, message: '请选择入住房间', trigger: 'change' }]
}

const columns = [
  { title: '姓名', dataIndex: 'name', key: 'name' },
  { title: '电话', dataIndex: 'phone', key: 'phone' },
  { title: '身份证号', dataIndex: 'idCard', key: 'idCard', ellipsis: true },
  { title: '所属门店', key: 'storeName' },
  { title: '入住房间', key: 'roomNo', width: 90 },
  { title: '押金(元)', dataIndex: 'deposit', key: 'deposit', width: 90 },
  { title: '房租(元)', dataIndex: 'rent', key: 'rent', width: 90 },
  { title: '入住日期', dataIndex: 'checkInDate', key: 'checkInDate', width: 110 },
  { title: '合同到期', dataIndex: 'contractEnd', key: 'contractEnd', width: 110 },
  { title: '房租到期', dataIndex: 'rentDueDate', key: 'rentDueDate', width: 110 },
  { title: '退房时间', dataIndex: 'checkOutDate', key: 'checkOutDate', width: 140 },
  { title: '附件', key: 'attach', width: 70 },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'action', width: 120 }
]

// 房间下拉：按门店过滤；默认只显示空置房，避免误选已出租房间（编辑时保留当前房间）
const roomOptions = computed(() =>
  allRooms.value.filter(
    (r) =>
      (!form.storeId || r.storeId === form.storeId) &&
      (r.status !== 'rented' || r.id === form.roomId)
  )
)

function storeName(id) {
  return stores.value.find((s) => s.id === id)?.name || '-'
}
function roomNo(id) {
  if (!id) return '-'
  return allRooms.value.find((r) => r.id === id)?.roomNo || '-'
}
function hasAttach(r) {
  const a = r.attachments || {}
  return !!(a.idCardFront?.url || a.idCardBack?.url || (a.contracts && a.contracts.length))
}
function countBy(status) {
  return list.value.filter((t) => t.status === status).length
}
// 统计随当前筛选联动，口径与移动端一致
const statItems = computed(() => [
  { label: '总租户', value: list.value.length },
  { label: '在住', value: countBy('active'), color: '#389e0d' },
  { label: '已退租', value: countBy('left'), color: '#8c8c8c' }
])

function onStoreChange() {
  form.roomId = undefined
}

// 选房后自动带出该房间的预设押金 / 房租（仅新增时带出，可手动修改）
function onRoomChange(roomId) {
  if (editingId.value !== null || !roomId) return
  const r = allRooms.value.find((x) => x.id === roomId)
  if (r) {
    form.deposit = r.deposit ?? 0
    form.rent = r.rent ?? 0
  }
}

async function fetch() {
  loading.value = true
  try {
    const res = await tenantApi.list({
      keyword: keyword.value,
      storeId: filterStore.value,
      status: filterStatus.value
    })
    list.value = res.list
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    loading.value = false
  }
}

function resetForm() {
  formRef.value?.resetFields()
  Object.assign(form, {
    name: '',
    phone: '',
    idCard: '',
    storeId: undefined,
    roomId: undefined,
    status: 'active',
    checkInDate: '',
    contractEnd: '',
    rentDueDate: '',
    deposit: 0,
    rent: 0,
    attachments: { idCardFront: null, idCardBack: null, contracts: [] }
  })
  editingId.value = null
  removedServer.value = []
  origContracts.value = []
}

// 按月付：新建时选了入住日，自动带出房租到期日 = 入住日 + 1 个月
function onCheckInChange() {
  if (editingId.value === null && form.checkInDate) {
    form.rentDueDate = addMonths(form.checkInDate, 1)
  }
}

function openCreate() {
  resetForm()
  modalTitle.value = '新增租户'
  modalOpen.value = true
}

async function openEdit(record) {
  resetForm()
  editingId.value = record.id
  Object.assign(form, { ...record })
  // 用独立对象，避免编辑表单里的增删改动直接污染列表数据里的 record.attachments
  form.attachments = { idCardFront: null, idCardBack: null, contracts: [] }
  const a = record.attachments || {}
  // 附件读取已需 JWT：先按 blob: URL 解析，再交给 <img> / a-image（按需拉取，不随列表全量下载）
  const [contractUrls, frontUrl, backUrl] = await Promise.all([
    resolveImageList((a.contracts || []).map((c) => c.url)),
    safeResolveImage(a.idCardFront?.url),
    safeResolveImage(a.idCardBack?.url)
  ])
  form.attachments.idCardFront = frontUrl
    ? { name: a.idCardFront.name, url: frontUrl }
    : null
  form.attachments.idCardBack = backUrl ? { name: a.idCardBack.name, url: backUrl } : null
  const orig = (a.contracts || []).map((c, i) => ({ name: c.name, url: contractUrls[i] || c.url }))
  origContracts.value = orig
  form.attachments.contracts = orig.slice()
  form.deposit = record.deposit || 0
  form.rent = record.rent || 0
  modalTitle.value = '编辑租户'
  modalOpen.value = true
}

// ---------- 附件上传处理（本地预览 + 服务端落盘） ----------
function validateImageFile(file) {
  if (!file) return '未选择文件'
  if (!file.type || !file.type.startsWith('image/')) return '只能上传图片文件'
  if (file.size > 5 * 1024 * 1024) return '单张图片不能超过 5MB'
  return null
}

function onPickFile(file, field) {
  const err = validateImageFile(file)
  if (err) {
    message.warning(err)
    return false
  }
  // 替换已存在的服务端附件时，标记旧文件待删除
  const cur = form.attachments[field]
  if (cur && cur.url && !cur._file) {
    removedServer.value.push({ field })
  }
  form.attachments[field] = {
    name: file.name,
    url: URL.createObjectURL(file),
    _file: file
  }
  return false
}

function onAddContract(file) {
  const err = validateImageFile(file)
  if (err) {
    message.warning(err)
    return false
  }
  form.attachments.contracts.push({
    name: file.name,
    url: URL.createObjectURL(file),
    _file: file
  })
  return false
}

function clearFile(field) {
  const cur = form.attachments[field]
  if (cur && cur.url && !cur._file) {
    removedServer.value.push({ field })
  }
  form.attachments[field] = null
}

function removeContract(i) {
  // 不再记录动态下标：下方 deleteRemovedServer 会用原始快照反查真实下标
  form.attachments.contracts.splice(i, 1)
}

// 把待删除的服务端附件删掉。
// 合同：以「打开弹窗时的原始快照」为准，用对象引用找出被删项的原始下标，倒序删除。
// （若用 splice 后的下标，删多张时会前移导致误删别的文件）
async function deleteRemovedServer(id) {
  const missing = []
  origContracts.value.forEach((c, i) => {
    if (!form.attachments.contracts.includes(c)) missing.push(i)
  })
  for (const i of missing.sort((a, b) => b - a)) {
    await request.delete(`/uploads/tenants/${id}/contract?index=${i}`)
  }
  const singles = removedServer.value.filter((r) => r.field !== 'contract')
  for (const r of singles) {
    await request.delete(`/uploads/tenants/${id}/${r.field}`)
  }
}

// 上传本次新增的文件（合并进服务端 attachments）
async function uploadNewFiles(id) {
  const f = form.attachments
  const hasNew =
    f.idCardFront?._file || f.idCardBack?._file || f.contracts.some((c) => c._file)
  if (!hasNew) return
  const fd = new FormData()
  if (f.idCardFront?._file) fd.append('idCardFront', f.idCardFront._file)
  if (f.idCardBack?._file) fd.append('idCardBack', f.idCardBack._file)
  for (const c of f.contracts) if (c._file) fd.append('contracts', c._file)
  await request.post(`/uploads/tenants/${id}`, fd)
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
      phone: form.phone,
      idCard: form.idCard,
      storeId: form.storeId,
      roomId: form.roomId || null,
      status: form.status,
      checkInDate: form.checkInDate,
      contractEnd: form.contractEnd,
      rentDueDate: form.rentDueDate,
      deposit: form.deposit || 0,
      rent: form.rent || 0
    }
    let saved
    if (editingId.value) {
      // 更新时不传 attachments，由服务端保留；先删待删附件，再上传新文件
      saved = await tenantApi.update(editingId.value, payload)
      await deleteRemovedServer(editingId.value)
    } else {
      saved = await tenantApi.create(payload)
    }
    await uploadNewFiles(saved.id)
    modalOpen.value = false
    message.success('已保存')
    fetch()
  } catch (e) {
    message.error(e?.response?.data?.message || e.message || '操作失败')
  } finally {
    submitting.value = false
  }
}

async function remove(record) {
  try {
    await tenantApi.remove(record.id)
    message.success('已删除')
    fetch()
  } catch {
    // 失败提示由统一请求拦截器给出
  }
}

// 查看附件：服务端 url 需带 JWT 读取，先转成 blob: URL 再交给 a-image
// （a-image 的全屏预览会用同一个 src，blob: 同源可直接放大）
async function openAttachments(record) {
  attachView.front = null
  attachView.back = null
  attachView.contracts = []
  attachModalOpen.value = true
  const a = record.attachments || {}
  const [urls, front, back] = await Promise.all([
    resolveImageList((a.contracts || []).map((c) => c.url)),
    safeResolveImage(a.idCardFront?.url),
    safeResolveImage(a.idCardBack?.url)
  ])
  attachView.front = front
  attachView.back = back
  attachView.contracts = (a.contracts || []).map((c, i) => ({
    name: c.name,
    url: urls[i] || c.url
  }))
}

onMounted(async () => {
  const [s, r] = await Promise.all([storeApi.list(), roomApi.list()])
  stores.value = s.list
  allRooms.value = r.list
  fetch()
  // 从工作台「办理新入住」按钮跳转而来：自动弹出新增弹窗
  if (route.query.create === '1') {
    openCreate()
  }
})
</script>

<style scoped>
.upload-label {
  font-size: 13px;
  color: #555;
  margin-bottom: 8px;
}
.thumb {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}
.up-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #999;
  font-size: 12px;
}
.up-remove {
  display: inline-block;
  margin-top: 4px;
  font-size: 12px;
  color: #ff4d4f;
}
.contract-thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}
.contract-thumbs .thumb-wrap {
  width: 64px;
  text-align: center;
}
.contract-thumbs .thumb-wrap .thumb {
  width: 64px;
  height: 64px;
  border-radius: 6px;
}
.attach-row {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}
.attach-cap {
  font-size: 12px;
  color: #888;
  margin-bottom: 4px;
}
.attach-img {
  max-width: 320px;
  max-height: 240px;
  border: 1px solid #eee;
  border-radius: 6px;
}
</style>
