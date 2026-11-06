import request from './request'

// 系统用户（账号管理）
export const userApi = {
  list: (params = {}) => request.get('/users', { params }),
  create: (data) => request.post('/users', data),
  update: (id, data) => request.put(`/users/${id}`, data),
  remove: (id) => request.delete(`/users/${id}`),
  enable: (id) => request.post(`/users/${id}/enable`)
}
