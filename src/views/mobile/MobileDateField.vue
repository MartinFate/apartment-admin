<template>
  <div>
    <van-field
      :model-value="displayText"
      :label="label"
      :placeholder="placeholder"
      readonly
      is-link
      :required="required"
      clickable
      @click="open"
    />
    <van-popup v-model:show="show" position="bottom" round>
      <van-date-picker
        v-model="current"
        title="选择日期"
        :min-date="minDate"
        :max-date="maxDate"
        @confirm="onConfirm"
        @cancel="show = false"
      />
    </van-popup>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
// 显式按需引入 Vant 组件 + 各自 CSS（Vant 组件无副作用，可安全 tree-shaking）
import {
  Field as VanField,
  Popup as VanPopup,
  DatePicker as VanDatePicker
} from 'vant'
import './vant.css'

const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: '' },
  placeholder: { type: String, default: '请选择' },
  required: { type: Boolean, default: false }
})
const emit = defineEmits(['update:modelValue', 'change'])

const show = ref(false)
const current = ref([])

const minDate = new Date(new Date().getFullYear() - 10, 0, 1)
const maxDate = new Date(new Date().getFullYear() + 10, 11, 31)

const displayText = computed(() => props.modelValue || '')

const pad = (v) => String(v).padStart(2, '0')

function todayParts() {
  const d = new Date()
  return [String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())]
}

function open() {
  if (props.modelValue && /^\d{4}-\d{2}-\d{2}$/.test(props.modelValue)) {
    current.value = props.modelValue.split('-')
  } else {
    current.value = todayParts()
  }
  show.value = true
}

function onConfirm({ selectedValues }) {
  const [y, m, d] = selectedValues
  const val = `${y}-${pad(m)}-${pad(d)}`
  emit('update:modelValue', val)
  emit('change', val)
  show.value = false
}
</script>
