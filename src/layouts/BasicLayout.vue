<template>
  <a-layout class="layout" style="min-height: 100vh">
    <a-layout-sider
      v-show="!isMobile"
      v-model:collapsed="collapsed"
      :trigger="null"
      collapsible
      width="220"
      :style="{ background: '#001529' }"
    >
      <div class="layout-logo">
        <span class="logo-mark">公</span>
        <span v-show="!collapsed">公寓管理系统</span>
      </div>
      <a-menu
        :selectedKeys="selectedKeys"
        theme="dark"
        mode="inline"
        :items="menuItems"
        @click="onMenuClick"
      />
    </a-layout-sider>

    <a-layout>
      <a-layout-header class="layout-header">
        <div style="display: flex; align-items: center; gap: 16px">
          <a-button
            v-if="isMobile"
            type="text"
            class="mobile-menu-btn"
            aria-label="打开菜单"
            @click="drawerOpen = true"
          >
            <template #icon><MenuOutlined /></template>
            菜单
          </a-button>
          <component
            v-else
            :is="collapsed ? MenuUnfoldOutlined : MenuFoldOutlined"
            style="font-size: 18px; cursor: pointer"
            @click="collapsed = !collapsed"
          />
          <a-breadcrumb>
            <a-breadcrumb-item>首页</a-breadcrumb-item>
            <a-breadcrumb-item>{{ currentTitle }}</a-breadcrumb-item>
          </a-breadcrumb>
        </div>

        <a-dropdown>
          <span style="cursor: pointer">
            <a-avatar style="background: #1677ff; margin-right: 8px">
              <template #icon><UserOutlined /></template>
            </a-avatar>
            {{ auth.displayName }}
          </span>
          <template #overlay>
            <a-menu @click="onUserMenu">
              <a-menu-item key="logout">
                <LogoutOutlined /> 退出登录
              </a-menu-item>
            </a-menu>
          </template>
        </a-dropdown>
      </a-layout-header>

      <a-layout-content class="layout-content">
        <router-view />
      </a-layout-content>
    </a-layout>

    <!-- 移动端抽屉菜单：窄屏下替代固定侧边栏 -->
    <a-drawer
      v-model:open="drawerOpen"
      placement="left"
      :width="220"
      title="公寓管理系统"
      :closable="true"
      :mask-closable="true"
    >
      <a-menu
        :selectedKeys="selectedKeys"
        theme="light"
        mode="inline"
        :items="menuItems"
        @click="onMenuClickMobile"
      />
    </a-drawer>
  </a-layout>
</template>

<script setup>
import { computed, h, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MenuOutlined,
  UserOutlined,
  LogoutOutlined,
  DashboardOutlined,
  ShopOutlined,
  HomeOutlined,
  AccountBookOutlined,
  BellOutlined,
  SettingOutlined,
  AuditOutlined
} from '@ant-design/icons-vue'
import { useAuthStore } from '@/store/auth'
import { useIsMobile } from '@/composables/useIsMobile'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()
const { isMobile } = useIsMobile()

const collapsed = ref(false)
const drawerOpen = ref(false)

const MENU = [
  { key: '/dashboard', title: '工作台', icon: DashboardOutlined },
  { key: '/store', title: '门店管理', icon: ShopOutlined },
  { key: '/room', title: '房源管理', icon: HomeOutlined },
  { key: '/tenant', title: '租户管理', icon: UserOutlined },
  { key: '/billing', title: '收费账单', icon: AccountBookOutlined },
  { key: '/reminder', title: '提醒中心', icon: BellOutlined },
  { key: '/audit', title: '操作日志', icon: AuditOutlined },
  { key: '/system', title: '系统设置', icon: SettingOutlined }
]

// 操作日志为首个 admin-only 模块：非管理员不展示入口（后端仍会拦 403）
const menuItems = computed(() =>
  MENU.filter((m) => m.key !== '/audit' || auth.role === 'admin').map((m) => ({
    key: m.key,
    icon: () => h(m.icon),
    label: m.title
  }))
)

const selectedKeys = computed(() => [route.path])
const currentTitle = computed(
  () => MENU.find((m) => m.key === route.path)?.title || '工作台'
)

function onMenuClick({ key }) {
  if (key !== route.path) router.push(key)
}

function onMenuClickMobile({ key }) {
  drawerOpen.value = false
  onMenuClick({ key })
}

function onUserMenu({ key }) {
  if (key === 'logout') {
    auth.logout()
    message.success('已退出登录')
    router.push({ name: 'login' })
  }
}
</script>
