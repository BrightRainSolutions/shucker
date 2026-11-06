import { createRouter, createWebHistory } from 'vue-router'
import { initAuth, useAuth } from './composables/useAuth'
import { configured } from './lib/db'

const routes = [
  { path: '/', name: 'home', component: () => import('./views/LandingView.vue') },
  { path: '/login', name: 'login', component: () => import('./views/LoginView.vue'), meta: { public: true } },
  { path: '/add/:visitId?', name: 'add', component: () => import('./views/AddDateView.vue') },
  { path: '/dates', name: 'dates', component: () => import('./views/DatesView.vue') },
  { path: '/visit/:id', name: 'visit', component: () => import('./views/VisitView.vue') },
  { path: '/oyster/:id', name: 'oyster', component: () => import('./views/OysterView.vue') },
  { path: '/oyster/:id/pin', name: 'pin', component: () => import('./views/PinPickerView.vue') },
  { path: '/place/:id', name: 'place', component: () => import('./views/PlaceView.vue') },
  { path: '/needs-pin', name: 'needs-pin', component: () => import('./views/NeedsPinView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: (to, from, saved) => saved || { top: 0 },
})

router.beforeEach(async (to) => {
  if (!configured) return to.name === 'login' ? true : { name: 'login' }
  await initAuth()
  const { session } = useAuth()
  if (!to.meta.public && !session.value) return { name: 'login', query: { next: to.fullPath } }
  if (to.name === 'login' && session.value) return { name: 'home' }
})
