<template>
  <a-row :gutter="12" class="stat-bar">
    <a-col v-for="it in items" :key="it.label" :xs="12" :sm="6">
      <a-card size="small" class="stat-card">
        <a-statistic
          :title="it.label"
          :value="it.value"
          :suffix="it.suffix || ''"
          :value-style="{ color: it.color || 'rgba(0,0,0,0.88)' }"
        />
      </a-card>
    </a-col>
  </a-row>
</template>

<script setup>
// 桌面端统计条：与移动端各页的统计口径保持一致（均随当前筛选条件变化）
defineProps({
  items: { type: Array, default: () => [] }
})
</script>

<style scoped>
.stat-bar {
  margin-bottom: 16px;
}
.stat-card {
  text-align: center;
  border-radius: 8px;
}
.stat-card :deep(.ant-statistic-title) {
  font-size: 13px;
  margin-bottom: 2px;
}
.stat-card :deep(.ant-statistic-content) {
  font-size: 22px;
}
</style>
