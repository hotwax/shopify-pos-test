<template>
  <ion-page>
    <ion-header><ion-toolbar><ion-title>Shopify POS</ion-title></ion-toolbar></ion-header>
    <ion-content class="ion-padding">
      <ion-chip color="warning">TEST STORE ONLY</ion-chip>
      <h1>Plan a Shopify POS test</h1>
      <p>Choose a reviewed workflow, select real OMS data, and freeze the exact iPad, shop and location before a run. Payment actions remain unavailable until the native safety gates are proven.</p>

      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <ion-card>
        <ion-card-header><ion-card-title>1. Choose a workflow</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-grid><ion-row>
            <ion-col v-for="scenario in scenarios" :key="scenario.id" size="12" size-md="6">
              <ion-card :color="selectedScenario === scenario.id ? 'primary' : undefined" button @click="selectScenario(scenario.id)">
                <ion-card-header><ion-card-title>{{ scenario.name }}</ion-card-title></ion-card-header>
                <ion-card-content>
                  <p>{{ scenario.description }}</p>
                  <ion-badge :color="scenario.effect === 'read-only' ? 'success' : 'warning'">{{ scenario.effect }}</ion-badge>
                  <p v-if="scenario.effect !== 'read-only'" class="ion-margin-top"><ion-note color="warning">This workflow is configured here, but native execution is still gated.</ion-note></p>
                </ion-card-content>
              </ion-card>
            </ion-col>
          </ion-row></ion-grid>
          <ion-button v-if="selectedScenario === 'pos.open-first-order'" router-link="/scripts/pos.open-first-order">Open the read-only script</ion-button>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>2. Freeze the target environment</ion-card-title></ion-card-header>
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
            <ion-label position="stacked">Shopify API version</ion-label>
            <ion-input v-model="apiVersion" aria-label="Shopify API version" placeholder="For example, 2026-01" />
          </ion-item>
          <ion-note v-if="selectedShop" color="medium"><p>Shop GID: {{ selectedShop.shopGid || 'not supplied' }}<br>OMS user: {{ activeConnection?.userId || 'not connected' }}</p></ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="isMutation">
        <ion-card-header><ion-card-title>3. Configure exact test data</ion-card-title></ion-card-header>
        <ion-card-content>
          <template v-if="selectedScenario === 'pos.create-cash-order'">
            <p>Resolve a real purchasable variant in the selected shop. Product IDs are not accepted as variant IDs.</p>
            <ion-item><ion-label position="stacked">Currency</ion-label><ion-input v-model="currency" aria-label="Test currency" maxlength="3" /></ion-item>
            <ion-item><ion-label position="stacked">Variant GID</ion-label><ion-input v-model="variantGid" aria-label="Create-order variant GID" placeholder="gid://shopify/ProductVariant/…" /></ion-item>
            <ion-button fill="outline" @click="resolveVariant(false)" :disabled="variantLoading || !shopId">{{ variantLoading ? 'Verifying…' : 'Verify variant ID' }}</ion-button>
            <ion-item><ion-label position="stacked">Search variants</ion-label><ion-input v-model="variantSearch" aria-label="Search variants" /></ion-item>
            <ion-button fill="outline" @click="searchVariants" :disabled="variantLoading || !shopId">{{ variantLoading ? 'Searching…' : 'Search variants' }}</ion-button>
            <ion-list><ion-item v-for="variant in variants" :key="variant.gid" button detail="false" @click="selectVariant(variant, 'create')"><ion-label>{{ variant.productTitle }} · {{ variant.title }}<p>{{ variant.sku || 'No SKU' }} · {{ variant.gid }}</p></ion-label><ion-badge slot="end" v-if="variantGid === variant.gid">Selected</ion-badge></ion-item></ion-list>
            <ion-item><ion-label position="stacked">Quantity</ion-label><ion-input v-model="quantity" type="number" min="1" aria-label="Create-order quantity" /></ion-item>
            <ion-item><ion-label position="stacked">Maximum cash total</ion-label><ion-input v-model="maximumTotal" inputmode="decimal" aria-label="Maximum order total" /><ion-note slot="end">{{ currency }}</ion-note></ion-item>
            <ion-item><ion-label position="stacked">Optional note</ion-label><ion-textarea v-model="note" aria-label="Order note" auto-grow /></ion-item>
          </template>

          <template v-else>
            <p>Choose an existing cash-only test order, then select exact refundable lines. The toolkit never guesses from a SKU or numeric order number.</p>
            <ion-item><ion-label position="stacked">Currency</ion-label><ion-input v-model="currency" aria-label="Test currency" maxlength="3" /></ion-item>
            <ion-item><ion-label position="stacked">Exact Shopify order GID</ion-label><ion-input v-model="orderGid" aria-label="Source order GID" placeholder="gid://shopify/Order/…" /></ion-item>
            <ion-button fill="outline" @click="resolveOrder" :disabled="orderLoading || !shopId">{{ orderLoading ? 'Loading…' : 'Load exact order' }}</ion-button>
            <ion-item><ion-label position="stacked">Search existing orders</ion-label><ion-input v-model="orderSearch" aria-label="Search orders" /></ion-item>
            <ion-button fill="outline" @click="searchOrders" :disabled="orderLoading || !shopId">{{ orderLoading ? 'Searching…' : 'Search orders' }}</ion-button>
            <ion-list><ion-item v-for="order in orders" :key="order.gid" button detail="false" @click="selectOrder(order)"><ion-label>{{ order.name }}<p>{{ order.financialStatus || 'Unknown status' }} · {{ order.gid }}</p></ion-label><ion-badge slot="end" v-if="selectedOrder?.gid === order.gid">Selected</ion-badge></ion-item></ion-list>
            <ion-button fill="outline" @click="loadOrderDetail" :disabled="!selectedOrder || orderLoading">{{ orderLoading ? 'Loading lines…' : 'Load selected order lines' }}</ion-button>

            <ion-card v-if="selectedOrderDetail" color="light">
              <ion-card-header><ion-card-title>{{ selectedOrderDetail.name }} · source detail</ion-card-title></ion-card-header>
              <ion-card-content>
                <p>{{ selectedOrderDetail.paymentGatewayNames.length ? `Gateway: ${selectedOrderDetail.paymentGatewayNames.join(', ')}` : 'Gateway unavailable' }}<br>{{ selectedOrderDetail.total?.amount || 'Total unavailable' }} {{ selectedOrderDetail.total?.currency || '' }}</p>
                <ion-item>
                  <ion-label position="stacked">Return line</ion-label>
                  <ion-select v-model="lineGid" aria-label="Source order line" placeholder="Select a refundable line">
                    <ion-select-option v-for="line in eligibleLines" :key="line.gid" :value="line.gid">{{ line.productTitle || line.variantTitle || line.gid }} · {{ line.gid }} · refundable {{ line.refundableQuantity }}</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item><ion-label position="stacked">Return quantity</ion-label><ion-input v-model="returnQuantity" type="number" min="1" aria-label="Return quantity" /></ion-item>
                <ion-item><ion-checkbox v-model="restock">Restock returned item</ion-checkbox></ion-item>
                <ion-item><ion-label position="stacked">Maximum cash refund</ion-label><ion-input v-model="maximumRefund" inputmode="decimal" aria-label="Maximum refund" /><ion-note slot="end">{{ currency }}</ion-note></ion-item>
                <ion-note :color="sourceIsCash ? 'success' : 'danger'"><p>{{ sourceIsCash ? 'The source order is cash-only.' : 'This source is not verified as a cash-only order; the workflow will remain blocked.' }}</p></ion-note>
              </ion-card-content>
            </ion-card>

            <template v-if="selectedScenario === 'pos.exchange-cash-order'">
              <ion-item><ion-label position="stacked">Replacement variant GID</ion-label><ion-input v-model="replacementVariantGid" aria-label="Replacement variant GID" placeholder="gid://shopify/ProductVariant/…" /></ion-item>
              <ion-button fill="outline" @click="resolveVariant(true)" :disabled="variantLoading || !shopId">{{ variantLoading ? 'Verifying…' : 'Verify replacement ID' }}</ion-button>
              <ion-item><ion-label position="stacked">Search replacement variants</ion-label><ion-input v-model="variantSearch" aria-label="Search replacement variants" /></ion-item>
              <ion-button fill="outline" @click="searchVariants" :disabled="variantLoading || !shopId">{{ variantLoading ? 'Searching…' : 'Search replacement variants' }}</ion-button>
              <ion-list><ion-item v-for="variant in variants" :key="`replacement-${variant.gid}`" button detail="false" @click="selectVariant(variant, 'replacement')"><ion-label>{{ variant.productTitle }} · {{ variant.title }}<p>{{ variant.sku || 'No SKU' }} · {{ variant.gid }}</p></ion-label><ion-badge slot="end" v-if="replacementVariantGid === variant.gid">Selected</ion-badge></ion-item></ion-list>
              <ion-item><ion-label position="stacked">Replacement quantity</ion-label><ion-input v-model="replacementQuantity" type="number" min="1" aria-label="Replacement quantity" /></ion-item>
              <ion-item><ion-label position="stacked">Expected balance direction</ion-label><ion-select v-model="direction" aria-label="Exchange direction"><ion-select-option value="collect">Collect difference</ion-select-option><ion-select-option value="even">Even exchange</ion-select-option><ion-select-option value="refund">Refund difference</ion-select-option></ion-select></ion-item>
              <ion-item><ion-label position="stacked">Maximum absolute difference</ion-label><ion-input v-model="maximumDifference" inputmode="decimal" aria-label="Maximum exchange difference" /><ion-note slot="end">{{ currency }}</ion-note></ion-item>
            </template>
          </template>

          <ion-note color="medium"><p>Exact IDs remain scoped to the selected OMS shop. No Shopify API mutation is sent by this page.</p></ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card>
        <ion-card-header><ion-card-title>4. Safety gates</ion-card-title></ion-card-header>
        <ion-card-content>
          <ion-text color="success" v-if="readiness?.enabled"><p>The reviewed mutation gates report ready. The native worker will still recheck POS context and the final cash summary before the commit checkpoint.</p></ion-text>
          <ion-text color="warning" v-else><p><strong>Mutation workflows are not runnable yet.</strong></p></ion-text>
          <ion-list v-if="readiness?.reasons.length"><ion-item v-for="reason in readiness.reasons" :key="reason"><ion-label>{{ reason }}</ion-label><ion-badge slot="end" color="warning">blocked</ion-badge></ion-item></ion-list>
          <ion-note><p>Selecting a shop or location here never changes Shopify POS's active location. Apple automation access is also never changed by this app.</p></ion-note>
        </ion-card-content>
      </ion-card>

      <ion-card v-if="isMutation" color="light">
        <ion-card-header><ion-card-title>5. Review and run</ion-card-title></ion-card-header>
        <ion-card-content>
          <p><strong>{{ selectedScenarioName }}:</strong> {{ summary }}</p>
          <ion-text color="danger" v-if="planError"><p>{{ planError }}</p></ion-text>
          <ion-text color="warning" v-if="!targetReady"><p>Select a connected OMS user, shop, exact location, API version and saved iPad profile before running.</p></ion-text>
          <ion-button @click="runMutation" :disabled="starting || !canRunMutation">{{ starting ? 'Starting…' : canRunMutation ? 'Review and run' : 'Run unavailable until all gates pass' }}</ion-button>
        </ion-card-content>
      </ion-card>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { IonBadge, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonCheckbox, IonChip, IonCol, IonContent, IonGrid, IonHeader, IonInput, IonItem, IonLabel, IonList, IonNote, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTextarea, IonTitle, IonToolbar } from '@ionic/vue';
import type { DeviceProfile, MutationReadiness, OmsConnectionSummary, OmsLocation, OmsOrder, OmsShop, OmsShopifyOrderDetail, OmsVariant, TargetContext } from '../../shared/contracts.ts';
import { getHealth, getMutationReadiness, getOmsConnections, getOmsShops, getOmsShopifyOrderDetail, getProfiles, listOmsLocations, searchOmsOrders, searchOmsVariants, startRun } from '../api.ts';
import { buildMutationParameters, buildTargetContext, type MutationScenarioId, type PosPlanInput } from '../pos-plan.ts';

type ScenarioId = 'pos.open-first-order' | MutationScenarioId;
type VariantTarget = 'create' | 'replacement';

const scenarios = [
  { id: 'pos.open-first-order', name: 'Open first order', description: 'Read-only Home → Orders → first listed order detail smoke.', effect: 'read-only' },
  { id: 'pos.create-cash-order', name: 'Create a cash order', description: 'Add selected variants in Shopify POS and complete a test-store cash order.', effect: 'create-order' },
  { id: 'pos.return-cash-order', name: 'Return an existing order', description: 'Return exact eligible lines from a cash test fixture with explicit restock choices.', effect: 'return' },
  { id: 'pos.exchange-cash-order', name: 'Exchange an existing order', description: 'Exercise equal, collect-difference or refund-difference cash exchange paths.', effect: 'exchange' },
] as const;

const router = useRouter();
const selectedScenario = ref<ScenarioId>('pos.open-first-order');
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
const variantGid = ref(''); const replacementVariantGid = ref(''); const quantity = ref('1'); const replacementQuantity = ref('1');
const orderGid = ref(''); const lineGid = ref(''); const returnQuantity = ref('1'); const restock = ref(true);
const maximumTotal = ref('20.00'); const maximumRefund = ref('20.00'); const maximumDifference = ref('20.00'); const currency = ref('USD');
const direction = ref<'collect' | 'even' | 'refund'>('collect'); const note = ref('');
const orderSearch = ref(''); const variantSearch = ref('');
const loadingShops = ref(false); const loadingLocations = ref(false); const variantLoading = ref(false); const orderLoading = ref(false); const starting = ref(false); const error = ref('');

const activeConnection = computed(() => connections.value.find(connection => connection.id === connectionId.value));
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));
const selectedScenarioName = computed(() => scenarios.find(scenario => scenario.id === selectedScenario.value)?.name ?? 'Selected workflow');
const isMutation = computed(() => selectedScenario.value !== 'pos.open-first-order');
const eligibleLines = computed(() => (selectedOrderDetail.value?.lines ?? []).filter(line => (line.refundableQuantity ?? 0) > 0));
const sourceIsCash = computed(() => selectedOrderDetail.value?.paymentGatewayNames.length === 1 && selectedOrderDetail.value.paymentGatewayNames[0]?.trim().toLowerCase() === 'cash');
const targetReady = computed(() => Boolean(profiles.value.some(profile => profile.id === profileId.value) && activeConnection.value?.state === 'connected' && activeConnection.value.userId && selectedShop.value?.shopGid && selectedShop.value.shopDomain && locationGid.value && apiVersion.value));

function planInput(): PosPlanInput {
  return {
    scenario: selectedScenario.value as MutationScenarioId, currency: currency.value, maximumTotal: maximumTotal.value, maximumRefund: maximumRefund.value, maximumDifference: maximumDifference.value,
    variantGid: variantGid.value, quantity: quantity.value, orderGid: orderGid.value, lineGid: lineGid.value, returnQuantity: returnQuantity.value, restock: restock.value,
    replacementVariantGid: replacementVariantGid.value, replacementQuantity: replacementQuantity.value, direction: direction.value, note: note.value,
    remaining: Object.fromEntries((selectedOrderDetail.value?.lines ?? []).map(line => [line.gid, line.refundableQuantity ?? -1])),
  };
}

const planError = computed(() => {
  if (!isMutation.value) return '';
  try { buildMutationParameters(planInput()); return ''; }
  catch (cause) { return cause instanceof Error ? cause.message : 'Complete the exact test inputs.'; }
});
const canRunMutation = computed(() => Boolean(readiness.value?.enabled && targetReady.value && !planError.value));
const summary = computed(() => {
  if (selectedScenario.value === 'pos.create-cash-order') return `${variantGid.value || 'no variant'} × ${quantity.value}; maximum ${maximumTotal.value || 'unset'} ${currency.value}.`;
  if (!selectedOrderDetail.value) return `${orderGid.value || 'no source order'}; load exact eligible lines before review.`;
  const line = lineGid.value || 'no line';
  if (selectedScenario.value === 'pos.return-cash-order') return `${selectedOrderDetail.value.name} · ${line} × ${returnQuantity.value}; maximum refund ${maximumRefund.value || 'unset'} ${currency.value}.`;
  return `${selectedOrderDetail.value.name} · return ${line} × ${returnQuantity.value}; replace with ${replacementVariantGid.value || 'no variant'} × ${replacementQuantity.value}; ${direction.value}, maximum ${maximumDifference.value || 'unset'} ${currency.value}.`;
});

function clearShopData(): void { locations.value = []; variants.value = []; orders.value = []; selectedOrder.value = undefined; selectedOrderDetail.value = undefined; locationGid.value = ''; variantGid.value = ''; replacementVariantGid.value = ''; orderGid.value = ''; lineGid.value = ''; }
function selectScenario(id: ScenarioId): void { selectedScenario.value = id; error.value = ''; }
function connectionChanged(): void { shops.value = []; shopId.value = ''; clearShopData(); }
function shopChanged(): void { clearShopData(); }
function selectOrder(order: OmsOrder): void { selectedOrder.value = order; orderGid.value = order.gid; selectedOrderDetail.value = undefined; lineGid.value = ''; }
function selectVariant(variant: OmsVariant, target: VariantTarget): void { if (target === 'replacement') replacementVariantGid.value = variant.gid; else variantGid.value = variant.gid; }

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
  if (!connectionId.value || !shopId.value || variantLoading.value) return;
  variantLoading.value = true; error.value = '';
  try { variants.value = (await searchOmsVariants({ connectionId: connectionId.value, shopId: shopId.value, search: variantSearch.value })).items; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Variant search failed.'; }
  finally { variantLoading.value = false; }
}

async function resolveVariant(replacement: boolean): Promise<void> {
  const value = (replacement ? replacementVariantGid.value : variantGid.value).trim();
  if (!/^gid:\/\/shopify\/ProductVariant\/[A-Za-z0-9_-]+$/.test(value)) { error.value = 'Enter an exact Shopify ProductVariant GID.'; return; }
  if (!connectionId.value || !shopId.value || variantLoading.value) return;
  variantLoading.value = true; error.value = '';
  try {
    const result = await searchOmsVariants({ connectionId: connectionId.value, shopId: shopId.value, search: value });
    const match = result.items.find(item => item.gid === value);
    if (!match) throw new Error('The exact variant was not returned by the selected OMS shop.');
    variants.value = [...variants.value.filter(item => item.gid !== match.gid), match];
    selectVariant(match, replacement ? 'replacement' : 'create');
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Variant verification failed.'; }
  finally { variantLoading.value = false; }
}

async function searchOrders(): Promise<void> {
  if (!connectionId.value || !shopId.value || orderLoading.value) return;
  orderLoading.value = true; error.value = '';
  try { orders.value = (await searchOmsOrders({ connectionId: connectionId.value, shopId: shopId.value, search: orderSearch.value })).items; selectedOrder.value = undefined; selectedOrderDetail.value = undefined; lineGid.value = ''; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Order search failed.'; }
  finally { orderLoading.value = false; }
}

async function resolveOrder(): Promise<void> {
  const value = orderGid.value.trim();
  if (!/^gid:\/\/shopify\/Order\/[A-Za-z0-9_-]+$/.test(value)) { error.value = 'Enter an exact Shopify Order GID.'; return; }
  selectedOrder.value = { gid: value, name: value, financialStatus: null, fulfillmentStatus: null };
  await loadOrderDetail();
}

async function loadOrderDetail(): Promise<void> {
  if (!connectionId.value || !shopId.value || !selectedOrder.value || orderLoading.value) return;
  orderLoading.value = true; error.value = '';
  try {
    selectedOrderDetail.value = (await getOmsShopifyOrderDetail({ connectionId: connectionId.value, shopId: shopId.value, gid: selectedOrder.value.gid })).order;
    lineGid.value = eligibleLines.value[0]?.gid ?? '';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Order detail failed.'; }
  finally { orderLoading.value = false; }
}

function targetContext(): TargetContext {
  if (!activeConnection.value?.userId || !selectedShop.value?.shopGid || !selectedShop.value.shopDomain) throw new Error('The OMS connection and shop must be selected before a run can be frozen.');
  return buildTargetContext({
    connectionId: connectionId.value, omsOrigin: activeConnection.value.origin, userId: activeConnection.value.userId, connectorShopId: shopId.value,
    shopGid: selectedShop.value.shopGid, shopDomain: selectedShop.value.shopDomain, locationGid: locationGid.value, apiVersion: apiVersion.value,
  });
}

async function runMutation(): Promise<void> {
  if (!canRunMutation.value || starting.value) return;
  starting.value = true; error.value = '';
  try {
    const health = await getHealth();
    const parameters = buildMutationParameters(planInput());
    const accepted = await startRun({ scriptId: selectedScenario.value as MutationScenarioId, deviceProfileId: profileId.value, parameters: parameters as unknown as Record<string, unknown>, assertionMode: 'pos-shopify-oms', expectedRevision: health.revision, context: targetContext() });
    await router.push(`/runs/${accepted.id}`);
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'The POS run could not be started.'; }
  finally { starting.value = false; }
}

onMounted(async () => {
  try {
    const [savedProfiles, mutationReadiness] = await Promise.all([getProfiles(), getMutationReadiness()]);
    profiles.value = savedProfiles.profiles; readiness.value = mutationReadiness;
    if (!profileId.value && profiles.value[0]) profileId.value = profiles.value[0].id;
    connections.value = (await getOmsConnections()).connections;
    if (!connectionId.value && connections.value[0]) connectionId.value = connections.value[0].id;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load Shopify POS planning data.'; }
});
</script>
