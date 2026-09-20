<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Scripts</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-text color="medium" v-if="loading">Loading catalog…</ion-text>
      <ion-text color="danger" v-else-if="error">{{ error }}</ion-text>
      <template v-else>
        <ion-list v-if="scripts.length">
          <ion-item v-for="script in scripts" :key="script.id" :router-link="`/scripts/${script.id}`">
            <ion-label><h2>{{ script.name }}</h2><p>{{ script.description }}</p></ion-label>
            <ion-badge slot="end" color="success">{{ script.assertionMode }}</ion-badge>
          </ion-item>
        </ion-list>
        <ion-card v-else><ion-card-content>No valid scripts are available.</ion-card-content></ion-card>
        <ion-note v-for="entry in catalogErrors" :key="entry" color="warning">{{ entry }}</ion-note>
      </template>
    </ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonBadge, IonCard, IonCardContent, IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { ScriptDefinition } from '../../shared/contracts.ts';
import { getCatalog } from '../api.ts';

const scripts = ref<ScriptDefinition[]>([]);
const catalogErrors = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
onMounted(async () => {
  try {
    const catalog = await getCatalog();
    scripts.value = catalog.scripts;
    catalogErrors.value = catalog.errors;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load scripts.';
  } finally { loading.value = false; }
});
</script>
