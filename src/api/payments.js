import request from './request'

export const paymentApi = {
  list: (params = {}) => request.get('/payments', { params }),
  create: (data) => request.post('/payments', data),
  remove: (id) => request.delete(`/payments/${id}`)
}
