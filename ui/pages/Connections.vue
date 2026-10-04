<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/onboarding"></ion-back-button>
        </ion-buttons>
        <ion-title>OMS connections</ion-title>
        <ion-buttons slot="end">
          <ion-button router-link="/onboarding" router-direction="back" fill="clear">
            Summary
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <h1>OMS data connection</h1>
      <p>Connect to a test OMS instance from this page. Credentials are sent only to the localhost sidecar and the OMS login endpoint. The app keeps your password only if you tick Remember this connection on this Mac.</p>
      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <ion-card v-if="activeConnection?.state === 'connected'">
        <ion-card-header>
          <div class="card-heading">
            <div>
              <ion-card-subtitle>Connection health</ion-card-subtitle>
              <ion-card-title>{{ activeConnection.label }}</ion-card-title>
            </div>
            <div class="badge-row">
              <ion-badge color="success">Connected</ion-badge>
              <ion-badge v-if="session" :color="session.tone">{{ session.text }}</ion-badge>
            </div>
          </div>
        </ion-card-header>
        <ion-card-content>
          <div class="fact-grid">
            <div>
              <ion-note>Origin</ion-note>
              <p>{{ activeConnection.origin }}</p>
            </div>
            <div v-if="signedInAs">
              <ion-note>Signed in as</ion-note>
              <p>{{ signedInAs }}</p>
              <ion-note v-if="activeConnection.userFullName" class="fact-sub">{{ activeConnection.userFullName }}</ion-note>
            </div>
            <div v-if="activeConnection.expiresAt">
              <ion-note>Session expires</ion-note>
              <p>{{ formatDate(activeConnection.expiresAt) }}</p>
            </div>
            <div>
              <ion-note>Last health check</ion-note>
              <p>{{ healthCheckedAt ? formatDate(healthCheckedAt) : 'Not checked this session' }}</p>
            </div>
          </div>
          <div class="button-row">
            <ion-button fill="outline" @click="refreshHealth" :disabled="healthLoading">{{ healthLoading ? 'Checking…' : 'Refresh health' }}</ion-button>
            <ion-button fill="clear" color="medium" @click="logout(activeConnectionId)">Log out and switch OMS</ion-button>
          </div>
        </ion-card-content>
      </ion-card>

      <ion-card v-else>
        <ion-card-header><ion-card-title>Log in to a test OMS</ion-card-title></ion-card-header>
        <ion-card-content>
          <form @submit.prevent="submitLogin" @keyup.enter="submitLogin">
            <ion-item><ion-label position="stacked">HotWax instance name</ion-label><ion-input v-model="instanceName" autocomplete="organization" placeholder="test-maarg" enterkeyhint="go" /></ion-item>
            <p v-if="connectionOrigin">Will connect to: {{ connectionOrigin }}</p>
            <ion-item><ion-label position="stacked">Username</ion-label><ion-input v-model="username" autocomplete="username" enterkeyhint="go" /></ion-item>
            <ion-item><ion-label position="stacked">Password</ion-label><ion-input v-model="password" type="password" autocomplete="current-password" enterkeyhint="go" /></ion-item>
            <ion-item lines="none">
              <ion-checkbox v-model="rememberConnection">Remember this connection on this Mac</ion-checkbox>
            </ion-item>
            <ion-button type="submit" :disabled="!canConnect">{{ busy ? 'Connecting…' : 'Log in for read-only data' }}</ion-button>
            <p><ion-note>The instance name is used to derive its HTTPS URL and is saved locally as a recent connection after a successful login. Your username, password, bearer token and OMS data are never saved in browser storage.</ion-note></p>
            <p v-if="rememberConnection"><ion-note color="warning">Remembering stores your password on this Mac, encrypted with a key held in your macOS Keychain. Anyone who can unlock your Mac account can use it to sign in as you.</ion-note></p>
          </form>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="savedConnections.length">
        <ion-card-header>
          <div class="card-heading">
            <div>
              <ion-card-subtitle>Saved on this Mac</ion-card-subtitle>
              <ion-card-title>Remembered connections</ion-card-title>
            </div>
            <ion-badge color="medium">{{ savedConnections.length }}</ion-badge>
          </div>
        </ion-card-header>
        <ion-card-content>
          <ion-list>
            <ion-item v-for="entry in savedConnections" :key="entry.id">
              <ion-label class="ion-text-wrap">
                {{ entry.instanceName }}
                <p>{{ entry.username }}<span v-if="!entry.autoConnect"> · manual</span></p>
              </ion-label>
              <ion-button slot="end" fill="outline" @click="connectSaved(entry)" :disabled="busy">{{ connectingId === entry.id ? 'Connecting…' : 'Connect' }}</ion-button>
              <ion-button slot="end" fill="clear" color="medium" @click="forgetSaved(entry)" :disabled="busy">Forget</ion-button>
            </ion-item>
          </ion-list>
          <ion-note color="medium"><p>Passwords are encrypted with a key in your macOS Keychain and never leave this Mac except to sign in to that OMS. Forget removes the stored password immediately.</p></ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="activeConnection?.state !== 'connected' && recentConnections.length">
        <ion-card-header><ion-card-title>Recent OMS instances</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-list>
            <ion-item v-for="recent in recentConnections" :key="recent.instanceName" button detail="true" @click="selectRecent(recent)">
              <ion-label>{{ recent.instanceName }}<p>{{ recentOrigin(recent.instanceName) }}</p></ion-label>
              <ion-button slot="end" fill="outline" @click.stop="selectRecent(recent)">Use</ion-button>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="shops.length">
        <ion-card-header>
          <div class="card-heading">
            <div>
              <ion-card-subtitle>Set once here</ion-card-subtitle>
              <ion-card-title>Test environment</ion-card-title>
            </div>
            <ion-badge :color="environmentSaved ? 'success' : 'medium'">{{ environmentSaved ? 'Saved' : 'Not saved' }}</ion-badge>
          </div>
        </ion-card-header>
        <ion-card-content>
          <p>Shopify POS planning uses the shop and location saved here. That page shows them read-only and has no pickers of its own.</p>

          <ion-radio-group v-model="shopId" @ionChange="shopChanged">
            <ion-list-header><ion-label>Shopify test store</ion-label></ion-list-header>
            <div class="shop-options" role="presentation">
              <ion-item v-for="shop in shops" :key="shop.connectorShopId" class="shop-option">
                <ion-radio :value="shop.connectorShopId" label-placement="end" justify="start">
                  <div class="choice-label">
                    <span>{{ shop.name }}</span>
                    <ion-note>{{ shop.shopDomain || shop.connectorShopId }}</ion-note>
                  </div>
                </ion-radio>
              </ion-item>
            </div>
          </ion-radio-group>
          <p v-if="selectedShop">Shopify ID: {{ selectedShop.shopGid || 'not supplied by OMS' }}<br />Primary location: {{ selectedShop.locationGid || 'not supplied by OMS' }}</p>

          <ion-radio-group v-if="locations.length" v-model="environmentLocationGid">
            <ion-list-header><ion-label>Expected POS location</ion-label></ion-list-header>
            <div class="shop-options" role="presentation">
              <ion-item v-for="item in locations" :key="item.gid" class="shop-option">
                <ion-radio :value="item.gid" label-placement="end" justify="start">
                  <div class="choice-label">
                    <span>{{ item.name }}</span>
                    <ion-note v-if="item.gid === selectedShop?.locationGid">Primary location for this shop</ion-note>
                  </div>
                </ion-radio>
              </ion-item>
            </div>
          </ion-radio-group>
          <ion-note v-else-if="!locationLoading" color="medium"><p>Load this shop's locations to choose the one the test iPad is signed in to.</p></ion-note>

          <div class="button-row">
            <ion-button @click="saveEnvironment" :disabled="!canSaveEnvironment">{{ environmentSaved ? 'Saved' : 'Save test environment' }}</ion-button>
            <ion-button fill="outline" @click="loadLocations()" :disabled="locationLoading || !shopId">{{ locationLoading ? 'Loading locations…' : 'Reload locations' }}</ion-button>
            <ion-button fill="clear" color="medium" @click="loadShops(activeConnectionId)" :disabled="busy">Reload shop list</ion-button>
          </div>
          <ion-note v-if="environmentMessage" color="success"><p role="status">{{ environmentMessage }}</p></ion-note>
          <ion-note v-else-if="!canSaveEnvironment" color="medium"><p>Choose a shop and a location to save this environment.</p></ion-note>
        </ion-card-content>
      </ion-card>

      <div v-if="environmentSaved" class="button-row">
        <ion-button router-link="/pos" router-direction="forward">
          Start testing
          <ion-icon slot="end" :icon="arrowForwardOutline" />
        </ion-button>
        <ion-note color="medium">Setup is complete. Shopify POS planning will use {{ selectedShop?.name }}.</ion-note>
      </div>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { IonBackButton, IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonCheckbox, IonContent, IonHeader, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonNote, IonPage, IonIcon, IonRadio, IonRadioGroup, IonText, IonTitle, IonToolbar, onIonViewWillEnter } from '@ionic/vue';
import { arrowForwardOutline } from 'ionicons/icons';
import type { OmsConnectionSummary, SavedOmsConnection, OmsLocation, OmsShop } from '../../shared/contracts.ts';
import { addOmsConnection, connectSavedOmsConnection, forgetOmsConnection, getSavedOmsConnections, saveOmsConnection, getOmsConnections, getOmsHealth, getOmsShops, listOmsLocations, loginOms, logoutOms } from '../api.ts';
import { readRecentOmsConnections, rememberRecentOmsConnection, type RecentOmsConnection } from '../oms-recents.ts';
import { useTestEnvStore } from '../stores/test-env.ts';
import { buildOmsOrigin, instanceNameFromOrigin } from '../oms-origin.ts';

const testEnv = useTestEnvStore();
const connections = ref<OmsConnectionSummary[]>([]);
const shops = ref<OmsShop[]>([]);
const locations = ref<OmsLocation[]>([]);
const locationCursor = ref<string | null>(null);
const activeConnectionId = ref(''); const shopId = ref(''); const username = ref(''); const password = ref('');
const instanceName = ref(''); const recentConnections = ref<RecentOmsConnection[]>([]);
const connectionOrigin = computed(() => { try { return buildOmsOrigin(instanceName.value); } catch { return ''; } });
const loading = ref(true); const busy = ref(false); const error = ref('');
const locationLoading = ref(false); const healthLoading = ref(false); const healthCheckedAt = ref('');
const rememberConnection = ref(false);
const savedConnections = ref<SavedOmsConnection[]>([]);
const connectingId = ref('');
const environmentLocationGid = ref(''); const environmentMessage = ref('');
const savedEnvironment = computed(() => testEnv.savedEnvironment);
let locationRequest = 0;
// The session expiry drives whether a planned run can still reach the OMS, so
// it is shown as remaining time rather than only an absolute timestamp.
const now = ref(Date.now());
const clock = setInterval(() => { now.value = Date.now(); }, 30_000);
onBeforeUnmount(() => clearInterval(clock));

// The OMS profile's userId is an internal party ID, so prefer the login name.
const signedInAs = computed(() => activeConnection.value?.username || activeConnection.value?.userId || '');

const session = computed(() => {
  const expiresAt = activeConnection.value?.expiresAt;
  if (!expiresAt) return undefined;
  const remaining = Date.parse(expiresAt) - now.value;
  if (!Number.isFinite(remaining)) return undefined;
  if (remaining <= 0) return { text: 'Session expired', tone: 'danger' };
  const minutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  const text = hours >= 1 ? `${hours}h ${minutes % 60}m left` : `${Math.max(minutes, 1)}m left`;
  return { text, tone: minutes <= 30 ? 'warning' : 'success' };
});

const activeConnection = computed(() => connections.value.find(connection => connection.id === activeConnectionId.value));
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));

// The saved environment is keyed by instance name rather than connection id,
// because the sidecar assigns a fresh connection id on every restart.
const activeInstanceName = computed(() => instanceNameFromOrigin(activeConnection.value?.origin ?? ''));
const canSaveEnvironment = computed(() => Boolean(activeInstanceName.value && shopId.value && environmentLocationGid.value));
const environmentSaved = computed(() => Boolean(savedEnvironment.value
  && savedEnvironment.value.instanceName === activeInstanceName.value
  && savedEnvironment.value.connectorShopId === shopId.value
  && savedEnvironment.value.locationGid === environmentLocationGid.value));

function saveEnvironment(): void {
  if (!canSaveEnvironment.value) return;
  const selectedLoc = locations.value.find(loc => loc.gid === environmentLocationGid.value);
  testEnv.saveEnvironment({
    instanceName: activeInstanceName.value,
    connectorShopId: shopId.value,
    locationGid: environmentLocationGid.value,
  }, selectedLoc?.name);
  environmentMessage.value = testEnv.hasSavedEnvironment
    ? 'Saved. Shopify POS planning will use this shop and location.'
    : '';
}

// Only identifiers are restored. The shop record itself is always re-read from
// the live OMS, so a stale browser entry can never become a run target.
function applySavedEnvironment(): void {
  const saved = savedEnvironment.value;
  if (!saved || saved.instanceName !== activeInstanceName.value) return;
  if (shops.value.some(shop => shop.connectorShopId === saved.connectorShopId)) shopId.value = saved.connectorShopId;
}

function applySavedLocation(): void {
  const saved = savedEnvironment.value;
  const preferred = saved && saved.instanceName === activeInstanceName.value && saved.connectorShopId === shopId.value
    ? saved.locationGid
    : selectedShop.value?.locationGid ?? '';
  if (preferred && locations.value.some(item => item.gid === preferred)) environmentLocationGid.value = preferred;
}

watch(environmentLocationGid, (newGid) => {
  if (newGid) {
    const loc = locations.value.find(item => item.gid === newGid);
    testEnv.setFacility(newGid, loc?.name);
  }
});

function clearShopData(): void {
  locationRequest++;
  locationLoading.value = false;
  locations.value = [];
  locationCursor.value = null;
}

async function refreshSaved(): Promise<void> {
  // A Keychain that cannot be read is reported, not treated as "nothing saved".
  try { savedConnections.value = (await getSavedOmsConnections()).saved; }
  catch (cause) { savedConnections.value = []; error.value = cause instanceof Error ? cause.message : 'Saved connections could not be read.'; }
}

async function connectSaved(entry: SavedOmsConnection): Promise<void> {
  if (busy.value) return;
  busy.value = true; connectingId.value = entry.id; error.value = '';
  try {
    const result = await connectSavedOmsConnection(entry.id);
    instanceName.value = instanceNameFromOrigin(result.connection.origin) || result.connection.label;
    activeConnectionId.value = result.connection.id;
    await refreshConnections();
    await loadShops(result.connection.id);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'The saved connection could not sign in.'; }
  finally { busy.value = false; connectingId.value = ''; }
}

async function forgetSaved(entry: SavedOmsConnection): Promise<void> {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try { await forgetOmsConnection(entry.id); await refreshSaved(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'The saved connection could not be removed.'; }
  finally { busy.value = false; }
}

async function refreshConnections() { loading.value = true; error.value = ''; try { connections.value = (await getOmsConnections()).connections; const connected = connections.value.find(connection => connection.state === 'connected'); if (!activeConnectionId.value || !connections.value.some(connection => connection.id === activeConnectionId.value)) activeConnectionId.value = connected?.id ?? ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not read OMS connections.'; } finally { loading.value = false; } }
function formatDate(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown'; }
function recentOrigin(recentInstanceName: string): string { try { return buildOmsOrigin(recentInstanceName); } catch { return ''; } }
function selectRecent(recent: RecentOmsConnection): void { instanceName.value = recent.instanceName; username.value = ''; password.value = ''; }
const canConnect = computed(() => !busy.value && Boolean(connectionOrigin.value) && Boolean(username.value.trim()) && Boolean(password.value));

// Enter in any field submits the form, so the same guard the button uses must
// also gate the submit handler.
function submitLogin() {
  if (!canConnect.value) return;
  void connect();
}

async function connect() {
  busy.value = true; error.value = '';
  try {
    const normalizedInstanceName = instanceNameFromOrigin(connectionOrigin.value);
    if (!normalizedInstanceName) throw new Error('Enter a valid HotWax instance name.');
    const added = await addOmsConnection(normalizedInstanceName);
    const loggedIn = await loginOms(added.connection.id, username.value, password.value);
    rememberRecentOmsConnection({ instanceName: normalizedInstanceName });
    recentConnections.value = readRecentOmsConnections();
    if (rememberConnection.value) {
      // Saved only on an explicit opt-in, and only after the OMS accepted the
      // credentials, so a typo is never stored.
      try { await saveOmsConnection({ instanceName: normalizedInstanceName, username: username.value, password: password.value }); await refreshSaved(); }
      catch (cause) { error.value = cause instanceof Error ? cause.message : 'The connection signed in but could not be saved.'; }
    }
    instanceName.value = instanceNameFromOrigin(loggedIn.connection.origin) || loggedIn.connection.label;
    username.value = ''; password.value = '';
    activeConnectionId.value = loggedIn.connection.id;
    await refreshConnections();
    await loadShops(loggedIn.connection.id);
  } catch (cause) {
    password.value = '';
    error.value = cause instanceof Error ? cause.message : 'OMS login failed.';
  } finally { busy.value = false; }
}
async function logout(id: string) { busy.value = true; error.value = ''; try { await logoutOms(id); shops.value = []; shopId.value = ''; environmentLocationGid.value = ''; environmentMessage.value = ''; clearShopData(); healthCheckedAt.value = ''; activeConnectionId.value = ''; await refreshConnections(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'OMS logout failed.'; } finally { busy.value = false; } }
async function refreshHealth() {
  if (!activeConnectionId.value || healthLoading.value) return;
  healthLoading.value = true; error.value = '';
  try {
    const result = await getOmsHealth(activeConnectionId.value);
    const index = connections.value.findIndex(connection => connection.id === result.connection.id);
    if (index >= 0) connections.value[index] = result.connection;
    healthCheckedAt.value = new Date().toISOString();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'OMS health check failed.';
    await refreshConnections();
  } finally { healthLoading.value = false; }
}
async function loadShops(id: string) { busy.value = true; error.value = ''; clearShopData(); try { activeConnectionId.value = id; shops.value = (await getOmsShops(id)).shops; shopId.value = shops.value[0]?.connectorShopId ?? ''; testEnv.setShop(shopId.value); applySavedEnvironment(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load OMS shops.'; } finally { busy.value = false; } await loadLocations(); }
function shopChanged(): void { clearShopData(); environmentLocationGid.value = ''; environmentMessage.value = ''; testEnv.setShop(shopId.value); void loadLocations(); }
async function loadLocations(append = false) { if (!shopId.value || locationLoading.value) return; const request = ++locationRequest; locationLoading.value = true; error.value = ''; try { const result = await listOmsLocations({ connectionId: activeConnectionId.value, shopId: shopId.value, cursor: append ? locationCursor.value ?? undefined : undefined }); if (request !== locationRequest) return; locations.value = append ? [...locations.value, ...result.items] : result.items; locationCursor.value = result.nextCursor; applySavedLocation(); } catch (cause) { if (request === locationRequest) error.value = cause instanceof Error ? cause.message : 'Location read failed.'; } finally { if (request === locationRequest) locationLoading.value = false; } }
onMounted(async () => {
  recentConnections.value = readRecentOmsConnections();
  testEnv.loadSavedEnvironment();
  await refreshSaved();
  await refreshConnections();
  if (activeConnectionId.value) await loadShops(activeConnectionId.value);
});
onIonViewWillEnter(async () => {
  testEnv.loadSavedEnvironment();
  if (activeConnectionId.value && locations.value.length === 0) {
    await loadLocations();
  }
});
</script>

<style scoped>
.badge-row { display: flex; flex-wrap: wrap; gap: .35rem; }
.shop-options { display: flex; flex-wrap: wrap; gap: .5rem; }
.shop-option { flex: 1 1 260px; }
.shop-option ion-radio { width: 100%; }
</style>
