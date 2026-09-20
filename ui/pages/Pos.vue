<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Shopify POS</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-chip color="warning">TEST STORE ONLY</ion-chip>
      <h1>Plan a Shopify POS test</h1>
      <p>Choose a reviewed workflow, select the real OMS data it needs, and confirm the target iPad and POS location. Irreversible workflows remain unavailable until every native safety gate is proven.</p>

      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <ion-card>
        <ion-card-header><ion-card-title>1. Choose a workflow</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-grid><ion-row>
            <ion-col v-for="scenario in scenarios" :key="scenario.id" size="12" size-md="6">
              <ion-card :color="selectedScenario === scenario.id ? 'primary' : undefined" button @click="selectedScenario = scenario.id">
                <ion-card-header><ion-card-title>{{ scenario.name }}</ion-card-title></ion-card-header>
                <ion-card-content>
                  <p>{{ scenario.description }}</p>
                  <ion-badge :color="scenario.effect === 'read-only' ? 'success' : 'warning'">{{ scenario.effect }}</ion-badge>
                  <p v-if="scenario.effect !== 'read-only'" class="ion-margin-top"><ion-note color="warning">Native execution is gated; this form is for reviewed configuration only.</ion-note></p>
                </ion-card-content>
              </ion-card>
            </ion-col>
          </ion-row></ion-grid>
          <ion-button v-if="selectedScenario === 'pos.open-first-order'" router-link="/scripts/pos.open-first-order">Open the read-only script</ion-button>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>2. Target environment</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-item>
            <ion-label position="stacked">iPad profile</ion-label>
            <ion-select v-model="profileId" aria-label="POS iPad profile" placeholder="Select a saved iPad profile">
              <ion-select-option v-for="profile in profiles" :key="profile.id" :value="profile.id">{{ profile.id }} · {{ profile.udid }}</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-item>
            <ion-label position="stacked">OMS connection</ion-label>
            <ion-select v-model="connectionId" aria-label="OMS connection" placeholder="Select a connected OMS" @ionChange="connectionChanged">
              <ion-select-option v-for="connection in connections" :key="connection.id" :value="connection.id" :disabled="connection.state !== 'connected'">{{ connection.label }} · {{ connection.state }}</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-button fill="outline" @click="loadShops" :disabled="!connectionId || loadingShops">{{ loadingShops ? 'Loading shops…' : 'Load shops' }}</ion-button>
          <ion-item v-if="shops.length">
            <ion-label position="stacked">Shopify shop</ion-label>
            <ion-select v-model="shopId" aria-label="Shopify shop" placeholder="Select a shop" @ionChange="shopChanged">
              <ion-select-option v-for="shop in shops" :key="shop.connectorShopId" :value="shop.connectorShopId">{{ shop.name }} · {{ shop.shopDomain || shop.connectorShopId }}</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-button fill="outline" @click="loadLocations" :disabled="!shopId || loadingLocations">{{ loadingLocations ? 'Loading locations…' : 'Load POS locations' }}</ion-button>
          <ion-item v-if="locations.length">
            <ion-label position="stacked">Expected POS location</ion-label>
            <ion-select v-model="locationGid" aria-label="Expected POS location" placeholder="Select the location POS must already be using">
              <ion-select-option v-for="location in locations" :key="location.gid" :value="location.gid">{{ location.name }} · {{ location.gid }}</ion-select-option>
            </ion-select>
          </ion-item>
          <ion-item>
            <ion-label position="stacked">Shopify API version recorded by the reviewed target</ion-label>
            <ion-input v-model="apiVersion" aria-label="Shopify API version" placeholder="For example, 2026-01" />
          </ion-item>
          <ion-note v-if="selectedShop" color="medium"><p>Selected shop GID: {{ selectedShop.shopGid || 'not supplied' }}<br>OMS user: {{ activeConnection?.userId || 'not connected' }}</p></ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="selectedScenario !== 'pos.open-first-order'">
        <ion-card-header><ion-card-title>3. Select real test data</ion-card-title></ion-card-header>
        <ion-card-content>
          <p>These reads are scoped to the selected OMS connection and shop. IDs are shown exactly so a maintainer can review them before a future native run.</p>
          <ion-grid><ion-row>
            <ion-col size="12" size-lg="6">
              <ion-item><ion-label position="stacked">Search variants</ion-label><ion-input v-model="variantSearch" aria-label="Search variants" /></ion-item>
              <ion-button @click="searchVariants" :disabled="!shopId || loadingVariants">{{ loadingVariants ? 'Searching…' : 'Search variants' }}</ion-button>
              <ion-list><ion-item v-for="variant in variants" :key="variant.gid" button detail="false" @click="selectedVariantGid = variant.gid"><ion-label>{{ variant.productTitle }} · {{ variant.title }}<p>{{ variant.sku || 'No SKU' }} · {{ variant.gid }}</p></ion-label><ion-badge slot="end" v-if="selectedVariantGid === variant.gid">Selected</ion-badge></ion-item></ion-list>
              <ion-note v-if="selectedVariantGid">Selected variant GID: {{ selectedVariantGid }}</ion-note>
            </ion-col>
            <ion-col size="12" size-lg="6">
              <ion-item><ion-label position="stacked">Search existing orders</ion-label><ion-input v-model="orderSearch" aria-label="Search existing orders" /></ion-item>
              <ion-button @click="searchOrders" :disabled="!shopId || loadingOrders">{{ loadingOrders ? 'Searching…' : 'Search orders' }}</ion-button>
              <ion-list><ion-item v-for="order in orders" :key="order.gid" button detail="false" @click="selectOrder(order)"><ion-label>{{ order.name }}<p>{{ order.financialStatus || 'Unknown status' }} · {{ order.gid }}</p></ion-label><ion-badge slot="end" v-if="selectedOrder?.gid === order.gid">Selected</ion-badge></ion-item></ion-list>
              <ion-button fill="outline" @click="loadOrderDetail" :disabled="!selectedOrder || loadingOrderDetail">{{ loadingOrderDetail ? 'Loading lines…' : 'Load selected order lines' }}</ion-button>
              <ion-list v-if="selectedOrderDetail"><ion-item v-for="line in selectedOrderDetail.lines" :key="line.gid"><ion-label>{{ line.productTitle || line.variantTitle || 'Unknown product' }}<p>{{ line.gid }} · {{ line.variantGid || 'No variant GID' }}</p></ion-label><ion-note slot="end">refundable {{ line.refundableQuantity ?? 'unknown' }}</ion-note></ion-item></ion-list>
            </ion-col>
          </ion-row></ion-grid>
          <ion-note color="medium">Exact IDs can also be entered through the Connections page. This page does not guess Product IDs, order numbers, SKUs or locations.</ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>4. Safety gates</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-text color="success" v-if="readiness?.enabled"><p>The reviewed mutation gates report ready. The run still rechecks native context and the final POS summary before commit.</p></ion-text>
          <ion-text color="warning" v-else><p><strong>Mutation workflows are not runnable yet.</strong></p></ion-text>
          <ion-list v-if="readiness?.reasons.length"><ion-item v-for="reason in readiness.reasons" :key="reason"><ion-label>{{ reason }}</ion-label><ion-badge slot="end" color="warning">blocked</ion-badge></ion-item></ion-list>
          <ion-note><p>Readiness is computed by the localhost sidecar. Selecting a shop or location here never changes Shopify POS's active location.</p></ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="selectedScenario !== 'pos.open-first-order'" color="light">
        <ion-card-content><strong>Review summary:</strong> {{ summary }}<br><ion-button disabled>{{ canRunMutation ? 'Review and run' : 'Run unavailable until all native gates pass' }}</ion-button></ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonChip, IonCol, IonContent, IonGrid, IonHeader, IonInput, IonItem, IonLabel, IonList, IonNote, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { DeviceProfile, MutationReadiness, OmsConnectionSummary, OmsLocation, OmsOrder, OmsShop, OmsShopifyOrderDetail, OmsVariant } from '../../shared/contracts.ts';
import { getCatalog, getMutationReadiness, getOmsConnections, getOmsShops, getOmsShopifyOrderDetail, getProfiles, listOmsLocations, searchOmsOrders, searchOmsVariants } from '../api.ts';

const scenarios = [
  { id: 'pos.open-first-order', name: 'Open first order', description: 'Read-only Home → Orders → first listed order detail smoke.', effect: 'read-only' },
  { id: 'pos.create-cash-order', name: 'Create a cash order', description: 'Add selected variants in Shopify POS and complete a test-store cash order.', effect: 'create-order' },
  { id: 'pos.return-cash-order', name: 'Return an existing order', description: 'Return exact eligible lines from a cash test fixture with explicit restock choices.', effect: 'return' },
  { id: 'pos.exchange-cash-order', name: 'Exchange an existing order', description: 'Exercise equal, collect-difference or refund-difference cash exchange paths.', effect: 'exchange' },
] as const;

const selectedScenario = ref<string>('pos.open-first-order');
const readiness = ref<MutationReadiness>();
const profiles = ref<DeviceProfile[]>([]);
const connections = ref<OmsConnectionSummary[]>([]);
const shops = ref<OmsShop[]>([]);
const locations = ref<OmsLocation[]>([]);
const variants = ref<OmsVariant[]>([]);
const orders = ref<OmsOrder[]>([]);
const selectedOrder = ref<OmsOrder>();
const selectedOrderDetail = ref<OmsShopifyOrderDetail>();
const profileId = ref(localStorage.getItem('iosTesting.profileId') ?? '');
const connectionId = ref(''); const shopId = ref(''); const locationGid = ref(''); const apiVersion = ref('');
const variantSearch = ref(''); const orderSearch = ref(''); const selectedVariantGid = ref('');
const loadingShops = ref(false); const loadingLocations = ref(false); const loadingVariants = ref(false); const loadingOrders = ref(false); const loadingOrderDetail = ref(false); const error = ref('');

const activeConnection = computed(() => connections.value.find(connection => connection.id === connectionId.value));
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));
const canRunMutation = computed(() => Boolean(readiness.value?.enabled && profileId.value && activeConnection.value?.state === 'connected' && selectedShop.value?.shopGid && locationGid.value && apiVersion.value));
const summary = computed(() => {
  const workflow = scenarios.find(scenario => scenario.id === selectedScenario.value)?.name ?? 'Selected workflow';
  return `${workflow}; ${selectedVariantGid.value ? `variant ${selectedVariantGid.value}` : 'no variant selected'}; ${selectedOrder.value ? `source ${selectedOrder.value.name}` : 'no source order selected'}.`;
});

function clearShopData(): void { locations.value = []; variants.value = []; orders.value = []; selectedOrder.value = undefined; selectedOrderDetail.value = undefined; locationGid.value = ''; selectedVariantGid.value = ''; }
function connectionChanged(): void { shops.value = []; shopId.value = ''; clearShopData(); }
function shopChanged(): void { clearShopData(); }
function selectOrder(order: OmsOrder): void { selectedOrder.value = order; selectedOrderDetail.value = undefined; }

async function loadShops(): Promise<void> {
  if (!connectionId.value || loadingShops.value) return;
  loadingShops.value = true; error.value = '';
  try { shops.value = (await getOmsShops(connectionId.value)).shops; shopId.value = shops.value[0]?.connectorShopId ?? ''; clearShopData(); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load OMS shops.'; }
  finally { loadingShops.value = false; }
}
async function loadLocations(): Promise<void> {
  if (!connectionId.value || !shopId.value || loadingLocations.value) return;
  loadingLocations.value = true; error.value = '';
  try { locations.value = (await listOmsLocations({ connectionId: connectionId.value, shopId: shopId.value })).items; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load Shopify locations.'; }
  finally { loadingLocations.value = false; }
}
async function searchVariants(): Promise<void> {
  if (!connectionId.value || !shopId.value || loadingVariants.value) return;
  loadingVariants.value = true; error.value = '';
  try { variants.value = (await searchOmsVariants({ connectionId: connectionId.value, shopId: shopId.value, search: variantSearch.value })).items; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Variant search failed.'; }
  finally { loadingVariants.value = false; }
}
async function searchOrders(): Promise<void> {
  if (!connectionId.value || !shopId.value || loadingOrders.value) return;
  loadingOrders.value = true; error.value = '';
  try { orders.value = (await searchOmsOrders({ connectionId: connectionId.value, shopId: shopId.value, search: orderSearch.value })).items; selectedOrder.value = undefined; selectedOrderDetail.value = undefined; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Order search failed.'; }
  finally { loadingOrders.value = false; }
}
async function loadOrderDetail(): Promise<void> {
  if (!connectionId.value || !shopId.value || !selectedOrder.value || loadingOrderDetail.value) return;
  loadingOrderDetail.value = true; error.value = '';
  try { selectedOrderDetail.value = (await getOmsShopifyOrderDetail({ connectionId: connectionId.value, shopId: shopId.value, gid: selectedOrder.value.gid })).order; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Order detail failed.'; }
  finally { loadingOrderDetail.value = false; }
}

onMounted(async () => {
  try {
    const [catalog, savedProfiles, mutationReadiness] = await Promise.all([getCatalog(), getProfiles(), getMutationReadiness()]);
    profiles.value = savedProfiles.profiles;
    readiness.value = mutationReadiness;
    if (!profileId.value && profiles.value[0]) profileId.value = profiles.value[0].id;
    if (catalog.errors.length) error.value = catalog.errors.join(' ');
    try {
      connections.value = (await getOmsConnections()).connections;
      if (!connectionId.value && connections.value[0]) connectionId.value = connections.value[0].id;
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'No OMS connection is configured yet.';
    }
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load Shopify POS planning data.'; }
});
</script>
