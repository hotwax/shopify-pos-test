<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/scripts" />
        </ion-buttons>
        <ion-title>Run history</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="refresh" :disabled="loading">Refresh</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div v-if="error" class="ion-padding">
        <ion-text color="danger">
          <p role="alert">{{ error }}</p>
        </ion-text>
      </div>

      <div v-else-if="loading" class="ion-padding">
        <ion-text color="medium">Loading runs…</ion-text>
      </div>

      <ion-list v-else-if="runs.length">
        <ion-item
          v-for="run in runs"
          :key="run.id"
          :router-link="`/runs/${run.id}`"
          router-direction="forward"
        >
          <ion-label>
            {{ run.request.scriptId }}
            <p>{{ run.id }} · {{ timeAgo(run.createdAt) }} · {{ formatDateTime(run.createdAt) }}</p>
          </ion-label>
          <ion-badge slot="end" :color="color(run.state)">
            {{ run.state }}
          </ion-badge>
        </ion-item>
      </ion-list>

      <ion-card v-else>
        <ion-card-content>
          No runs have been accepted yet.
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  IonBackButton,
  IonBadge,
  IonButton,
  IonButtons,
  IonCard,
  IonCardContent,
  IonContent,
  IonHeader,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonText,
  IonTitle,
  IonToolbar,
  onIonViewWillEnter,
} from '@ionic/vue';
import type { RunRecord } from '../../shared/contracts.ts';
import { listRuns } from '../api.ts';

const runs = ref<RunRecord[]>([]);
const loading = ref(true);
const error = ref('');

function color(state: RunRecord['state']): string {
  if (state === 'passed') return 'success';
  if (['failed', 'blocked', 'needs-reconciliation'].includes(state)) return 'danger';
  return 'warning';
}

async function refresh(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    runs.value = (await listRuns()).runs;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load runs.';
  } finally {
    loading.value = false;
  }
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function timeAgo(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);
  if (absSeconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 30) return rtf.format(days, 'day');
  const months = Math.round(days / 30);
  if (Math.abs(months) < 12) return rtf.format(months, 'month');
  const years = Math.round(days / 365);
  return rtf.format(years, 'year');
}

function formatDateTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

onMounted(refresh);
onIonViewWillEnter(refresh);
</script>
