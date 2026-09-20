<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Script details</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-card><ion-card-content><p>Script: {{ id }}</p><p>Execution is not enabled in the catalog shell slice yet.</p></ion-card-content></ion-card>
    </ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { IonCard, IonCardContent, IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/vue';
import { useRoute } from 'vue-router';
const id = String(useRoute().params.id ?? 'unknown');
</script>
