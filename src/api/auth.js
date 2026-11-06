import request from './request'

// 鉴权接口：登录 / 当前用户 / 退出 / 修改密码
export const authApi = {
  login: (data) => request.post('/auth/login', data),
  me: () => request.get('/auth/me'),
  logout: () => request.post('/auth/logout'),
  changePassword: (data) => request.post('/auth/change-password', data)
}
