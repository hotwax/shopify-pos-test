<template>
  <ion-app>
    <ion-split-pane content-id="main-content">
      <ion-menu content-id="main-content">
        <ion-header>
          <ion-toolbar color="primary"><ion-title>POS Testing</ion-title></ion-toolbar>
        </ion-header>
        <ion-content>
          <ion-list>
            <ion-list-header>Workspace</ion-list-header>
            <ion-menu-toggle :auto-hide="false" v-for="item in items" :key="item.href">
              <ion-item :router-link="item.href" router-direction="root" lines="none">
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
  IonApp, IonContent, IonHeader, IonItem, IonLabel, IonList, IonListHeader,
  IonMenu, IonMenuToggle, IonRouterOutlet, IonSplitPane, IonTitle, IonToolbar,
} from '@ionic/vue';

const items = [
  { label: 'Get setup', href: '/setup' },
  { label: 'Scripts', href: '/scripts' },
  { label: 'Shopify POS', href: '/pos' },
  { label: 'OMS connections', href: '/connections' },
  { label: 'Run history', href: '/runs' },
];
</script>
