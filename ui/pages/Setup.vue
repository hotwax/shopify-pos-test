<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Get setup</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <h1>Prepare this Mac and iPad</h1>
      <p>This local app will guide you through device readiness before a test can run.</p>
      <ion-card>
        <ion-card-header><ion-card-title>Current slice</ion-card-title></ion-card-header>
        <ion-card-content>
          <p>The catalog and localhost shell are ready. Device checks and runner ownership arrive in the next slice.</p>
          <ion-button router-link="/scripts">Browse read-only scripts</ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/vue';
</script>
