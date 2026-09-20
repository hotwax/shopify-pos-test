<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>OMS connections</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <h1>OMS data connection</h1>
      <p>Connect to a test OMS instance from this page. Credentials are sent only to the localhost sidecar and the OMS login endpoint; they are cleared after login and are never stored by this app.</p>
      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <ion-card v-if="activeConnection?.state === 'connected'">
        <ion-card-header><ion-card-title>Connection health</ion-card-title></ion-card-header>
        <ion-card-content>
          <p><strong>Instance:</strong> {{ activeConnection.label }}<br><strong>Origin:</strong> {{ activeConnection.origin }}<br><strong>Status:</strong> Connected<span v-if="activeConnection.userId"> · {{ activeConnection.userId }}</span></p>
          <p v-if="activeConnection.expiresAt"><strong>Session expires:</strong> {{ formatDate(activeConnection.expiresAt) }}</p>
          <ion-note v-if="healthCheckedAt"><p>Last health check: {{ formatDate(healthCheckedAt) }}</p></ion-note>
          <ion-button fill="outline" @click="refreshHealth" :disabled="healthLoading">{{ healthLoading ? 'Checking…' : 'Refresh health' }}</ion-button>
          <ion-button fill="clear" color="medium" @click="logout(activeConnectionId)">Log out and switch OMS</ion-button>
        </ion-card-content>
      </ion-card>

      <ion-card v-else>
        <ion-card-header><ion-card-title>Log in to a test OMS</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-item><ion-label position="stacked">HotWax instance name</ion-label><ion-input v-model="instanceName" autocomplete="organization" placeholder="test-maarg" /></ion-item>
          <p v-if="connectionOrigin"><strong>Will connect to:</strong> {{ connectionOrigin }}</p>
          <ion-item><ion-label position="stacked">Username</ion-label><ion-input v-model="username" autocomplete="username" /></ion-item>
          <ion-item><ion-label position="stacked">Password</ion-label><ion-input v-model="password" type="password" autocomplete="current-password" /></ion-item>
          <ion-button @click="connect" :disabled="busy || !connectionOrigin || !username.trim() || !password">{{ busy ? 'Connecting…' : 'Log in for read-only data' }}</ion-button>
          <p><ion-note>The instance name is used to derive its HTTPS URL and is saved locally as a recent connection after a successful login. Your username, password, bearer token and OMS data are not saved in browser storage.</ion-note></p>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="activeConnection?.state !== 'connected' && recentConnections.length">
        <ion-card-header><ion-card-title>Recent OMS instances</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-list>
            <ion-item v-for="recent in recentConnections" :key="recent.instanceName" button detail="false" @click="selectRecent(recent)">
              <ion-label><strong>{{ recent.instanceName }}</strong><p>{{ recentOrigin(recent.instanceName) }}</p></ion-label>
              <ion-button slot="end" fill="outline" @click.stop="selectRecent(recent)">Use</ion-button>
            </ion-item>
          </ion-list>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="connections.some(connection => connection.state === 'configured' || connection.state === 'expired') && activeConnection?.state !== 'connected'">
        <ion-card-content><ion-note>Existing local connection records are available in this process. Enter the instance name above to log in; the app derives the HTTPS origin and the sidecar keeps the session only in memory.</ion-note></ion-card-content>
      </ion-card>

      <ion-card v-if="shops.length">
        <ion-card-header><ion-card-title>Shop scope</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-item><ion-label position="stacked">Shop</ion-label><ion-select v-model="shopId" aria-label="OMS shop" @ionChange="shopChanged"><ion-select-option v-for="shop in shops" :key="shop.connectorShopId" :value="shop.connectorShopId">{{ shop.name }} · {{ shop.shopDomain || shop.connectorShopId }}</ion-select-option></ion-select></ion-item>
          <p v-if="selectedShop"><strong>Shopify ID:</strong> {{ selectedShop.shopGid || 'not supplied by OMS' }}<br><strong>Primary location:</strong> {{ selectedShop.locationGid || 'not supplied by OMS' }}</p>
          <ion-button fill="outline" @click="loadShops(activeConnectionId)" :disabled="busy">Reload shop list</ion-button>
        </ion-card-content>
      </ion-card>

      <ion-grid v-if="shopId && activeConnectionId">
        <ion-row>
          <ion-col size="12" size-lg="4">
            <ion-card>
              <ion-card-header><ion-card-title>Variants</ion-card-title></ion-card-header>
              <ion-card-content>
                <ion-input v-model="variantSearch" placeholder="Search variants" aria-label="Search variants" />
                <ion-button @click="searchVariants()" :disabled="variantLoading">{{ variantLoading ? 'Searching…' : 'Search' }}</ion-button>
                <ion-list>
                  <ion-item v-for="item in variants" :key="item.gid" button detail="false" @click="selectedVariant = item">
                    <ion-label>{{ item.productTitle }} · {{ item.title }}<p>{{ item.sku || 'No SKU' }} · {{ item.gid }}</p></ion-label>
                    <ion-badge slot="end" v-if="selectedVariant?.gid === item.gid">Selected</ion-badge>
                  </ion-item>
                </ion-list>
                <ion-button fill="clear" @click="searchVariants(true)" :disabled="variantLoading" v-if="variantCursor">Load more variants</ion-button>
                <ion-note v-if="selectedVariant" color="success"><p>Selected variant: {{ selectedVariant.gid }}</p></ion-note>
              </ion-card-content>
            </ion-card>
          </ion-col>
          <ion-col size="12" size-lg="4">
            <ion-card>
              <ion-card-header><ion-card-title>Orders</ion-card-title></ion-card-header>
              <ion-card-content>
                <ion-input v-model="orderSearch" placeholder="Search orders" aria-label="Search orders" />
                <ion-button @click="searchOrders()" :disabled="orderLoading">{{ orderLoading ? 'Searching…' : 'Search' }}</ion-button>
                <ion-list>
                  <ion-item v-for="item in orders" :key="item.gid" button detail="false" @click="selectShopifyOrder(item)">
                    <ion-label>{{ item.name }}<p>{{ item.financialStatus || 'Unknown financial status' }} · {{ item.gid }}</p></ion-label>
                    <ion-badge slot="end" v-if="selectedOrder?.gid === item.gid">Selected</ion-badge>
                  </ion-item>
                </ion-list>
                <ion-button fill="clear" @click="searchOrders(true)" :disabled="orderLoading" v-if="orderCursor">Load more orders</ion-button>
                <ion-note v-if="selectedOrder" color="success"><p>Selected order: {{ selectedOrder.gid }}</p></ion-note>
                <ion-button fill="outline" @click="loadShopifyOrderDetail()" :disabled="shopifyDetailLoading" v-if="selectedOrder">{{ shopifyDetailLoading ? 'Loading lines…' : 'Load Shopify order lines' }}</ion-button>
                <ion-note v-if="shopifyDetailError" color="danger"><p>{{ shopifyDetailError }}</p></ion-note>
                <ion-card v-if="selectedShopifyDetail" color="light">
                  <ion-card-header><ion-card-title>{{ selectedShopifyDetail.name }} · Shopify detail</ion-card-title></ion-card-header>
                  <ion-card-content>
                    <p>{{ selectedShopifyDetail.financialStatus || 'Unknown financial status' }} · {{ selectedShopifyDetail.fulfillmentStatus || 'Unknown fulfillment status' }}<br>{{ selectedShopifyDetail.total?.amount || 'Total unavailable' }} {{ selectedShopifyDetail.total?.currency || '' }}</p>
                    <ion-list>
                      <ion-item v-for="line in selectedShopifyDetail.lines" :key="line.gid">
                        <ion-label>{{ line.productTitle || line.variantTitle || 'Unknown product' }}<p>{{ line.variantGid || 'No variant ID' }} · {{ line.sku || 'No SKU' }} · quantity {{ line.quantity }}</p></ion-label>
                        <ion-note slot="end">refundable {{ line.refundableQuantity ?? 'unavailable' }}</ion-note>
                      </ion-item>
                    </ion-list>
                    <ion-button fill="clear" @click="loadShopifyOrderDetail(true)" :disabled="shopifyDetailLoading" v-if="selectedShopifyDetail.nextCursor">Load more lines</ion-button>
                    <ion-note>Read-only data from the named OMS Shopify GraphQL operation. It does not enable or perform a POS mutation.</ion-note>
                  </ion-card-content>
                </ion-card>
              </ion-card-content>
            </ion-card>
          </ion-col>
          <ion-col size="12" size-lg="4">
            <ion-card>
              <ion-card-header><ion-card-title>Locations</ion-card-title></ion-card-header>
              <ion-card-content>
                <ion-button @click="loadLocations()" :disabled="locationLoading">{{ locationLoading ? 'Loading…' : 'Load locations' }}</ion-button>
                <ion-list>
                  <ion-item v-for="item in locations" :key="item.gid" button detail="false" @click="selectedLocation = item">
                    <ion-label>{{ item.name }}<p>{{ item.gid }}</p></ion-label>
                    <ion-badge slot="end" v-if="selectedLocation?.gid === item.gid">Selected</ion-badge>
                  </ion-item>
                </ion-list>
                <ion-button fill="clear" @click="loadLocations(true)" :disabled="locationLoading" v-if="locationCursor">Load more locations</ion-button>
                <ion-note v-if="selectedLocation" color="success"><p>Selected location: {{ selectedLocation.gid }}</p></ion-note>
              </ion-card-content>
            </ion-card>
          </ion-col>
        </ion-row>
      </ion-grid>

      <ion-card v-if="activeConnection?.state === 'connected'">
        <ion-card-header><ion-card-title>OMS order records</ion-card-title></ion-card-header>
        <ion-card-content>
          <p>Use these read-only OMS records when planning returns or exchanges. Leave the search empty for recent sales orders, or enter an exact OMS order ID, order name, or external ID.</p>
          <ion-input v-model="omsOrderSearch" placeholder="Exact OMS order ID, name, or external ID" aria-label="OMS order search" />
          <ion-button @click="searchOmsOrderRecords()" :disabled="omsOrderLoading">{{ omsOrderLoading ? 'Loading…' : 'Load OMS orders' }}</ion-button>
          <ion-list>
            <ion-item v-for="item in omsOrders" :key="item.orderId" button detail="false" @click="loadOmsOrderDetail(item)">
              <ion-label>{{ item.orderName }}<p>{{ item.orderId }} · {{ item.statusId || 'Unknown status' }} · {{ item.itemCount }} item(s)</p></ion-label>
              <ion-badge slot="end" v-if="selectedOmsOrder?.orderId === item.orderId">Selected</ion-badge>
            </ion-item>
          </ion-list>
          <ion-button fill="clear" @click="searchOmsOrderRecords(true)" :disabled="omsOrderLoading" v-if="omsOrderCursor">Load more OMS orders</ion-button>
          <ion-note v-if="selectedOmsOrder" color="success"><p>Selected OMS order: {{ selectedOmsOrder.orderId }}</p></ion-note>
          <ion-note v-if="omsDetailLoading">Loading OMS order detail…</ion-note>

          <ion-card v-if="selectedOmsDetail" color="light">
            <ion-card-header><ion-card-title>Read-only order detail</ion-card-title></ion-card-header>
            <ion-card-content>
              <p><strong>{{ selectedOmsDetail.orderName }}</strong> · {{ selectedOmsDetail.statusId || 'Unknown status' }}<br>{{ selectedOmsDetail.orderId }} · {{ selectedOmsDetail.grandTotal || 'Total unavailable' }} {{ selectedOmsDetail.currency || '' }}</p>
              <ion-list>
                <ion-item v-for="item in selectedOmsDetail.items" :key="`${item.shipGroupSeqId || 'group'}-${item.orderItemSeqId}`">
                  <ion-label>{{ item.productName || item.productId }}<p>{{ item.productId }} · {{ item.sku || 'No SKU' }} · ordered {{ item.quantity ?? 'unknown' }} · shipped {{ item.shippedQuantity ?? 'unknown' }}</p></ion-label>
                  <ion-note slot="end">returnable {{ item.returnableQuantity ?? 'unavailable' }}</ion-note>
                </ion-item>
              </ion-list>
              <ion-note>Returnability is displayed from the OMS response and is not used to enable a POS mutation yet.</ion-note>
            </ion-card-content>
          </ion-card>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCol, IonContent, IonGrid, IonHeader, IonInput, IonItem, IonLabel, IonList, IonNote, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { OmsConnectionSummary, OmsLocation, OmsOrder, OmsOrderDetail, OmsOrderRecord, OmsShop, OmsShopifyOrderDetail, OmsVariant } from '../../shared/contracts.ts';
import { addOmsConnection, getOmsConnections, getOmsHealth, getOmsOrderDetail, getOmsShops, getOmsShopifyOrderDetail, listOmsLocations, loginOms, logoutOms, searchOmsOrderRecords as searchOmsOrderRecordsRequest, searchOmsOrders, searchOmsVariants } from '../api.ts';
import { readRecentOmsConnections, rememberRecentOmsConnection, type RecentOmsConnection } from '../oms-recents.ts';
import { buildOmsOrigin, instanceNameFromOrigin } from '../oms-origin.ts';

const connections = ref<OmsConnectionSummary[]>([]);
const shops = ref<OmsShop[]>([]);
const variants = ref<OmsVariant[]>([]);
const orders = ref<OmsOrder[]>([]);
const locations = ref<OmsLocation[]>([]);
const omsOrders = ref<OmsOrderRecord[]>([]);
const selectedOmsOrder = ref<OmsOrderRecord>();
const selectedOmsDetail = ref<OmsOrderDetail>();
const selectedShopifyDetail = ref<OmsShopifyOrderDetail>();
const selectedVariant = ref<OmsVariant>();
const selectedOrder = ref<OmsOrder>();
const selectedLocation = ref<OmsLocation>();
const variantCursor = ref<string | null>(null);
const orderCursor = ref<string | null>(null);
const locationCursor = ref<string | null>(null);
const omsOrderCursor = ref<string | null>(null);
const activeConnectionId = ref(''); const shopId = ref(''); const username = ref(''); const password = ref('');
const instanceName = ref(''); const recentConnections = ref<RecentOmsConnection[]>([]);
const connectionOrigin = computed(() => { try { return buildOmsOrigin(instanceName.value); } catch { return ''; } });
const variantSearch = ref(''); const orderSearch = ref(''); const omsOrderSearch = ref(''); const loading = ref(true); const busy = ref(false); const error = ref('');
const variantLoading = ref(false); const orderLoading = ref(false); const locationLoading = ref(false); const omsOrderLoading = ref(false); const omsDetailLoading = ref(false); const shopifyDetailLoading = ref(false);
const shopifyDetailError = ref(''); const healthLoading = ref(false); const healthCheckedAt = ref('');
let variantRequest = 0; let orderRequest = 0; let locationRequest = 0; let omsOrderRequest = 0; let omsDetailRequest = 0; let shopifyDetailRequest = 0;
const activeConnection = computed(() => connections.value.find(connection => connection.id === activeConnectionId.value));
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));

function clearShopData(): void {
  variantRequest++; orderRequest++; locationRequest++;
  variantLoading.value = false; orderLoading.value = false; locationLoading.value = false;
  variants.value = []; orders.value = []; locations.value = [];
  variantCursor.value = null; orderCursor.value = null; locationCursor.value = null;
  selectedVariant.value = undefined; selectedOrder.value = undefined; selectedLocation.value = undefined;
  shopifyDetailRequest++; shopifyDetailLoading.value = false; shopifyDetailError.value = ''; selectedShopifyDetail.value = undefined;
}

function clearOmsData(): void {
  omsOrderRequest++; omsDetailRequest++;
  omsOrderLoading.value = false; omsDetailLoading.value = false;
  omsOrders.value = []; omsOrderCursor.value = null;
  selectedOmsOrder.value = undefined; selectedOmsDetail.value = undefined;
}

function selectShopifyOrder(item: OmsOrder | undefined): void {
  selectedOrder.value = item;
  shopifyDetailRequest++;
  shopifyDetailLoading.value = false;
  shopifyDetailError.value = '';
  selectedShopifyDetail.value = undefined;
}

async function refreshConnections() { loading.value = true; error.value = ''; try { connections.value = (await getOmsConnections()).connections; const connected = connections.value.find(connection => connection.state === 'connected'); if (!activeConnectionId.value || !connections.value.some(connection => connection.id === activeConnectionId.value)) activeConnectionId.value = connected?.id ?? ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not read OMS connections.'; } finally { loading.value = false; } }
function formatDate(value: string): string { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown'; }
function recentOrigin(recentInstanceName: string): string { try { return buildOmsOrigin(recentInstanceName); } catch { return ''; } }
function selectRecent(recent: RecentOmsConnection): void { instanceName.value = recent.instanceName; username.value = ''; password.value = ''; }
async function connect() {
  busy.value = true; error.value = '';
  try {
    const normalizedInstanceName = instanceNameFromOrigin(connectionOrigin.value);
    if (!normalizedInstanceName) throw new Error('Enter a valid HotWax instance name.');
    const added = await addOmsConnection(normalizedInstanceName);
    const loggedIn = await loginOms(added.connection.id, username.value, password.value);
    rememberRecentOmsConnection({ instanceName: normalizedInstanceName });
    recentConnections.value = readRecentOmsConnections();
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
async function logout(id: string) { busy.value = true; error.value = ''; try { await logoutOms(id); shops.value = []; shopId.value = ''; clearShopData(); clearOmsData(); healthCheckedAt.value = ''; activeConnectionId.value = ''; await refreshConnections(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'OMS logout failed.'; } finally { busy.value = false; } }
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
async function loadShops(id: string) { busy.value = true; error.value = ''; clearShopData(); try { activeConnectionId.value = id; shops.value = (await getOmsShops(id)).shops; shopId.value = shops.value[0]?.connectorShopId ?? ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load OMS shops.'; } finally { busy.value = false; } }
function shopChanged(): void { clearShopData(); }
async function searchVariants(append = false) { if (!shopId.value || variantLoading.value) return; const request = ++variantRequest; variantLoading.value = true; error.value = ''; try { const result = await searchOmsVariants({ connectionId: activeConnectionId.value, shopId: shopId.value, search: variantSearch.value, cursor: append ? variantCursor.value ?? undefined : undefined }); if (request !== variantRequest) return; variants.value = append ? [...variants.value, ...result.items] : result.items; variantCursor.value = result.nextCursor; if (!append) selectedVariant.value = undefined; } catch (cause) { if (request === variantRequest) error.value = cause instanceof Error ? cause.message : 'Variant search failed.'; } finally { if (request === variantRequest) variantLoading.value = false; } }
async function searchOrders(append = false) { if (!shopId.value || orderLoading.value) return; const request = ++orderRequest; orderLoading.value = true; error.value = ''; try { const result = await searchOmsOrders({ connectionId: activeConnectionId.value, shopId: shopId.value, search: orderSearch.value, cursor: append ? orderCursor.value ?? undefined : undefined }); if (request !== orderRequest) return; orders.value = append ? [...orders.value, ...result.items] : result.items; orderCursor.value = result.nextCursor; if (!append) selectShopifyOrder(undefined); } catch (cause) { if (request === orderRequest) error.value = cause instanceof Error ? cause.message : 'Order search failed.'; } finally { if (request === orderRequest) orderLoading.value = false; } }
async function loadShopifyOrderDetail(append = false) {
  if (!selectedOrder.value || !activeConnectionId.value || !shopId.value || shopifyDetailLoading.value) return;
  const request = ++shopifyDetailRequest;
  shopifyDetailLoading.value = true;
  shopifyDetailError.value = '';
  try {
    const result = await getOmsShopifyOrderDetail({ connectionId: activeConnectionId.value, shopId: shopId.value, gid: selectedOrder.value.gid, cursor: append ? selectedShopifyDetail.value?.nextCursor ?? undefined : undefined });
    if (request !== shopifyDetailRequest) return;
    selectedShopifyDetail.value = append && selectedShopifyDetail.value
      ? { ...result.order, lines: [...selectedShopifyDetail.value.lines, ...result.order.lines] }
      : result.order;
  } catch (cause) {
    if (request === shopifyDetailRequest) shopifyDetailError.value = cause instanceof Error ? cause.message : 'Shopify order detail failed.';
  } finally {
    if (request === shopifyDetailRequest) shopifyDetailLoading.value = false;
  }
}
async function searchOmsOrderRecords(append = false) { if (!activeConnectionId.value || omsOrderLoading.value) return; const request = ++omsOrderRequest; omsOrderLoading.value = true; error.value = ''; try { const result = await searchOmsOrderRecordsRequest({ connectionId: activeConnectionId.value, search: omsOrderSearch.value, cursor: append ? omsOrderCursor.value ?? undefined : undefined }); if (request !== omsOrderRequest) return; omsOrders.value = append ? [...omsOrders.value, ...result.items] : result.items; omsOrderCursor.value = result.nextCursor; if (!append) { selectedOmsOrder.value = undefined; selectedOmsDetail.value = undefined; } } catch (cause) { if (request === omsOrderRequest) error.value = cause instanceof Error ? cause.message : 'OMS order search failed.'; } finally { if (request === omsOrderRequest) omsOrderLoading.value = false; } }
async function loadOmsOrderDetail(item: OmsOrderRecord) { const request = ++omsDetailRequest; selectedOmsOrder.value = item; selectedOmsDetail.value = undefined; omsDetailLoading.value = true; error.value = ''; try { const result = await getOmsOrderDetail(activeConnectionId.value, item.orderId); if (request !== omsDetailRequest) return; selectedOmsDetail.value = result.order; } catch (cause) { if (request === omsDetailRequest) error.value = cause instanceof Error ? cause.message : 'OMS order detail failed.'; } finally { if (request === omsDetailRequest) omsDetailLoading.value = false; } }
async function loadLocations(append = false) { if (!shopId.value || locationLoading.value) return; const request = ++locationRequest; locationLoading.value = true; error.value = ''; try { const result = await listOmsLocations({ connectionId: activeConnectionId.value, shopId: shopId.value, cursor: append ? locationCursor.value ?? undefined : undefined }); if (request !== locationRequest) return; locations.value = append ? [...locations.value, ...result.items] : result.items; locationCursor.value = result.nextCursor; if (!append) selectedLocation.value = undefined; } catch (cause) { if (request === locationRequest) error.value = cause instanceof Error ? cause.message : 'Location read failed.'; } finally { if (request === locationRequest) locationLoading.value = false; } }
onMounted(() => { recentConnections.value = readRecentOmsConnections(); void refreshConnections(); });
</script>
