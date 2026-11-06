import request from './request'

export const reminderApi = {
  list: (params = {}) => request.get('/reminders', { params }),
  send: (data) => request.post('/reminders', data),
  markRead: (id) => request.put(`/reminders/${id}/read`),
  remove: (id) => request.delete(`/reminders/${id}`),
  unreadCount: () => request.get('/reminders/unread-count')
}
