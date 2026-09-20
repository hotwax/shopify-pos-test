<template>
  <ion-page><ion-header><ion-toolbar><ion-title>Run history</ion-title><ion-button slot="end" fill="clear" @click="refresh">Refresh</ion-button></ion-toolbar></ion-header>
    <ion-content class="ion-padding"><ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text><ion-text color="medium" v-if="loading">Loading runs…</ion-text><ion-list v-else-if="runs.length"><ion-item v-for="run in runs" :key="run.id" :router-link="`/runs/${run.id}`"><ion-label><h2>{{ run.request.scriptId }}</h2><p>{{ run.id }} · {{ run.createdAt }}</p></ion-label><ion-badge slot="end" :color="color(run.state)">{{ run.state }}</ion-badge></ion-item></ion-list><ion-card v-else><ion-card-content>No runs have been accepted yet.</ion-card-content></ion-card></ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonBadge, IonButton, IonCard, IonCardContent, IonContent, IonHeader, IonItem, IonLabel, IonList, IonPage, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { RunRecord } from '../../shared/contracts.ts';
import { listRuns } from '../api.ts';
const runs = ref<RunRecord[]>([]); const loading = ref(true); const error = ref('');
const color = (state: RunRecord['state']) => state === 'passed' ? 'success' : ['failed', 'blocked', 'needs-reconciliation'].includes(state) ? 'danger' : 'warning';
async function refresh() { loading.value = true; error.value = ''; try { runs.value = (await listRuns()).runs; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load runs.'; } finally { loading.value = false; } }
onMounted(refresh);
</script>
