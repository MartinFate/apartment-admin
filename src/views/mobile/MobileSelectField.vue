<template>
  <div>
    <van-field
      :model-value="displayText"
      :label="label"
      :placeholder="placeholder"
      readonly
      is-link
      clickable
      :required="required"
      @click="open"
    />
    <van-popup v-model:show="show" position="bottom" round>
      <van-picker
        :columns="columns"
        :title="label"
        @confirm="onConfirm"
        @cancel="show = false"
      />
    </van-popup>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
// 显式按需引入 Vant 组件 + 各自 CSS
import { Field as VanField, Popup as VanPopup, Picker as VanPicker } from 'vant'
import './vant.css'

const props = defineProps({
  modelValue: { type: [String, Number], default: '' },
  // [{ text, value }]
  options: { type: Array, default: () => [] },
  label: { type: String, default: '' },
  placeholder: { type: String, default: '请选择' },
  required: { type: Boolean, default: false },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'change'])

const show = ref(false)

// 滚轮里没有当前值时，默认滚到第一项，避免出现空滚轮
const columns = computed(() => {
  const cols = (props.options || []).map((o) => ({ text: o.text, value: o.value }))
  return cols.length ? cols : [{ text: '暂无选项', value: '' }]
})

const displayText = computed(() => {
  const hit = (props.options || []).find((o) => String(o.value) === String(props.modelValue))
  return hit ? hit.text : ''
})

function open() {
  if (props.disabled) return
  show.value = true
}

function onConfirm({ selectedOptions }) {
  const opt = selectedOptions?.[0]
  show.value = false
  if (!opt) return
  emit('update:modelValue', opt.value)
  emit('change', opt.value)
}
</script>
