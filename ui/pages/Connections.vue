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
          <ion-item><ion-label position="stacked">Shop</ion-label><ion-select v-model="shopId" aria-label="OMS shop"><ion-select-option v-for="shop in shops" :key="shop.connectorShopId" :value="shop.connectorShopId">{{ shop.name }} · {{ shop.shopDomain || shop.connectorShopId }}</ion-select-option></ion-select></ion-item>
          <p v-if="selectedShop"><strong>Shopify ID:</strong> {{ selectedShop.shopGid || 'not supplied by OMS' }}</p>
          <ion-button fill="outline" @click="loadShops(activeConnectionId)" :disabled="busy">Reload shop list</ion-button>
        </ion-card-content>
      </ion-card>

      <ion-grid v-if="shopId && activeConnectionId">
        <ion-row>
          <ion-col size="12" size-lg="4"><ion-card><ion-card-header><ion-card-title>Variants</ion-card-title></ion-card-header><ion-card-content><ion-input v-model="variantSearch" placeholder="Search variants" aria-label="Search variants" /><ion-button @click="searchVariants">Search</ion-button><ion-list><ion-item v-for="item in variants" :key="item.gid"><ion-label>{{ item.productTitle }} · {{ item.title }}<p>{{ item.sku || 'No SKU' }} · {{ item.gid }}</p></ion-label></ion-item></ion-list></ion-card-content></ion-card></ion-col>
          <ion-col size="12" size-lg="4"><ion-card><ion-card-header><ion-card-title>Orders</ion-card-title></ion-card-header><ion-card-content><ion-input v-model="orderSearch" placeholder="Search orders" aria-label="Search orders" /><ion-button @click="searchOrders">Search</ion-button><ion-list><ion-item v-for="item in orders" :key="item.gid"><ion-label>{{ item.name }}<p>{{ item.financialStatus || 'Unknown financial status' }} · {{ item.gid }}</p></ion-label></ion-item></ion-list></ion-card-content></ion-card></ion-col>
          <ion-col size="12" size-lg="4"><ion-card><ion-card-header><ion-card-title>Locations</ion-card-title></ion-card-header><ion-card-content><ion-button @click="loadLocations">Load locations</ion-button><ion-list><ion-item v-for="item in locations" :key="item.gid"><ion-label>{{ item.name }}<p>{{ item.gid }}</p></ion-label></ion-item></ion-list></ion-card-content></ion-card></ion-col>
        </ion-row>
      </ion-grid>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCol, IonContent, IonGrid, IonHeader, IonInput, IonItem, IonLabel, IonList, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar } from '@ionic/vue';
import type { OmsConnectionSummary, OmsLocation, OmsOrder, OmsShop, OmsVariant } from '../../shared/contracts.ts';
import { getOmsConnections, getOmsShops, listOmsLocations, loginOms, logoutOms, searchOmsOrders, searchOmsVariants } from '../api.ts';

const connections = ref<OmsConnectionSummary[]>([]);
const shops = ref<OmsShop[]>([]);
const variants = ref<OmsVariant[]>([]);
const orders = ref<OmsOrder[]>([]);
const locations = ref<OmsLocation[]>([]);
const activeConnectionId = ref(''); const shopId = ref(''); const username = ref(''); const password = ref('');
const variantSearch = ref(''); const orderSearch = ref(''); const loading = ref(true); const busy = ref(false); const error = ref('');
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));

async function refreshConnections() { loading.value = true; error.value = ''; try { connections.value = (await getOmsConnections()).connections; if (!activeConnectionId.value && connections.value[0]) activeConnectionId.value = connections.value[0].id; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not read OMS configuration.'; } finally { loading.value = false; } }
async function login(id: string) { busy.value = true; error.value = ''; try { await loginOms(id, username.value, password.value); username.value = ''; password.value = ''; await refreshConnections(); await loadShops(id); } catch (cause) { password.value = ''; error.value = cause instanceof Error ? cause.message : 'OMS login failed.'; } finally { busy.value = false; } }
async function logout(id: string) { busy.value = true; error.value = ''; try { await logoutOms(id); shops.value = []; shopId.value = ''; await refreshConnections(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'OMS logout failed.'; } finally { busy.value = false; } }
async function loadShops(id: string) { busy.value = true; error.value = ''; try { activeConnectionId.value = id; shops.value = (await getOmsShops(id)).shops; shopId.value = shops.value[0]?.connectorShopId ?? ''; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load OMS shops.'; } finally { busy.value = false; } }
async function searchVariants() { if (!shopId.value) return; try { variants.value = (await searchOmsVariants({ connectionId: activeConnectionId.value, shopId: shopId.value, search: variantSearch.value })).items; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Variant search failed.'; } }
async function searchOrders() { if (!shopId.value) return; try { orders.value = (await searchOmsOrders({ connectionId: activeConnectionId.value, shopId: shopId.value, search: orderSearch.value })).items; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Order search failed.'; } }
async function loadLocations() { if (!shopId.value) return; try { locations.value = (await listOmsLocations({ connectionId: activeConnectionId.value, shopId: shopId.value })).items; } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Location read failed.'; } }
onMounted(refreshConnections);
</script>
