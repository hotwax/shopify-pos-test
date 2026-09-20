<template>
  <ion-page><ion-header><ion-toolbar><ion-title>Run detail</ion-title><ion-button slot="end" fill="clear" @click="refresh">Refresh</ion-button></ion-toolbar></ion-header>
    <ion-content class="ion-padding"><ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text><ion-card v-if="run"><ion-card-header><ion-card-title>{{ run.request.scriptId }}</ion-card-title></ion-card-header><ion-card-content><p><strong>Status:</strong> {{ run.state }}</p><p><strong>Business effect:</strong> {{ run.effect }}</p><p><strong>Last event:</strong> {{ run.lastSequence }}</p><p><strong>Run ID:</strong> {{ run.id }}</p><ion-note color="warning" v-if="['running','preparing','validating'].includes(run.state)"><p>Stop requests are cooperative and do not undo a business transaction. If a commit may have happened, the result remains needs-reconciliation.</p></ion-note><ion-button color="warning" @click="stop" v-if="['running','preparing','validating'].includes(run.state)">Request stop</ion-button><ion-list><ion-item v-for="(assertion, index) in run.assertions" :key="`${assertion.lane}-${index}`"><ion-label><h3>{{ assertion.lane }}</h3><p>{{ assertion.message }}</p></ion-label><ion-badge slot="end">{{ assertion.status }}</ion-badge></ion-item></ion-list></ion-card-content></ion-card><ion-text color="medium" v-else>Loading run…</ion-text></ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonHeader, IonItem, IonLabel, IonList, IonNote, IonPage, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { RunRecord } from '../../shared/contracts.ts';
import { getRun, requestStop } from '../api.ts';
const id = String(useRoute().params.id ?? ''); const run = ref<RunRecord>(); const error = ref(''); let timer: ReturnType<typeof setInterval> | undefined;
async function refresh() { try { run.value = await getRun(id); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load run.'; } }
async function stop() { try { await requestStop(id); await refresh(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Stop request failed.'; } }
onMounted(async () => { await refresh(); timer = setInterval(() => { if (run.value && ['passed', 'failed', 'blocked', 'cancelled', 'needs-reconciliation'].includes(run.value.state)) return; void refresh(); }, 1_000); });
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>
