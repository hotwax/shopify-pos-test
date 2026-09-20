import { createRouter, createWebHistory } from '@ionic/vue-router';
import Setup from './pages/Setup.vue';
import Scripts from './pages/Scripts.vue';
import ScriptDetail from './pages/ScriptDetail.vue';
import Pos from './pages/Pos.vue';
import Connections from './pages/Connections.vue';
import Runs from './pages/Runs.vue';
import RunDetail from './pages/RunDetail.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/setup' },
    { path: '/setup', component: Setup },
    { path: '/scripts', component: Scripts },
    { path: '/scripts/:id', component: ScriptDetail },
    { path: '/pos', component: Pos },
    { path: '/connections', component: Connections },
    { path: '/runs', component: Runs },
    { path: '/runs/:id', component: RunDetail },
  ],
});
