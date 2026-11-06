import { defineStore } from 'pinia'
import { authApi } from '@/api'
import { clearImageCache } from '@/utils/authImage'

// 鉴权 store：登录走真实后端 /api/auth/login，token 与用户信息落 localStorage。
export const useAuthStore = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('ap_token') || '',
    user: JSON.parse(localStorage.getItem('ap_user') || 'null')
  }),
  getters: {
    isLoggedIn: (s) => !!s.token,
    displayName: (s) => s.user?.name || '管理员',
    role: (s) => s.user?.role || ''
  },
  actions: {
    async login({ username, password }) {
      const data = await authApi.login({ username, password })
      // 换账号时丢弃上一个账号缓存的附件 blob，避免 PII 跨会话残留
      clearImageCache()
      this.token = data.token
      this.user = data.user
      localStorage.setItem('ap_token', data.token)
      localStorage.setItem('ap_user', JSON.stringify(data.user))
      return data.user
    },
    async fetchMe() {
      try {
        const me = await authApi.me()
        this.user = me
        localStorage.setItem('ap_user', JSON.stringify(me))
        return me
      } catch {
        return null
      }
    },
    logout() {
      this.token = ''
      this.user = null
      clearImageCache()
      localStorage.removeItem('ap_token')
      localStorage.removeItem('ap_user')
    }
  }
})
