<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>OMS connections</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <h1>Connect an OMS</h1>
      <p>Use the approved HTTPS origin configured in this Mac's local <code>.env</code>. Credentials are sent only to the localhost sidecar and the OMS login endpoint; they are cleared from this page after login and are never stored by this app.</p>
      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <ion-card v-for="connection in connections" :key="connection.id">
        <ion-card-header><ion-card-title>{{ connection.label }}</ion-card-title></ion-card-header>
        <ion-card-content>
          <p><strong>Origin:</strong> {{ connection.origin }}</p>
          <p><strong>Status:</strong> {{ connection.state }}<span v-if="connection.userId"> · {{ connection.userId }}</span></p>
          <ion-item><ion-label position="stacked">Username</ion-label><ion-input v-model="username" autocomplete="username" /></ion-item>
          <ion-item><ion-label position="stacked">Password</ion-label><ion-input v-model="password" type="password" autocomplete="current-password" /></ion-item>
          <ion-button @click="login(connection.id)" :disabled="busy || !username || !password">{{ busy ? 'Connecting…' : 'Log in for read-only data' }}</ion-button>
          <ion-button fill="clear" color="medium" @click="logout(connection.id)" v-if="connection.state === 'connected'">Log out</ion-button>
          <ion-button fill="outline" @click="loadShops(connection.id)" v-if="connection.state === 'connected'">Refresh shops</ion-button>
        </ion-card-content>
      </ion-card>
      <ion-card v-if="!connections.length && !loading"><ion-card-content>No OMS connection is configured. Add <code>OMS_ORIGIN=https://...</code> to <code>.env</code>, restart <code>./run.sh</code>, and return here.</ion-card-content></ion-card>

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
                  <ion-item v-for="item in orders" :key="item.gid" button detail="false" @click="selectedOrder = item">
                    <ion-label>{{ item.name }}<p>{{ item.financialStatus || 'Unknown financial status' }} · {{ item.gid }}</p></ion-label>
                    <ion-badge slot="end" v-if="selectedOrder?.gid === item.gid">Selected</ion-badge>
                  </ion-item>
                </ion-list>
                <ion-button fill="clear" @click="searchOrders(true)" :disabled="orderLoading" v-if="orderCursor">Load more orders</ion-button>
                <ion-note v-if="selectedOrder" color="success"><p>Selected order: {{ selectedOrder.gid }}</p></ion-note>
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
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCol, IonContent, IonGrid, IonHeader, IonInput, IonItem, IonLabel, IonList, IonNote, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { OmsConnectionSummary, OmsLocation, OmsOrder, OmsShop, OmsVariant } from '../../shared/contracts.ts';
import { getOmsConnections, getOmsShops, listOmsLocations, loginOms, logoutOms, searchOmsOrders, searchOmsVariants } from '../api.ts';

const connections = ref<OmsConnectionSummary[]>([]);
const shops = ref<OmsShop[]>([]);
const variants = ref<OmsVariant[]>([]);
const orders = ref<OmsOrder[]>([]);
const locations = ref<OmsLocation[]>([]);
const selectedVariant = ref<OmsVariant>();
const selectedOrder = ref<OmsOrder>();
const selectedLocation = ref<OmsLocation>();
const variantCursor = ref<string | null>(null);
const orderCursor = ref<string | null>(null);
const locationCursor = ref<string | null>(null);
const activeConnectionId = ref(''); const shopId = ref(''); const username = ref(''); const password = ref('');
const variantSearch = ref(''); const orderSearch = ref(''); const loading = ref(true); const busy = ref(false); const error = ref('');
const variantLoading = ref(false); const orderLoading = ref(false); const locationLoading = ref(false);
let variantRequest = 0; let orderRequest = 0; let locationRequest = 0;
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));

function clearShopData(): void {
  variantRequest++; orderRequest++; locationRequest++;
  variantLoading.value = false; orderLoading.value = false; locationLoading.value = false;
  variants.value = []; orders.value = []; locations.value = [];
  variantCursor.value = null; orderCursor.value = null; locationCursor.value = null;
  selectedVariant.value = undefined; selectedOrder.value = undefined; selectedLocation.value = undefined;
}

async function refreshConnections() { loading.value = true; error.value = ''; try { connections.value = (await getOmsConnections()).connections; if (!activeConnectionId.value && connections.value[0]) activeConnectionId.value = connections.value[0].id; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not read OMS configuration.'; } finally { loading.value = false; } }
async function login(id: string) { busy.value = true; error.value = ''; try { await loginOms(id, username.value, password.value); username.value = ''; password.value = ''; await refreshConnections(); await loadShops(id); } catch (cause) { password.value = ''; error.value = cause instanceof Error ? cause.message : 'OMS login failed.'; } finally { busy.value = false; } }
async function logout(id: string) { busy.value = true; error.value = ''; try { await logoutOms(id); shops.value = []; shopId.value = ''; clearShopData(); await refreshConnections(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'OMS logout failed.'; } finally { busy.value = false; } }
async function loadShops(id: string) { busy.value = true; error.value = ''; clearShopData(); try { activeConnectionId.value = id; shops.value = (await getOmsShops(id)).shops; shopId.value = shops.value[0]?.connectorShopId ?? ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load OMS shops.'; } finally { busy.value = false; } }
function shopChanged(): void { clearShopData(); }
async function searchVariants(append = false) { if (!shopId.value || variantLoading.value) return; const request = ++variantRequest; variantLoading.value = true; error.value = ''; try { const result = await searchOmsVariants({ connectionId: activeConnectionId.value, shopId: shopId.value, search: variantSearch.value, cursor: append ? variantCursor.value ?? undefined : undefined }); if (request !== variantRequest) return; variants.value = append ? [...variants.value, ...result.items] : result.items; variantCursor.value = result.nextCursor; if (!append) selectedVariant.value = undefined; } catch (cause) { if (request === variantRequest) error.value = cause instanceof Error ? cause.message : 'Variant search failed.'; } finally { if (request === variantRequest) variantLoading.value = false; } }
async function searchOrders(append = false) { if (!shopId.value || orderLoading.value) return; const request = ++orderRequest; orderLoading.value = true; error.value = ''; try { const result = await searchOmsOrders({ connectionId: activeConnectionId.value, shopId: shopId.value, search: orderSearch.value, cursor: append ? orderCursor.value ?? undefined : undefined }); if (request !== orderRequest) return; orders.value = append ? [...orders.value, ...result.items] : result.items; orderCursor.value = result.nextCursor; if (!append) selectedOrder.value = undefined; } catch (cause) { if (request === orderRequest) error.value = cause instanceof Error ? cause.message : 'Order search failed.'; } finally { if (request === orderRequest) orderLoading.value = false; } }
async function loadLocations(append = false) { if (!shopId.value || locationLoading.value) return; const request = ++locationRequest; locationLoading.value = true; error.value = ''; try { const result = await listOmsLocations({ connectionId: activeConnectionId.value, shopId: shopId.value, cursor: append ? locationCursor.value ?? undefined : undefined }); if (request !== locationRequest) return; locations.value = append ? [...locations.value, ...result.items] : result.items; locationCursor.value = result.nextCursor; if (!append) selectedLocation.value = undefined; } catch (cause) { if (request === locationRequest) error.value = cause instanceof Error ? cause.message : 'Location read failed.'; } finally { if (request === locationRequest) locationLoading.value = false; } }
onMounted(refreshConnections);
</script>
