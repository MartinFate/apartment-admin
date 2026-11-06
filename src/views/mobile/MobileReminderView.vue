<template>
  <div>
    <div class="tab-row">
      <van-button
        v-for="t in tabs"
        :key="t.value"
        size="small"
        round
        :type="filterStatus === t.value ? 'primary' : 'default'"
        @click="pickTab(t.value)"
      >
        {{ t.text }}{{ t.value === 'unread' && unreadCount ? `(${unreadCount})` : '' }}
      </van-button>
      <van-button size="small" round plain @click="fetch">刷新</van-button>
    </div>

    <MobileStatBar :items="statItems" />

    <van-empty v-if="!list.length" description="暂无提醒" />

    <div v-else class="list">
      <div class="card" v-for="r in list" :key="r.id" :class="{ unread: r.status === 'unread' }">
        <div class="c-head">
          <span class="c-name">{{ r.tenantName || '—' }}</span>
          <span class="c-tag" :class="r.status === 'unread' ? 'on' : 'off'">
            {{ r.status === 'unread' ? '未读' : '已读' }}
          </span>
        </div>
        <div class="c-sub">{{ r.storeName || '—' }} {{ r.roomNo || '' }}</div>
        <div class="c-content">{{ r.content || '—' }}</div>
        <div class="c-sub c-dim">{{ r.createdAt || '' }}</div>
        <div class="c-actions">
          <van-button v-if="r.status === 'unread'" size="small" plain @click="markRead(r)">
            标记已读
          </van-button>
          <van-button size="small" type="danger" plain @click="remove(r)">删除</van-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
// 显式按需引入 Vant 组件 + 共用样式
import {
  Button as VanButton,
  Empty as VanEmpty,
  showConfirmDialog,
  showToast
} from 'vant'
import './vant.css'
import MobileStatBar from './MobileStatBar.vue'
import { reminderApi } from '@/api'

const list = ref([])
const filterStatus = ref('')
const unreadCount = ref(0)

const tabs = [
  { text: '全部', value: '' },
  { text: '未读', value: 'unread' },
  { text: '已读', value: 'read' }
]

function countBy(status) {
  return list.value.filter((r) => r.status === status).length
}
// 统计随当前状态筛选联动，口径与桌面「提醒中心」StatCards 一致
const statItems = computed(() => [
  { label: '提醒总数', value: list.value.length },
  { label: '未读', value: countBy('unread'), color: '#cf1322' },
  { label: '已读', value: countBy('read'), color: '#8c8c8c' }
])

const doingIds = new Set()

function pickTab(v) {
  filterStatus.value = v
  fetch()
}

async function fetch() {
  const params = {}
  if (filterStatus.value) params.status = filterStatus.value
  try {
    const res = await reminderApi.list(params)
    list.value = res.list || []
  } catch {
    // 失败提示由统一请求拦截器给出
    return
  }
  try {
    const c = await reminderApi.unreadCount()
    unreadCount.value = c.count ?? c ?? 0
  } catch {
    unreadCount.value = countBy('unread')
  }
}

async function markRead(record) {
  if (doingIds.has(record.id)) return
  doingIds.add(record.id)
  try {
    await reminderApi.markRead(record.id)
    showToast('已标记为已读')
    await fetch()
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    doingIds.delete(record.id)
  }
}

async function remove(record) {
  try {
    await showConfirmDialog({ title: '确认删除', message: '确定删除该提醒吗？' })
  } catch {
    return
  }
  if (doingIds.has(record.id)) return
  doingIds.add(record.id)
  try {
    await reminderApi.remove(record.id)
    showToast('已删除')
    await fetch()
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    doingIds.delete(record.id)
  }
}

onMounted(fetch)
</script>

<style scoped>
.tab-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
  flex-wrap: wrap;
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
.card.unread {
  border-left: 4px solid #ee0a24;
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
  background: #fcebeb;
  color: #a32d2d;
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
.c-content {
  font-size: 13px;
  color: #333;
  margin-top: 6px;
  line-height: 1.5;
  background: #fafafa;
  border-radius: 8px;
  padding: 8px 10px;
}
.c-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 10px;
}
</style>
