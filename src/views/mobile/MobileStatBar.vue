<template>
  <!-- 移动端统计条：口径与桌面 StatCards 一致，均随当前筛选条件联动 -->
  <div class="stat-row" :style="{ gridTemplateColumns: `repeat(${items.length || 1}, 1fr)` }">
    <div class="stat" v-for="it in items" :key="it.label">
      <b :style="{ color: it.color || '#1677ff' }">{{ it.value ?? 0 }}</b>
      <span>{{ it.label }}</span>
    </div>
  </div>
</template>

<script setup>
defineProps({
  items: { type: Array, default: () => [] }
})
</script>

<style scoped>
.stat-row {
  display: grid;
  gap: 8px;
  margin: 12px 0 4px;
}
.stat {
  background: #fafafa;
  border-radius: 10px;
  padding: 10px 4px;
  text-align: center;
}
.stat b {
  display: block;
  font-size: 18px;
  font-weight: 500;
  line-height: 1.2;
}
.stat span {
  font-size: 11px;
  color: #8c8c8c;
}
</style>
