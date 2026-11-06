import request from './request'

export const dashboardApi = {
  summary: () => request.get('/dashboard/summary')
}
