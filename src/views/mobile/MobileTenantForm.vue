<template>
  <van-popup
    v-model:show="visible"
    position="right"
    :style="{ width: '100%', height: '100%' }"
    @close="onClose"
  >
    <div class="page">
      <van-nav-bar :title="editingId ? '编辑租户' : '办理新入住'" left-arrow @click-left="onClose" />

      <div class="body">
        <div class="grp">基本信息</div>
        <van-cell-group inset>
          <van-field v-model="form.name" label="姓名" placeholder="租户姓名" />
          <van-field v-model="form.phone" label="联系电话" placeholder="手机号码" />
          <van-field v-model="form.idCard" label="身份证号" placeholder="选填" />
        </van-cell-group>

        <div class="grp">入住信息</div>
        <van-cell-group inset>
          <MobileSelectField
            v-model="form.storeId"
            label="所属门店"
            required
            :options="storeOptions"
            @change="onStoreChange"
          />
          <MobileSelectField
            v-model="form.roomId"
            label="入住房间"
            required
            :options="roomOptions"
            :disabled="!form.storeId"
            :placeholder="form.storeId ? '请选择' : '请先选门店'"
            @change="onRoomChange"
          />
          <MobileSelectField v-model="form.status" label="状态" :options="statusOptions" />
          <MobileDateField v-model="form.checkInDate" label="入住日期" @change="onCheckInChange" />
          <MobileDateField v-model="form.contractEnd" label="合同到期" />
          <MobileDateField
            v-model="form.rentDueDate"
            label="房租到期"
            placeholder="默认入住日+1个月"
          />
        </van-cell-group>

        <div class="grp">费用</div>
        <van-cell-group inset>
          <van-field v-model="form.deposit" type="number" label="押金(元)" placeholder="默认取房间预设" />
          <van-field v-model="form.rent" type="number" label="房租(元/月)" placeholder="默认取房间预设" />
        </van-cell-group>

        <div class="grp">附件（自动压缩后上传）</div>
        <van-cell-group inset>
          <div class="up-grid">
            <div class="up-cell">
              <div class="up-cap">身份证正面</div>
              <div v-if="front" class="thumb">
                <img :src="front.url" alt="正面" @click="preview(front.url)" />
                <div class="thumb-act" @click="clearAttach('front')">移除</div>
              </div>
              <van-uploader
                v-else
                result-type="file"
                accept="image/*"
                :before-read="beforeRead"
                :after-read="(e) => onRead(e, 'front')"
              >
                <div class="up-add"><van-icon name="plus" /><span>正面</span></div>
              </van-uploader>
            </div>
            <div class="up-cell">
              <div class="up-cap">身份证反面</div>
              <div v-if="back" class="thumb">
                <img :src="back.url" alt="反面" @click="preview(back.url)" />
                <div class="thumb-act" @click="clearAttach('back')">移除</div>
              </div>
              <van-uploader
                v-else
                result-type="file"
                accept="image/*"
                :before-read="beforeRead"
                :after-read="(e) => onRead(e, 'back')"
              >
                <div class="up-add"><van-icon name="plus" /><span>反面</span></div>
              </van-uploader>
            </div>
          </div>

          <div class="up-cap" style="margin-top: 12px">合同扫描件（可多张）</div>
          <div class="thumbs">
            <div class="thumb" v-for="(c, i) in contracts" :key="i">
              <img :src="c.url" alt="合同" @click="preview(c.url)" />
              <div class="thumb-act" @click="removeContract(i)">移除</div>
            </div>
            <van-uploader
              result-type="file"
              accept="image/*"
              multiple
              :before-read="beforeRead"
              :after-read="(e) => onRead(e, 'contract')"
            >
              <div class="up-add"><van-icon name="plus" /><span>合同</span></div>
            </van-uploader>
          </div>
        </van-cell-group>
      </div>

      <div class="footer">
        <van-button type="primary" block round :loading="saving" @click="submit">
          {{ editingId ? '保存修改' : '保存并生成房租单' }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
// 显式按需引入 Vant 组件 + 各自 CSS
import {
  Popup as VanPopup,
  NavBar as VanNavBar,
  Field as VanField,
  CellGroup as VanCellGroup,
  Uploader as VanUploader,
  Icon as VanIcon,
  Button as VanButton,
  showToast,
  showImagePreview
} from 'vant'
import './vant.css'
import MobileDateField from './MobileDateField.vue'
import MobileSelectField from './MobileSelectField.vue'
import { tenantApi } from '@/api'
import request from '@/api/request'
import { compressImage, formatSize } from '@/utils/imageCompress'
import { addMonths } from '@/utils/date'
import { safeResolveImage } from '@/utils/authImage'

const props = defineProps({
  show: { type: Boolean, default: false },
  // 传入则为编辑，null 为新增
  record: { type: Object, default: null },
  stores: { type: Array, default: () => [] },
  rooms: { type: Array, default: () => [] }
})
const emit = defineEmits(['update:show', 'saved'])

const visible = ref(false)
const saving = ref(false)
const editingId = ref(null)

const statusOptions = [
  { text: '在住', value: 'active' },
  { text: '已退租', value: 'left' }
]

function emptyForm() {
  return {
    name: '',
    phone: '',
    idCard: '',
    storeId: '',
    roomId: '',
    status: 'active',
    checkInDate: '',
    contractEnd: '',
    rentDueDate: '',
    deposit: 0,
    rent: 0
  }
}

const form = reactive(emptyForm())
const front = ref(null)
const back = ref(null)
const contracts = ref([])
// 编辑开始时服务端合同的原始快照（与 contracts 里的旧条目是同一批对象引用）。
// 用它来精确算出"哪个原始下标被删了"，避免多次删除时下标漂移。
const origContracts = ref([])
// 需要从服务端删掉的非合同附件：[{ field }]
const removedServer = ref([])

watch(
  () => props.show,
  (v) => {
    visible.value = v
    if (v) initForm()
  }
)
watch(visible, (v) => emit('update:show', v))

const storeOptions = computed(() =>
  (props.stores || []).map((s) => ({ text: s.name, value: s.id }))
)
// 只列空置房，避免误选已出租房间（编辑时保留当前房间）
const roomOptions = computed(() =>
  (props.rooms || [])
    .filter(
      (r) =>
        (!form.storeId || r.storeId === form.storeId) &&
        (r.status !== 'rented' || r.id === form.roomId)
    )
    .map((r) => ({ text: r.roomNo, value: r.id }))
)

function initForm() {
  Object.assign(form, emptyForm())
  front.value = null
  back.value = null
  contracts.value = []
  origContracts.value = []
  removedServer.value = []
  editingId.value = props.record?.id || null

  if (props.record) {
    const r = props.record
    Object.assign(form, {
      name: r.name || '',
      phone: r.phone || '',
      idCard: r.idCard || '',
      storeId: r.storeId || '',
      roomId: r.roomId || '',
      status: r.status || 'active',
      checkInDate: r.checkInDate || '',
      contractEnd: r.contractEnd || '',
      rentDueDate: r.rentDueDate || '',
      deposit: r.deposit || 0,
      rent: r.rent || 0
    })
    const a = r.attachments || {}
    if (a.idCardFront?.url) front.value = { file: null, url: a.idCardFront.url }
    if (a.idCardBack?.url) back.value = { file: null, url: a.idCardBack.url }
    const orig = (a.contracts || []).map((c) => ({ file: null, url: c.url }))
    origContracts.value = orig
    contracts.value = orig.slice()
  }
}

function onStoreChange() {
  form.roomId = ''
}
// 选房后自动带出该房间预设的押金/房租（仅新增时，可手改）
function onRoomChange(roomId) {
  if (editingId.value || !roomId) return
  const r = (props.rooms || []).find((x) => x.id === roomId)
  if (r) {
    form.deposit = r.deposit ?? 0
    form.rent = r.rent ?? 0
  }
}
// 入住日期 -> 房租到期（+1 个月）
function onCheckInChange(val) {
  if (editingId.value || !val) return
  form.rentDueDate = addMonths(val, 1)
}

function beforeRead(file) {
  const arr = Array.isArray(file) ? file : [file]
  for (const f of arr) {
    if (!f.type || !f.type.startsWith('image/')) {
      showToast('只能上传图片文件')
      return false
    }
    if (f.size > 20 * 1024 * 1024) {
      showToast('单张图片不能超过 20MB')
      return false
    }
  }
  return true
}

async function onRead(item, kind) {
  const list = Array.isArray(item) ? item : [item]
  for (const it of list) {
    const before = it.file.size
    const file = await compressImage(it.file)
    // 用压缩后的文件做预览，释放原图的 objectUrl，省内存
    URL.revokeObjectURL(it.objectUrl)
    const url = URL.createObjectURL(file)
    const entry = { file, url }
    if (kind === 'front') front.value = entry
    else if (kind === 'back') back.value = entry
    else contracts.value.push(entry)

    if (before - file.size > 50 * 1024) {
      showToast(`已压缩 ${formatSize(before)} → ${formatSize(file.size)}`)
    }
  }
}

// 兜底：正常路径下父组件已把附件解析成 blob:，这里兼容仍传服务端 url 的情况
async function preview(url) {
  if (!url) return
  const src = await safeResolveImage(url)
  if (src) showImagePreview([src])
}

function clearAttach(which) {
  const cur = which === 'front' ? front.value : back.value
  if (cur && !cur.file) {
    removedServer.value.push({ field: which === 'front' ? 'idCardFront' : 'idCardBack' })
  }
  if (which === 'front') front.value = null
  else back.value = null
}

function removeContract(i) {
  contracts.value.splice(i, 1)
}

async function deleteRemovedServer(id) {
  // 合同：以原始快照判断哪个下标被删掉，倒序删除（正序会导致后续下标前移）
  const missing = []
  origContracts.value.forEach((c, i) => {
    if (!contracts.value.includes(c)) missing.push(i)
  })
  for (const i of missing.sort((a, b) => b - a)) {
    await request.delete(`/uploads/tenants/${id}/contract?index=${i}`)
  }
  for (const r of removedServer.value) {
    await request.delete(`/uploads/tenants/${id}/${r.field}`)
  }
}

async function uploadNewFiles(id) {
  const hasNew =
    (front.value && front.value.file) ||
    (back.value && back.value.file) ||
    contracts.value.some((c) => c.file)
  if (!hasNew) return
  const fd = new FormData()
  if (front.value?.file) fd.append('idCardFront', front.value.file)
  if (back.value?.file) fd.append('idCardBack', back.value.file)
  for (const c of contracts.value) if (c.file) fd.append('contracts', c.file)
  await request.post(`/uploads/tenants/${id}`, fd)
}

async function submit() {
  if (!form.name.trim()) return showToast('请输入姓名')
  if (!form.phone.trim()) return showToast('请输入联系电话')
  if (!form.storeId) return showToast('请选择门店')
  if (!form.roomId) return showToast('请选择入住房间')

  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      idCard: form.idCard.trim(),
      storeId: form.storeId,
      roomId: form.roomId,
      status: form.status,
      checkInDate: form.checkInDate,
      contractEnd: form.contractEnd,
      rentDueDate: form.rentDueDate,
      deposit: Number(form.deposit) || 0,
      rent: Number(form.rent) || 0
    }
    let saved
    if (editingId.value) {
      saved = await tenantApi.update(editingId.value, payload)
      await deleteRemovedServer(editingId.value)
    } else {
      saved = await tenantApi.create(payload)
    }
    await uploadNewFiles(saved.id)
    showToast(editingId.value ? '已保存' : '已办理入住并生成房租单')
    visible.value = false
    emit('saved')
  } catch (e) {
    showToast(e?.response?.data?.message || e.message || '保存失败，请重试')
  } finally {
    saving.value = false
  }
}

function onClose() {
  visible.value = false
}
</script>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #f7f8fa;
}
.body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 16px;
}
.grp {
  font-size: 13px;
  color: #8c8c8c;
  padding: 14px 16px 6px;
}
.footer {
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #f0f0f0;
}
.up-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px 0 4px;
}
.up-cap {
  font-size: 12px;
  color: #8c8c8c;
  margin-bottom: 6px;
}
.up-add {
  width: 100%;
  height: 84px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px dashed #dcdee0;
  border-radius: 8px;
  color: #969799;
  font-size: 12px;
  background: #fafafa;
}
.thumb {
  position: relative;
  width: 100%;
  height: 84px;
}
.thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 8px;
}
.thumb-act {
  position: absolute;
  right: 4px;
  top: 4px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 8px;
}
.thumbs {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 0 4px;
}
.thumbs .thumb {
  width: 72px;
}
.thumbs .up-add {
  width: 72px;
}
</style>
