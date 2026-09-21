<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button></ion-back-button>
        </ion-buttons>
        <ion-title>Scripts</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-searchbar v-model="filter" placeholder="Filter scripts by name or tag" aria-label="Filter scripts" />
      <ion-text color="medium" v-if="loading">Loading catalog…</ion-text>
      <ion-text color="danger" v-else-if="error">{{ error }}</ion-text>
      <template v-else>
        <ion-list v-if="filteredScripts.length">
          <ion-item v-for="script in filteredScripts" :key="script.id" :router-link="`/scripts/${script.id}`" router-direction="forward">
            <ion-label>{{ script.name }}<p>{{ script.description }}</p></ion-label>
            <ion-badge slot="end" color="success">{{ script.assertionMode }}</ion-badge>
          </ion-item>
        </ion-list>
        <ion-card v-else><ion-card-content>No matching scripts are available.</ion-card-content></ion-card>
        <ion-note v-for="entry in catalogErrors" :key="entry" color="warning">{{ entry }}</ion-note>
      </template>
    </ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonBackButton, IonBadge, IonButtons, IonCard, IonCardContent, IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonSearchbar, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { ScriptDefinition } from '../../shared/contracts.ts';
import { getCatalog } from '../api.ts';

const scripts = ref<ScriptDefinition[]>([]);
const filter = ref('');
const catalogErrors = ref<string[]>([]);
const loading = ref(true);
const error = ref('');
const filteredScripts = computed(() => {
  const query = filter.value.trim().toLowerCase();
  return !query ? scripts.value : scripts.value.filter(script => `${script.name} ${script.description} ${script.tags.join(' ')}`.toLowerCase().includes(query));
});
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
