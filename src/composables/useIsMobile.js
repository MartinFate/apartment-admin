import { ref, onMounted, onUnmounted } from 'vue'

// 统一的移动端断点判断（默认 ≤767px 视为手机）
// 返回响应式的 isMobile，随窗口尺寸变化自动更新。
// 关键点：setup 阶段就同步判定，避免首屏先渲染桌面视图、等 onMounted
// 后才切到移动端视图（会造成肉眼可见的闪屏）。
export function useIsMobile(breakpoint = 767) {
  const getMatch = () => {
    if (typeof window === 'undefined') return false
    if (window.matchMedia) {
      return window.matchMedia(`(max-width: ${breakpoint}px)`).matches
    }
    return window.innerWidth <= breakpoint
  }

  const isMobile = ref(getMatch())
  let mql = null

  const update = () => {
    isMobile.value = getMatch()
  }

  onMounted(() => {
    if (typeof window !== 'undefined' && window.matchMedia) {
      mql = window.matchMedia(`(max-width: ${breakpoint}px)`)
      mql.addEventListener('change', update)
    }
  })

  onUnmounted(() => {
    if (mql) mql.removeEventListener('change', update)
  })

  return { isMobile }
}
