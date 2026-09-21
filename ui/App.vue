<template>
  <ion-app>
    <ion-split-pane content-id="main-content">
      <ion-menu content-id="main-content">
        <ion-header>
          <ion-toolbar><ion-title>POS Testing</ion-title></ion-toolbar>
        </ion-header>
        <ion-content>
          <ion-list>
            <ion-menu-toggle :auto-hide="false" v-for="item in items" :key="item.href">
              <ion-item
                :router-link="item.href"
                router-direction="root"
                :color="isActive(item.href) ? 'light' : undefined"
                :aria-current="isActive(item.href) ? 'page' : undefined"
              >
                <ion-label>{{ item.label }}</ion-label>
              </ion-item>
            </ion-menu-toggle>
          </ion-list>
        </ion-content>
      </ion-menu>
      <ion-router-outlet id="main-content" />
    </ion-split-pane>
  </ion-app>
</template>

<script setup lang="ts">
import {
  IonApp, IonContent, IonHeader, IonItem, IonLabel, IonList,
  IonMenu, IonMenuToggle, IonRouterOutlet, IonSplitPane, IonTitle, IonToolbar,
} from '@ionic/vue';

import { useRoute } from 'vue-router';

const route = useRoute();

const items = [
  { label: 'Onboarding', href: '/onboarding' },
  { label: 'Scripts', href: '/scripts' },
  { label: 'Shopify POS', href: '/pos' },
  { label: 'Run history', href: '/runs' },
];

// A detail route such as /scripts/pos.inspect-screen still belongs to Scripts.
function isActive(href: string): boolean {
  return route.path === href || route.path.startsWith(`${href}/`);
}
</script>

<style scoped>
ion-split-pane {
  --side-width: 375px;
  --side-min-width: 320px;
  --side-max-width: 420px;
}
</style>
