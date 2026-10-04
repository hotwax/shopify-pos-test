<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>Onboarding</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="refreshAll" :disabled="loading">
            <ion-icon slot="icon-only" :icon="refreshOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-grid fixed>
        <ion-row>
          <ion-col size="12" size-lg="9">
            <ion-chip color="primary">SETUP OVERVIEW</ion-chip>
            <h1>POS Testing Onboarding</h1>
            <p class="lede">
              Prepare your Mac host, connect your physical iPad, and verify your test store environment before running automated and manual POS workflows.
            </p>

            <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

            <ion-card class="summary-card">
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>1. Mac Host &amp; Developer Tools</ion-card-title>
                    <ion-card-subtitle>Node.js, full Xcode, Apple Developer signing certificate, RemoteXPC tunnel</ion-card-subtitle>
                  </div>
                  <ion-badge :color="macReady ? 'success' : 'warning'">
                    {{ macReady ? 'Ready' : 'Needs attention' }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <p>
                  {{ macReady
                    ? 'All host-side developer tools, signing identities, and device transport tunnels are ready on this Mac.'
                    : 'Some developer tools or certificates require attention before an iPad can be automated.' }}
                </p>

                <ion-list lines="none" class="status-summary-list">
                  <ion-item>
                    <ion-icon
                      :icon="nodeReady ? checkmarkCircleOutline : alertCircleOutline"
                      :color="nodeReady ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label>
                      Node.js runtime
                      <p>{{ nodeCheck?.message || 'Checking…' }}</p>
                    </ion-label>
                  </ion-item>

                  <ion-item>
                    <ion-icon
                      :icon="xcodeReady ? checkmarkCircleOutline : alertCircleOutline"
                      :color="xcodeReady ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label>
                      Xcode developer tools
                      <p>{{ xcodeCheck?.message || 'Checking…' }}</p>
                    </ion-label>
                  </ion-item>

                  <ion-item>
                    <ion-icon
                      :icon="signingReady ? checkmarkCircleOutline : alertCircleOutline"
                      :color="signingReady ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label>
                      Apple Developer signing identity
                      <p>{{ signingCheck?.message || 'Checking…' }}</p>
                    </ion-label>
                  </ion-item>

                  <ion-item>
                    <ion-icon
                      :icon="tunnelReady ? checkmarkCircleOutline : alertCircleOutline"
                      :color="tunnelReady ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label>
                      RemoteXPC device transport
                      <p>{{ tunnelCheck?.message || 'Checking…' }}</p>
                    </ion-label>
                  </ion-item>

                  <ion-item v-if="cacheCheck && cacheCheck.state !== 'ready'">
                    <ion-icon :icon="alertCircleOutline" color="warning" slot="start" />
                    <ion-label>
                      Appium cache folder
                      <p>{{ cacheCheck.message }}</p>
                    </ion-label>
                  </ion-item>
                </ion-list>

                <div class="card-action-row">
                  <ion-button
                    :fill="nextStep === 'mac' ? 'solid' : 'outline'"
                    :color="nextStep === 'mac' ? 'primary' : undefined"
                    router-link="/onboarding/mac"
                    router-direction="forward"
                  >
                    {{ macReady ? 'Review Mac Setup' : 'Configure Mac Host' }}
                    <ion-icon slot="end" :icon="arrowForwardOutline" />
                  </ion-button>
                </div>
              </ion-card-content>
            </ion-card>

            <ion-card class="summary-card">
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>2. Connect Test iPad</ion-card-title>
                    <ion-card-subtitle>USB-C connection, trust pairing, Developer Mode, reusable device profile</ion-card-subtitle>
                  </div>
                  <ion-badge :color="ipadReady ? 'success' : 'medium'">
                    {{ ipadReady ? 'Profile saved' : 'Not configured' }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <div v-if="savedProfile">
                  <p>
                    Configured with {{ savedProfile.name }}
                    <span v-if="savedProfile.model"> ({{ savedProfile.model }})</span>.
                  </p>
                  <ion-note><p>UDID: <code>{{ savedProfile.udid }}</code></p></ion-note>
                </div>
                <div v-else>
                  <p>No iPad profile has been saved on this Mac yet. Connect your iPad by USB-C, unlock it, and save a profile.</p>
                </div>

                <div class="card-action-row">
                  <ion-button
                    :fill="nextStep === 'ipad' ? 'solid' : 'outline'"
                    :color="nextStep === 'ipad' ? 'primary' : undefined"
                    router-link="/onboarding/ipad"
                    router-direction="forward"
                  >
                    {{ ipadReady ? 'Manage iPad Profiles' : 'Connect iPad' }}
                    <ion-icon slot="end" :icon="arrowForwardOutline" />
                  </ion-button>
                </div>
              </ion-card-content>
            </ion-card>

            <ion-card class="summary-card">
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>3. Test Store &amp; OMS Data</ion-card-title>
                    <ion-card-subtitle>HotWax OMS session for verifying products, orders, and inventory</ion-card-subtitle>
                  </div>
                  <ion-badge :color="omsReady ? 'success' : 'medium'">
                    {{ omsReady ? 'Connected' : 'Not connected' }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <p v-if="activeConnection">
                  Connected to {{ activeConnection.label }} ({{ activeConnection.origin }}).
                </p>
                <p v-else>
                  Sign in to a test HotWax OMS instance to verify order references and line details during POS testing.
                </p>

                <div class="card-action-row">
                  <ion-button
                    :fill="nextStep === 'oms' ? 'solid' : 'outline'"
                    :color="nextStep === 'oms' ? 'primary' : undefined"
                    router-link="/onboarding/oms"
                    router-direction="forward"
                  >
                    {{ omsReady ? 'Manage OMS Connection' : 'Connect OMS' }}
                    <ion-icon slot="end" :icon="arrowForwardOutline" />
                  </ion-button>
                </div>
              </ion-card-content>
            </ion-card>

            <div v-if="macReady && ipadReady" class="bottom-action-row ion-margin-top ion-margin-bottom">
              <ion-button
                router-link="/pos"
                router-direction="forward"
                :fill="omsReady ? 'solid' : 'outline'"
              >
                {{ omsReady ? 'Continue to Shopify POS' : 'Skip to Shopify POS' }}
                <ion-icon slot="end" :icon="arrowForwardOutline" />
              </ion-button>
            </div>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader,
  IonCardSubtitle, IonCardTitle, IonChip, IonCol, IonContent, IonGrid,
  IonHeader, IonIcon, IonItem, IonLabel, IonList, IonNote, IonPage,
  IonRow, IonText, IonTitle, IonToolbar, onIonViewWillEnter,
} from '@ionic/vue';
import {
  alertCircleOutline, arrowForwardOutline, checkmarkCircleOutline, refreshOutline,
} from 'ionicons/icons';
import type { DeviceProfile, OmsConnectionSummary, SetupCheck } from '../../shared/contracts.ts';
import { getHostChecks, getOmsConnections, getProfiles } from '../api.ts';

const checks = ref<SetupCheck[]>([]);
const profiles = ref<DeviceProfile[]>([]);
const connections = ref<OmsConnectionSummary[]>([]);
const loading = ref(true);
const error = ref('');

const nodeCheck = computed(() => checks.value.find(c => c.id === 'host.node'));
const xcodeCheck = computed(() => checks.value.find(c => c.id === 'host.xcode'));
const signingCheck = computed(() => checks.value.find(c => c.id === 'signing.identity'));
const tunnelCheck = computed(() => checks.value.find(c => c.id === 'host.remote-xpc'));
const cacheCheck = computed(() => checks.value.find(c => c.id === 'host.appium-cache'));

const nodeReady = computed(() => nodeCheck.value?.state === 'ready');
const xcodeReady = computed(() => xcodeCheck.value?.state === 'ready');
const signingReady = computed(() => signingCheck.value?.state === 'ready');
const tunnelReady = computed(() => tunnelCheck.value?.state === 'ready');

const macReady = computed(() =>
  checks.value.length > 0 && checks.value.every(c => c.state === 'ready'),
);

const savedProfile = computed(() => {
  const remembered = localStorage.getItem('iosTesting.profileId');
  return profiles.value.find(p => p.id === remembered) ?? profiles.value[0];
});

const ipadReady = computed(() => Boolean(savedProfile.value?.udid));

const activeConnection = computed(() =>
  connections.value.find(c => c.state === 'connected'),
);
const omsReady = computed(() => Boolean(activeConnection.value));

const nextStep = computed<'mac' | 'ipad' | 'oms' | 'ready'>(() => {
  if (!macReady.value) return 'mac';
  if (!ipadReady.value) return 'ipad';
  if (!omsReady.value) return 'oms';
  return 'ready';
});

async function refreshAll(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [hostChecksResult, profilesResult, connectionsResult] = await Promise.all([
      getHostChecks(),
      getProfiles(),
      getOmsConnections(),
    ]);
    checks.value = hostChecksResult.checks;
    profiles.value = profilesResult.profiles;
    connections.value = connectionsResult.connections;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load onboarding status.';
  } finally {
    loading.value = false;
  }
}

onMounted(refreshAll);
onIonViewWillEnter(refreshAll);
</script>

<style scoped>.lede { font-size: 1.08rem; margin-bottom: 1.5rem; }
.summary-card { margin-bottom: 1.25rem; }
.status-summary-list { margin-top: 0.5rem; margin-bottom: 0.5rem; }
.card-action-row { margin-top: 0.75rem; display: flex; justify-content: flex-end; }
.bottom-action-row { margin-top: 1.5rem; margin-bottom: 2rem; display: flex; justify-content: flex-end; }
</style>
