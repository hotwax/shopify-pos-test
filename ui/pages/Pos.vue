<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Shopify POS</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-chip color="warning">TEST STORE REQUIRED</ion-chip>
      <h1>Shopify POS workflows</h1>
      <p>Choose a reviewed workflow. Mutating actions stay disabled until this Mac has an approved test-store context, a verified POS shop/location match, and a durable transaction checkpoint.</p>
      <ion-grid fixed><ion-row>
        <ion-col size="12" size-md="6"><ion-card><ion-card-header><ion-card-title>Open first order</ion-card-title></ion-card-header><ion-card-content><p>Read-only Home → Orders → first listed order detail smoke.</p><ion-button router-link="/scripts/pos.open-first-order">Configure read-only script</ion-button></ion-card-content></ion-card></ion-col>
        <ion-col size="12" size-md="6"><ion-card><ion-card-header><ion-card-title>Create order</ion-card-title></ion-card-header><ion-card-content><p>Cash-only test-store order. No card or automatic payment.</p><ion-button disabled>Unavailable until context is verified</ion-button></ion-card-content></ion-card></ion-col>
        <ion-col size="12" size-md="6"><ion-card><ion-card-header><ion-card-title>Return order</ion-card-title></ion-card-header><ion-card-content><p>Eligible cash return with exact source line selection.</p><ion-button disabled>Unavailable until OMS and eligibility are verified</ion-button></ion-card-content></ion-card></ion-col>
        <ion-col size="12" size-md="6"><ion-card><ion-card-header><ion-card-title>Exchange order</ion-card-title></ion-card-header><ion-card-content><p>Equal, collect-difference and refund-difference paths.</p><ion-button disabled>Unavailable until transaction policy is complete</ion-button></ion-card-content></ion-card></ion-col>
      </ion-row></ion-grid>
      <ion-card color="light"><ion-card-content><strong>Safety boundary:</strong> this page never creates, returns or exchanges anything yet. A future workflow must show the exact shop, location, product/order IDs, tender, amount bound and approval checkpoint before POS can reach an irreversible action.</ion-card-content></ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip, IonCol, IonContent, IonGrid, IonHeader, IonPage, IonRow, IonTitle, IonToolbar } from '@ionic/vue';
</script>
