import axios from 'axios'
import { message } from 'ant-design-vue'
import { clearImageCache } from '@/utils/authImage'

// 统一请求封装：所有 api 模块均通过本实例访问 /api 真实后端。
// 自动附带 JWT，并统一处理 401 与错误提示。
const request = axios.create({
  baseURL: '/api',
  timeout: 10000
})

request.interceptors.request.use((config) => {
  const token = localStorage.getItem('ap_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

request.interceptors.response.use(
  (res) => res.data,
  (err) => {
    if (err.response?.status === 401) {
      message.error('登录已过期，请重新登录')
      clearImageCache()
      localStorage.removeItem('ap_token')
      localStorage.removeItem('ap_user')
      location.href = '/login'
    } else {
      message.error(err.response?.data?.message || err.message || '请求失败')
    }
    return Promise.reject(err)
  }
)

export default request
