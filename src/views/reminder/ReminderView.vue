<template>
  <div>
    <div class="page-toolbar">
      <span class="page-title">提醒中心</span>
      <a-space wrap>
        <a-select
          v-model:value="filterStatus"
          placeholder="按状态筛选"
          style="width: 140px"
          allow-clear
          @change="fetch"
        >
          <a-select-option value="unread">未读</a-select-option>
          <a-select-option value="read">已读</a-select-option>
        </a-select>
        <a-button @click="fetch">刷新</a-button>
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
        <template v-if="column.key === 'type'">
          <a-tag color="blue">催租</a-tag>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.status === 'unread' ? 'red' : 'default'">
            {{ record.status === 'unread' ? '未读' : '已读' }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-space wrap>
            <a v-if="record.status === 'unread'" @click="markRead(record)">标记已读</a>
            <a-popconfirm title="确认删除该提醒？" @confirm="remove(record)">
              <a style="color: #ff4d4f">删除</a>
            </a-popconfirm>
          </a-space>
        </template>
      </template>

      <template #emptyText>
        <span style="color: #8c8c8c">暂无提醒。可到「工作台」房租到期跟踪里点击「发提醒」生成。</span>
      </template>
    </a-table>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { reminderApi } from '@/api'
import StatCards from '@/components/StatCards.vue'

const list = ref([])
const loading = ref(false)
const filterStatus = ref(undefined)

const columns = [
  { title: '提醒对象', dataIndex: 'tenantName', key: 'tenantName', width: 100 },
  { title: '所属门店', dataIndex: 'storeName', key: 'storeName' },
  { title: '房间', dataIndex: 'roomNo', key: 'roomNo', width: 80 },
  { title: '类型', key: 'type', width: 80 },
  { title: '提醒内容', dataIndex: 'content', key: 'content', ellipsis: true },
  { title: '发起时间', dataIndex: 'createdAt', key: 'createdAt', width: 110 },
  { title: '状态', key: 'status', width: 90 },
  { title: '操作', key: 'action', width: 130 }
]

function countBy(status) {
  return list.value.filter((r) => r.status === status).length
}
// 统计随当前筛选联动，口径与移动端一致
const statItems = computed(() => [
  { label: '提醒总数', value: list.value.length },
  { label: '未读', value: countBy('unread'), color: '#cf1322' },
  { label: '已读', value: countBy('read'), color: '#8c8c8c' }
])

async function fetch() {
  loading.value = true
  try {
    const res = await reminderApi.list({ status: filterStatus.value })
    list.value = res.list
  } catch {
    // 失败提示由统一请求拦截器给出
  } finally {
    loading.value = false
  }
}

async function markRead(record) {
  try {
    await reminderApi.markRead(record.id)
    message.success('已标记为已读')
    fetch()
  } catch {
    // 失败提示由统一请求拦截器给出
  }
}

async function remove(record) {
  try {
    await reminderApi.remove(record.id)
    message.success('已删除')
    fetch()
  } catch {
    // 失败提示由统一请求拦截器给出
  }
}

onMounted(fetch)
</script>
