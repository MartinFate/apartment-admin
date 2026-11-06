import { h, defineAsyncComponent, defineComponent } from 'vue'
import { useIsMobile } from '@/composables/useIsMobile'

// 视图层分叉：同一个 URL，按端渲染不同视图。
// - 后端 API / 鉴权 / 状态 / 路由完全共用，业务逻辑零改动
// - 移动视图与桌面视图都是懒加载，桌面端不会下载移动视图（反之亦然）
// - URL 不变，手机和电脑打开同一个链接都能用
export function responsiveView(mobileLoader, desktopLoader) {
  const Mobile = defineAsyncComponent(mobileLoader)
  const Desktop = defineAsyncComponent(desktopLoader)

  return defineComponent({
    name: 'ResponsiveView',
    setup() {
      const { isMobile } = useIsMobile()
      return () => h(isMobile.value ? Mobile : Desktop)
    }
  })
}
