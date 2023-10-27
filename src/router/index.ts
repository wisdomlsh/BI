import { createRouter, createWebHistory, createWebHashHistory } from 'vue-router';
import BasicLayout from '../layouts/BasicLayout.vue';
import BlankLayout from '../layouts/BlankLayout.vue';
import AnalyseMain from '@/views/Analyse/AnalyseMain.vue';
import Charts from '@/views/Charts/Charts.vue';
import LoginUser from '@/views/User/LoginUser.vue';

const hasGithubPages = import.meta.env.VITE_GHPAGES;

export default createRouter({
  history: hasGithubPages ? createWebHashHistory() : createWebHistory(),
  routes: [
    {
      path: '/login',
      name: '登录',
      component: LoginUser,
    },
    {
      path: '/',
      name: 'index',
      meta: { title: 'Home' },
      component: BasicLayout,
      redirect: '/analyse',
      children: [
        {
          path: '/analyse',
          name: 'analyse',
          meta: { title: '智能分析', icon: 'icon-icon-test' },
          component: AnalyseMain,
        },
        {
          path: '/chatrs',
          name: 'chatrs',
          meta: { title: '我的图表', icon: 'icon-tuijian', flat: true },
          component: Charts,
        },
      ],
    },
  ],
});