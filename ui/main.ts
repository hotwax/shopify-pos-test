import { createApp } from 'vue';
import { IonicVue } from '@ionic/vue';
import { createPinia } from 'pinia';
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/float-elements.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/text-transformation.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/display.css';
// Dark mode is opt-in from Ionic 8. The .system palette follows the OS via
// prefers-color-scheme; swap for dark.class.css if a manual toggle is added.
import '@ionic/vue/css/palettes/dark.system.css';
import './styles/shared.css';
import App from './App.vue';
import { router } from './router.ts';

createApp(App).use(IonicVue).use(createPinia()).use(router).mount('#app');
