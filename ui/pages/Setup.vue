<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Get setup</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-grid fixed>
        <ion-row><ion-col size="12" size-lg="8">
          <h1>Prepare this Mac and iPad</h1>
          <p>Complete the checks in order. This app reads device state but never changes Apple settings or accepts Apple security prompts.</p>
          <ion-card>
            <ion-card-header><ion-card-title>1. Device profile</ion-card-title></ion-card-header>
            <ion-card-content>
              <ion-item>
                <ion-label position="stacked">Profile name</ion-label>
                <ion-input v-model="profile.id" aria-label="Profile name" placeholder="team-ipad" />
              </ion-item>
              <ion-item>
                <ion-label position="stacked">iPad</ion-label>
                <ion-select v-model="profile.udid" aria-label="iPad" interface="popover" placeholder="Select a connected iPad">
                  <ion-select-option v-for="device in devices" :key="device.udid" :value="device.udid">{{ device.name }} · {{ device.os }} · {{ device.udid }}</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item><ion-label position="stacked">Apple Team ID</ion-label><ion-input v-model="profile.teamId" aria-label="Apple Team ID" /></ion-item>
              <ion-item><ion-label position="stacked">WDA bundle ID</ion-label><ion-input v-model="profile.wdaBundleId" aria-label="WDA bundle ID" /></ion-item>
              <ion-button fill="outline" @click="discover" :disabled="discovering">{{ discovering ? 'Checking devices…' : 'Find connected iPads' }}</ion-button>
              <ion-button @click="save" :disabled="saving">Save profile</ion-button>
              <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>
            </ion-card-content>
          </ion-card>
          <ion-card>
            <ion-card-header><ion-card-title>2. Readiness checks</ion-card-title></ion-card-header>
            <ion-card-content>
              <p v-if="!profile.udid">Select and save an iPad profile first.</p>
              <ion-button v-else @click="check" :disabled="checking">{{ checking ? 'Running read-only checks…' : 'Run read-only checks' }}</ion-button>
              <ion-list v-if="checks.length">
                <ion-item v-for="item in checks" :key="item.id">
                  <ion-label><h3>{{ item.id }}</h3><p>{{ item.message }}</p><p v-if="item.actions.length">Next: {{ item.actions[0] }}</p></ion-label>
                  <ion-badge slot="end" :color="badgeColor(item.state)">{{ item.state }}</ion-badge>
                </ion-item>
              </ion-list>
            </ion-card-content>
          </ion-card>
          <ion-card color="light"><ion-card-content><strong>Safety boundary:</strong> if a check asks for Developer Mode, UI Automation, trust, a password or a signing prompt, complete it yourself in Apple's UI. This toolkit will not toggle or repair that access.</ion-card-content></ion-card>
        </ion-col></ion-row>
      </ion-grid>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCol, IonContent, IonGrid, IonHeader, IonInput, IonItem, IonLabel, IonList, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { DeviceProfile, SetupCheck } from '../../shared/contracts.ts';
import { checkSetup, getProfiles, getSetupDevices, saveProfile } from '../api.ts';

const profile = ref<DeviceProfile>({ id: 'team-ipad', udid: '', teamId: '', wdaBundleId: '' });
const devices = ref<{ udid: string; name: string; model: string; os: string }[]>([]);
const checks = ref<SetupCheck[]>([]);
const discovering = ref(false); const checking = ref(false); const saving = ref(false); const error = ref('');
const badgeColor = (state: SetupCheck['state']) => state === 'ready' ? 'success' : state === 'unsupported' || state === 'blocked' ? 'danger' : state === 'action' ? 'warning' : 'medium';

async function discover() { discovering.value = true; error.value = ''; try { const result = await getSetupDevices(); devices.value = result.devices; if (result.error) error.value = result.error; if (!profile.value.udid && devices.value[0]) profile.value.udid = devices.value[0].udid; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not list devices.'; } finally { discovering.value = false; } }
async function save() { saving.value = true; error.value = ''; try { const result = await saveProfile(profile.value); localStorage.setItem('iosTesting.profileId', profile.value.id); if (!result.profiles.some(item => item.id === profile.value.id)) throw new Error('Profile was not saved.'); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Profile could not be saved.'; } finally { saving.value = false; } }
async function check() { checking.value = true; error.value = ''; try { checks.value = (await checkSetup(profile.value)).checks; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Setup checks failed.'; } finally { checking.value = false; } }
onMounted(async () => { try { const result = await getProfiles(); const saved = result.profiles.find(item => item.id === localStorage.getItem('iosTesting.profileId')) ?? result.profiles[0]; if (saved) profile.value = saved; } catch { /* the explicit Discover action provides the useful error */ } });
</script>
