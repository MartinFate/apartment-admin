<template>
  <van-popup
    v-model:show="visible"
    position="right"
    :style="{ width: '100%', height: '100%' }"
  >
    <div class="page">
      <van-nav-bar :title="title" left-arrow @click-left="close" />

      <div class="body">
        <slot />
      </div>

      <div class="footer">
        <van-button type="primary" block round :loading="loading" @click="emit('submit')">
          {{ okText }}
        </van-button>
      </div>
    </div>
  </van-popup>
</template>

<script setup>
import { ref, watch } from 'vue'
// 显式按需引入 Vant 组件 + 共用样式
import { Popup as VanPopup, NavBar as VanNavBar, Button as VanButton } from 'vant'
import './vant.css'

const props = defineProps({
  show: { type: Boolean, default: false },
  title: { type: String, default: '' },
  okText: { type: String, default: '保存' },
  loading: { type: Boolean, default: false }
})
const emit = defineEmits(['update:show', 'submit', 'close'])

const visible = ref(false)

watch(
  () => props.show,
  (v) => {
    visible.value = v
  }
)
watch(visible, (v) => emit('update:show', v))

function close() {
  visible.value = false
  emit('close')
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
.footer {
  padding: 10px 16px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid #f0f0f0;
}
</style>
