import request from './request'

export const storeApi = {
  list: (params = {}) => request.get('/stores', { params }),
  create: (data) => request.post('/stores', data),
  update: (id, data) => request.put(`/stores/${id}`, data),
  remove: (id) => request.delete(`/stores/${id}`)
}
