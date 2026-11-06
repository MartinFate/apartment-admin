import request from './request'

export const roomApi = {
  list: (params = {}) => request.get('/rooms', { params }),
  create: (data) => request.post('/rooms', data),
  update: (id, data) => request.put(`/rooms/${id}`, data),
  remove: (id) => request.delete(`/rooms/${id}`)
}
