<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Script details</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-card v-if="script">
        <ion-card-header><ion-card-title>{{ script.name }}</ion-card-title></ion-card-header>
        <ion-card-content>
          <p>{{ script.description }}</p><p><ion-chip v-for="tag in script.tags" :key="tag">{{ tag }}</ion-chip></p>
          <ion-note color="warning"><p>This slice can run only the named read-only smoke script. It does not create orders or change Shopify data.</p></ion-note>
          <ion-item><ion-label>Device profile</ion-label><ion-select v-model="profileId" aria-label="Device profile" placeholder="Select a saved profile"><ion-select-option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.id }} · {{ profile.udid }}</ion-select-option></ion-select></ion-item>
          <ion-button @click="run" :disabled="starting || !profileId">{{ starting ? 'Starting…' : 'Run read-only script' }}</ion-button>
          <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>
        </ion-card-content>
      </ion-card>
      <ion-text color="medium" v-else>Loading script…</ion-text>
    </ion-content>
  </ion-page>
</template>
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip, IonContent, IonHeader, IonItem, IonLabel, IonNote, IonPage, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import { useRoute, useRouter } from 'vue-router';
import type { DeviceProfile, ScriptDefinition } from '../../shared/contracts.ts';
import { getCatalog, getHealth, getProfiles, startRun } from '../api.ts';

const route = useRoute(); const router = useRouter();
const script = ref<ScriptDefinition>(); const profiles = ref<DeviceProfile[]>([]); const profileId = ref(localStorage.getItem('iosTesting.profileId') ?? ''); const starting = ref(false); const error = ref('');
async function run() { if (!script.value || !profileId.value) return; starting.value = true; error.value = ''; try { const health = await getHealth(); const accepted = await startRun({ scriptId: script.value.id, deviceProfileId: profileId.value, parameters: script.value.parameters, assertionMode: script.value.assertionMode, expectedRevision: health.revision }); await router.push(`/runs/${accepted.id}`); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'The run could not be started.'; } finally { starting.value = false; } }
onMounted(async () => { try { const [catalog, saved] = await Promise.all([getCatalog(), getProfiles()]); script.value = catalog.scripts.find(item => item.id === String(route.params.id)); profiles.value = saved.profiles; if (!profileId.value && profiles.value[0]) profileId.value = profiles.value[0].id; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load script details.'; } });
</script>
