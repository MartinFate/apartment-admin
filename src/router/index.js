import { createRouter, createWebHistory } from 'vue-router'
import { message } from 'ant-design-vue'
import { responsiveView } from '@/views/mobile/responsive'

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/LoginView.vue'),
    meta: { public: true, title: '登录' }
  },
  {
    path: '/',
    component: () => import('@/layouts/BasicLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: responsiveView(
          () => import('@/views/mobile/MobileDashboard.vue'),
          () => import('@/views/dashboard/DashboardView.vue')
        ),
        meta: { title: '工作台', icon: 'DashboardOutlined' }
      },
      {
        path: 'store',
        name: 'store',
        component: responsiveView(
          () => import('@/views/mobile/MobileStoreView.vue'),
          () => import('@/views/store/StoreListView.vue')
        ),
        meta: { title: '门店管理', icon: 'ShopOutlined' }
      },
      {
        path: 'room',
        name: 'room',
        component: responsiveView(
          () => import('@/views/mobile/MobileRoomView.vue'),
          () => import('@/views/room/RoomListView.vue')
        ),
        meta: { title: '房源管理', icon: 'HomeOutlined' }
      },
      {
        path: 'tenant',
        name: 'tenant',
        component: responsiveView(
          () => import('@/views/mobile/MobileTenantView.vue'),
          () => import('@/views/tenant/TenantListView.vue')
        ),
        meta: { title: '租户管理', icon: 'UserOutlined' }
      },
      {
        path: 'billing',
        name: 'billing',
        component: responsiveView(
          () => import('@/views/mobile/MobileBillingView.vue'),
          () => import('@/views/billing/BillingView.vue')
        ),
        meta: { title: '收费账单', icon: 'AccountBookOutlined' }
      },
      {
        path: 'reminder',
        name: 'reminder',
        component: responsiveView(
          () => import('@/views/mobile/MobileReminderView.vue'),
          () => import('@/views/reminder/ReminderView.vue')
        ),
        meta: { title: '提醒中心', icon: 'BellOutlined' }
      },
      {
        path: 'audit',
        name: 'audit',
        component: responsiveView(
          () => import('@/views/mobile/MobileAuditView.vue'),
          () => import('@/views/audit/AuditView.vue')
        ),
        meta: { title: '操作日志', icon: 'AuditOutlined' }
      },
      {
        path: 'system',
        name: 'system',
        component: responsiveView(
          () => import('@/views/mobile/MobileSystemView.vue'),
          () => import('@/views/system/SystemUserView.vue')
        ),
        meta: { title: '系统设置', icon: 'SettingOutlined' }
      }
    ]
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/views/NotFound.vue'),
    meta: { public: true, title: '页面不存在' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach((to) => {
  const token = localStorage.getItem('ap_token')
  if (!to.meta.public && !token) {
    message.warning('请先登录')
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && token) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
