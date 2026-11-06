import request from './request'

export const tenantApi = {
  list: (params = {}) => request.get('/tenants', { params }),
  create: (data) => request.post('/tenants', data),
  update: (id, data) => request.put(`/tenants/${id}`, data),
  remove: (id) => request.delete(`/tenants/${id}`),
  // 房租收缴（单步：生成收款记录 + 顺延到期日）
  collect: (id, data) => request.post(`/tenants/${id}/collect`, data),
  // 退房：租户置为已退租，房间置为待清扫
  checkout: (id) => request.post(`/tenants/${id}/checkout`),
  // 内联修改房租到期日
  updateDueDate: (id, rentDueDate) => request.post(`/tenants/${id}/due-date`, { rentDueDate })
}
