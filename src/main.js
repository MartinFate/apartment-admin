import { createApp } from 'vue'
import { createPinia } from 'pinia'
import Antd from 'ant-design-vue'
import 'ant-design-vue/dist/reset.css'
import App from './App.vue'
import router from './router'
import './styles/index.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(Antd)

// 兜底：部分事件处理器里的 async 调用没有本地 catch。请求失败已由 axios 响应拦截器
// 统一提示，这里只需抑制 unhandledrejection，避免控制台报错且不被误判为脚本崩溃。
window.addEventListener('unhandledrejection', (event) => {
  const r = event.reason
  if (r && (r.isAxiosError || r.response || r.config)) event.preventDefault()
})

app.mount('#app')
