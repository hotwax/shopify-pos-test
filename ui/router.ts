import { createRouter, createWebHistory } from '@ionic/vue-router';
import OnboardingSummary from './pages/OnboardingSummary.vue';
import OnboardingMac from './pages/OnboardingMac.vue';
import OnboardingIpad from './pages/OnboardingIpad.vue';
import Scripts from './pages/Scripts.vue';
import ScriptDetail from './pages/ScriptDetail.vue';
import Pos from './pages/Pos.vue';
import Connections from './pages/Connections.vue';
import Runs from './pages/Runs.vue';
import RunDetail from './pages/RunDetail.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/onboarding' },
    { path: '/onboarding', component: OnboardingSummary },
    { path: '/onboarding/mac', component: OnboardingMac },
    { path: '/onboarding/ipad', component: OnboardingIpad },
    { path: '/onboarding/oms', component: Connections },
    { path: '/setup', redirect: '/onboarding/ipad' },
    { path: '/connections', redirect: '/onboarding/oms' },
    { path: '/scripts', component: Scripts },
    { path: '/scripts/:id', component: ScriptDetail },
    { path: '/pos', component: Pos },
    { path: '/runs', component: Runs },
    { path: '/runs/:id', component: RunDetail },
  ],
});
