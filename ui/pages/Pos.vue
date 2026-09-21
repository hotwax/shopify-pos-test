<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button></ion-back-button>
        </ion-buttons>
        <ion-title>Shopify POS</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-chip color="warning">TEST STORE ONLY</ion-chip>
      <h1>Plan a Shopify POS test</h1>
      <p>Build the test order on the left. The cart on the right is what the run will be frozen against.</p>

      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <ion-item v-if="!environmentLoading && !targetReady" color="warning" lines="none" class="setup-warning">
        <ion-icon slot="start" :icon="alertCircleOutline" />
        <ion-label class="ion-text-wrap">Finish test environment setup before running tests.</ion-label>
        <ion-button slot="end" fill="outline" router-link="/onboarding/oms" router-direction="forward">Finish setup</ion-button>
      </ion-item>
      <ion-item v-else-if="environmentLoading" lines="none">
        <ion-spinner slot="start" name="dots" />
        <ion-label>Reading the saved test environment…</ion-label>
      </ion-item>

      <ion-grid>
        <ion-row>
          <!-- Left column: the tools that build the cart -->
          <ion-col size="12" size-lg="7">
            <ion-card class="workflow-card">
              <ion-accordion-group :value="workflowPanel" @ionChange="workflowPanelChanged">
                <ion-accordion value="workflow" :disabled="!targetReady">
                  <ion-item slot="header" :disabled="!targetReady">
                    <ion-label>
                      Workflow
                      <p>{{ selectedScenarioName || 'Choose what this run should do' }}</p>
                    </ion-label>
                    <ion-badge v-if="selectedScenario" slot="end" :color="isMutation ? 'warning' : 'success'">{{ selectedScenarioEffect }}</ion-badge>
                  </ion-item>
                  <div slot="content">
                    <ion-radio-group v-model="selectedScenario" aria-label="POS workflow" @ionChange="scenarioChanged">
                      <ion-item v-for="scenario in scenarios" :key="scenario.id">
                        <ion-radio :value="scenario.id" label-placement="end" justify="start">
                          <div class="choice-label">
                            <span>{{ scenario.name }}</span>
                            <ion-note>{{ scenario.description }}</ion-note>
                          </div>
                        </ion-radio>
                        <ion-badge slot="end" :color="scenario.effect === 'read-only' ? 'success' : 'warning'">{{ scenario.effect }}</ion-badge>
                      </ion-item>
                    </ion-radio-group>
                  </div>
                </ion-accordion>
              </ion-accordion-group>
            </ion-card>

            <!-- Read-only smoke needs no configuration at all -->
            <ion-card v-if="targetReady && selectedScenario === 'pos.open-first-order'">
              <ion-card-header><ion-card-title>Nothing to configure</ion-card-title><ion-card-subtitle>This read-only smoke opens the first order already in POS.</ion-card-subtitle></ion-card-header>
              <ion-card-content>
                <ion-button router-link="/scripts/pos.open-first-order" router-direction="forward">Open the read-only script</ion-button>
              </ion-card-content>
            </ion-card>

            <ion-card v-if="targetReady && selectedScenario === 'pos.create-cash-order'">
              <ion-card-header><ion-card-title>Start from</ion-card-title><ion-card-subtitle>Begin with an empty cart, or copy an existing order and adjust it.</ion-card-subtitle></ion-card-header>
              <ion-card-content>
                <div class="button-row">
                  <ion-button :fill="cart.origin === 'new' ? 'solid' : 'outline'" @click="startNewTemplate">
                    <ion-icon slot="start" :icon="addOutline" />
                    New test order
                  </ion-button>
                  <ion-button :fill="cart.origin === 'order' ? 'solid' : 'outline'" @click="openTemplateModal" :disabled="!targetReady">
                    <ion-icon slot="start" :icon="documentTextOutline" />
                    Use an existing order
                  </ion-button>
                </div>
                <ion-note v-if="cart.origin === 'order' && cart.sourceOrderReference" color="medium"><p>Copied from {{ cart.sourceOrderReference }}. Changes here do not touch that order.</p></ion-note>
                <ion-note v-if="templateSkipped" color="warning"><p>{{ templateSkipped }} line(s) from that order had no exact variant and were not copied.</p></ion-note>
              </ion-card-content>
            </ion-card>

            <!-- Create-order tools -->
            <ion-card v-if="targetReady && selectedScenario === 'pos.create-cash-order'">
              <ion-card-header><ion-card-title>Products</ion-card-title><ion-card-subtitle>Search by product name, variant, or SKU.</ion-card-subtitle></ion-card-header>
              <ion-card-content>
                <ion-button @click="openProductModal" :disabled="!targetReady">
                  <ion-icon slot="start" :icon="searchOutline" />
                  Add products
                </ion-button>
                <ion-note v-if="!targetReady" color="medium"><p>The test environment must be ready before products can be searched.</p></ion-note>
                <ion-note v-else-if="cart.isEmpty" color="medium"><p>No items yet. The cart on the right stays empty until you add one.</p></ion-note>
              </ion-card-content>
            </ion-card>

            <!-- Source order: collapses once an order is chosen -->
            <ion-card v-if="targetReady && isMutation && selectedScenario !== 'pos.create-cash-order'" class="workflow-card">
              <ion-accordion-group :value="sourcePanel" @ionChange="sourcePanelChanged">
                <ion-accordion value="source">
                  <ion-item slot="header">
                    <ion-label>
                      Source order
                      <p>{{ selectedOrder?.name || 'Choose the order to work from' }}</p>
                    </ion-label>
                  </ion-item>
                  <div slot="content">
                    <ion-searchbar v-model="orderSearch" aria-label="Search existing orders" placeholder="Search order number, customer, email, or status" :debounce="0" />

                    <!-- Pre-populated fulfilled orders shown before searching -->
                    <template v-if="!isSearchingOrders">
                      <ion-list-header><ion-label>Fulfilled orders</ion-label></ion-list-header>
                      <ion-text color="medium" v-if="posOrderLoading && !posOrders.length"><p>Reading fulfilled orders…</p></ion-text>
                      <ion-radio-group v-else-if="fulfilledOrders.length" :value="selectedOrder?.gid" @ionChange="selectOrderById($event.detail.value)">
                        <ion-item v-for="order in fulfilledOrders" :key="order.gid">
                          <ion-radio :value="order.gid" label-placement="end" justify="start">
                            <div class="choice-label">
                              <span>{{ order.name }}<template v-if="order.total"> · {{ order.total.amount }} {{ order.total.currency }}</template></span>
                              <ion-note>{{ order.customerName || 'No customer' }}<template v-if="order.createdAt"> · {{ formatOrderDate(order.createdAt) }}</template></ion-note>
                              <ion-note>{{ order.financialStatus || 'Payment status unavailable' }}<template v-if="order.fulfillmentStatus"> · {{ order.fulfillmentStatus }}</template></ion-note>
                              <ion-note class="order-items">{{ itemPreview(order) }}</ion-note>
                            </div>
                          </ion-radio>
                          <ion-spinner v-if="orderDetailLoadingGid === order.gid" slot="end" name="dots" />
                        </ion-item>
                      </ion-radio-group>
                      <ion-note v-else-if="!posOrderLoading" color="medium"><p>No fulfilled orders found in this store. Search above to find any order.</p></ion-note>
                      <ion-button fill="clear" @click="loadPosOrders(true)" :disabled="posOrderLoading" v-if="posOrderCursor">Load more orders</ion-button>
                    </template>

                    <!-- Search results once the tester types -->
                    <template v-else>
                      <ion-list-header><ion-label>Search results</ion-label></ion-list-header>
                      <ion-text color="medium" v-if="orderLoading && !selectedOrderDetail"><p>Searching orders…</p></ion-text>
                      <ion-radio-group v-else-if="orders.length" :value="selectedOrder?.gid" @ionChange="selectOrderById($event.detail.value)">
                        <ion-item v-for="order in orders" :key="order.gid">
                          <ion-radio :value="order.gid" label-placement="end" justify="start">
                            <div class="choice-label">
                              <span>{{ order.name }}</span>
                              <ion-note>{{ order.financialStatus || 'Payment status unavailable' }}<template v-if="order.fulfillmentStatus"> · {{ order.fulfillmentStatus }}</template></ion-note>
                            </div>
                          </ion-radio>
                        </ion-item>
                      </ion-radio-group>
                      <ion-note v-else-if="!orderLoading" color="medium"><p>No orders matched “{{ orderSearch.trim() }}”.</p></ion-note>
                      <ion-button fill="clear" @click="searchOrders(true)" :disabled="orderLoading" v-if="orderCursor">Load more orders</ion-button>
                    </template>

                  </div>
                </ion-accordion>
              </ion-accordion-group>
            </ion-card>

            <!-- What to return, once the order is loaded -->
            <ion-card v-if="targetReady && isMutation && selectedScenario !== 'pos.create-cash-order' && (orderDetailLoading || selectedOrderDetail)">
              <ion-card-header><ion-card-title>{{ selectedScenario === 'pos.exchange-cash-order' ? 'Exchange details' : 'Return details' }}</ion-card-title><ion-card-subtitle>What comes back, and how.</ion-card-subtitle></ion-card-header>
              <ion-card-content>
                <template v-if="orderDetailLoading">
                  <ion-list>
                    <ion-item v-for="row in 2" :key="row" lines="full">
                      <ion-label>
                        <ion-skeleton-text :animated="true" style="width: 55%" />
                        <p><ion-skeleton-text :animated="true" style="width: 35%" /></p>
                      </ion-label>
                    </ion-item>
                  </ion-list>
                </template>
                <template v-else-if="selectedOrderDetail">
                  <ion-note :color="sourceIsCash ? 'success' : 'danger'"><p>{{ sourceIsCash ? 'The source order is cash-only.' : 'This source is not verified as a cash-only order; the workflow will remain blocked.' }}</p></ion-note>
                  <p v-if="!eligibleLines.length">This order has no refundable lines available for this workflow.</p>
                  <ion-radio-group v-else v-model="lineGid">
                    <ion-item v-for="line in eligibleLines" :key="line.gid">
                      <ion-radio :value="line.gid" label-placement="end" justify="start">
                        <div class="choice-label">
                          <span>{{ line.productTitle || 'Unnamed product' }}</span>
                          <ion-note>{{ line.variantTitle || 'Default variant' }}<template v-if="line.sku"> · SKU {{ line.sku }}</template></ion-note>
                          <ion-note>Purchased {{ line.quantity }} · refundable {{ line.refundableQuantity }}<template v-if="line.unitPrice"> · {{ line.unitPrice.amount }} {{ line.unitPrice.currency }}</template></ion-note>
                        </div>
                      </ion-radio>
                    </ion-item>
                  </ion-radio-group>
                  <ion-item><ion-label position="stacked">Return quantity</ion-label><ion-input v-model="returnQuantity" type="number" min="1" aria-label="Return quantity" /></ion-item>
                  <ion-item><ion-checkbox v-model="restock">Restock returned item</ion-checkbox></ion-item>
                </template>

                <template v-if="selectedScenario === 'pos.exchange-cash-order'">
                  <p>Choose the replacement product.</p>
                  <ion-button fill="outline" @click="openReplacementModal" :disabled="!targetReady">
                    <ion-icon slot="start" :icon="searchOutline" />
                    Choose replacement product
                  </ion-button>
                  <ion-note v-if="selectedReplacementVariant" color="success"><p>Replacement: {{ variantLabel(selectedReplacementVariant) }}</p></ion-note>
                  <ion-item><ion-label position="stacked">Replacement quantity</ion-label><ion-input v-model="replacementQuantity" type="number" min="1" aria-label="Replacement quantity" /></ion-item>
                  <ion-item><ion-label position="stacked">Expected balance direction</ion-label><ion-select v-model="direction" aria-label="Exchange direction"><ion-select-option value="collect">Collect difference</ion-select-option><ion-select-option value="even">Even exchange</ion-select-option><ion-select-option value="refund">Refund difference</ion-select-option></ion-select></ion-item>
                  <ion-item><ion-label position="stacked">Maximum absolute difference</ion-label><ion-input v-model="maximumDifference" inputmode="decimal" aria-label="Maximum exchange difference" /><ion-note slot="end">{{ currency }}</ion-note></ion-item>
                </template>
              </ion-card-content>
            </ion-card>

            <!-- Planning-only cart details -->
            <ion-card v-if="targetReady && selectedScenario === 'pos.create-cash-order'">
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>Order details</ion-card-title>
                    <ion-card-subtitle>Only the order note is written onto the test order today.</ion-card-subtitle>
                  </div>
                </div>
              </ion-card-header>
              <ion-card-content>
                <ion-item>
                  <ion-select v-model="cart.planning.deliveryMethod" label="Delivery method" label-placement="stacked" interface="popover" placeholder="In store" :disabled="true">
                    <ion-select-option value="">Not specified</ion-select-option>
                    <ion-select-option v-for="method in deliveryMethods" :key="method" :value="method">{{ method }}</ion-select-option>
                  </ion-select>
                </ion-item>

                <ion-item>
                  <ion-input v-model="discountDraft" label="Discount code" label-placement="stacked" :disabled="true" />
                  <ion-button slot="end" fill="clear" :disabled="true">Add</ion-button>
                </ion-item>
                <div class="chip-row" v-if="cart.planning.discountCodes.length">
                  <ion-chip v-for="code in cart.planning.discountCodes" :key="code" @click="cart.removeCode('discountCodes', code)">
                    <ion-label>{{ code }}</ion-label>
                    <ion-icon :icon="closeCircleOutline" />
                  </ion-chip>
                </div>

                <ion-item>
                  <ion-input v-model="giftCardDraft" label="Gift card code" label-placement="stacked" :disabled="true" />
                  <ion-button slot="end" fill="clear" :disabled="true">Add</ion-button>
                </ion-item>
                <div class="chip-row" v-if="cart.planning.giftCardCodes.length">
                  <ion-chip v-for="code in cart.planning.giftCardCodes" :key="code" @click="cart.removeCode('giftCardCodes', code)">
                    <ion-label>{{ code }}</ion-label>
                    <ion-icon :icon="closeCircleOutline" />
                  </ion-chip>
                </div>

                <ion-item lines="none">
                  <ion-label class="ion-text-wrap">
                    Customer
                    <p v-if="cart.planning.customer">{{ customerLabel(cart.planning.customer) }}<span v-if="cart.planning.customer.mode === 'new'"> · to be created during the run</span></p>
                    <p v-else>Not specified</p>
                  </ion-label>
                  <ion-button slot="end" fill="outline" @click="openCustomerModal" :disabled="!targetReady">{{ cart.planning.customer ? 'Change' : 'Add customer' }}</ion-button>
                  <ion-button slot="end" fill="clear" color="medium" v-if="cart.planning.customer" @click="cart.clearCustomer()">Remove</ion-button>
                </ion-item>

                <ion-item lines="none" class="executed-field">
                  <ion-textarea v-model="cart.note" label="Order note" label-placement="stacked" aria-label="Order note" placeholder="Written onto the test order" auto-grow :maxlength="200" />
                </ion-item>
              </ion-card-content>
            </ion-card>

          </ion-col>

          <!-- Right column: the cart being built -->
          <ion-col size="12" size-lg="5">
            <div class="cart-rail">
              <ion-card class="cart-card">
                <ion-card-header>
                  <div class="card-heading">
                    <div>
                      <ion-card-title>Cart preview</ion-card-title>
                      <ion-card-subtitle>{{ cartSubtitle }}</ion-card-subtitle>
                    </div>
                    <ion-badge :color="cart.isEmpty ? 'medium' : 'primary'">{{ cart.itemCount }} item{{ cart.itemCount === 1 ? '' : 's' }}</ion-badge>
                  </div>
                </ion-card-header>
                <ion-card-content>
                  <template v-if="selectedScenario === 'pos.create-cash-order'">
                    <p v-if="cart.isEmpty" class="cart-empty">Nothing in the cart yet. Add products from the left.</p>
                    <ion-list v-else lines="full">
                      <ion-item v-for="line in cart.lines" :key="line.variantGid">
                        <ion-label class="ion-text-wrap">
                          {{ line.productTitle }}
                          <p>{{ line.variantTitle }}<span v-if="line.sku"> · SKU {{ line.sku }}</span></p>
                          <p>{{ line.unitPrice ? `${line.unitPrice} ${cart.currency}` : 'Price unavailable' }} each</p>
                          <p>{{ describeVariantSelection(line.variantSelection, line.productVariantCount) }}</p>
                          <p v-if="overstocked(line)" class="cart-line-warn">Only {{ line.availableAtLocation }} available at {{ selectedLocationName || 'this location' }}</p>
                        </ion-label>
                        <div slot="end" class="qty-control">
                          <ion-button fill="clear" size="small" @click="cart.setQuantity(line.variantGid, line.quantity - 1)" :disabled="line.quantity <= 1" :aria-label="`Decrease ${line.productTitle}`">
                            <ion-icon slot="icon-only" :icon="removeOutline" />
                          </ion-button>
                          <span class="qty-value">{{ line.quantity }}</span>
                          <ion-button fill="clear" size="small" @click="cart.setQuantity(line.variantGid, line.quantity + 1)" :aria-label="`Increase ${line.productTitle}`">
                            <ion-icon slot="icon-only" :icon="addOutline" />
                          </ion-button>
                          <ion-button fill="clear" size="small" color="medium" @click="cart.removeLine(line.variantGid)" :aria-label="`Remove ${line.productTitle}`">
                            <ion-icon slot="icon-only" :icon="trashOutline" />
                          </ion-button>
                        </div>
                      </ion-item>
                    </ion-list>

                    <div class="cart-totals" v-if="!cart.isEmpty">
                      <div><span>Subtotal</span><span>{{ cart.subtotal ? `${cart.subtotal} ${cart.currency}` : 'Unknown' }}</span></div>
                      <div><span>Tender</span><span>Cash</span></div>
                    </div>
                    <ion-note v-if="cart.unplannedSelectionLines.length" color="medium"><p>{{ cart.unplannedSelectionLines.length === 1 ? 'One line has' : `${cart.unplannedSelectionLines.length} lines have` }} an unknown variant layout. The run will watch whether POS adds the product directly or opens its variant picker, and report which.</p></ion-note>

                    <div class="cart-planning" v-if="cart.planningOnlyInUse.length">
                      <div class="cart-planning-head">
                        <ion-note>Described, not executed</ion-note>
                        <ion-badge color="medium">Planning only</ion-badge>
                      </div>
                      <div v-if="cart.planning.deliveryMethod" class="cart-planning-row"><span>Delivery</span><span>{{ cart.planning.deliveryMethod }}</span></div>
                      <div v-if="cart.planning.discountCodes.length" class="cart-planning-row"><span>Discounts</span><span>{{ cart.planning.discountCodes.join(', ') }}</span></div>
                      <div v-if="cart.planning.giftCardCodes.length" class="cart-planning-row"><span>Gift cards</span><span>{{ cart.planning.giftCardCodes.join(', ') }}</span></div>
                      <div v-if="cart.planning.customer" class="cart-planning-row"><span>Customer</span><span>{{ customerLabel(cart.planning.customer) }}</span></div>
                      <ion-note color="warning"><p>{{ cart.planningOnlyInUse.join(', ') }} {{ cart.planningOnlyInUse.length === 1 ? 'is' : 'are' }} not performed by the runner and {{ cart.planningOnlyInUse.length === 1 ? 'is' : 'are' }} not frozen into the run.</p></ion-note>
                    </div>
                  </template>

                  <template v-else-if="isMutation">
                    <div class="cart-loading" v-if="orderDetailLoading">
                      <ion-spinner name="dots" />
                      <span>Loading {{ selectedOrder?.name || 'the selected order' }}…</span>
                    </div>
                    <p class="cart-empty" v-else-if="!selectedOrderDetail">Choose a source order on the left to preview this run.</p>
                    <template v-else>
                      <p>{{ selectedOrderDetail.name }}</p>
                      <div class="cart-totals">
                        <div><span>Returning</span><span>{{ selectedLine ? `${selectedLine.productTitle || 'Selected item'} × ${returnQuantity}` : 'Choose an item' }}</span></div>
                        <div><span>Restock</span><span>{{ restock ? 'Yes' : 'No' }}</span></div>
                        <div v-if="selectedScenario === 'pos.exchange-cash-order'"><span>Replacement</span><span>{{ selectedReplacementVariant ? `${selectedReplacementVariant.productTitle} × ${replacementQuantity}` : 'Choose a product' }}</span></div>
                        <div v-if="selectedScenario === 'pos.exchange-cash-order'"><span>Direction</span><span>{{ direction }}</span></div>
                        <div v-if="selectedScenario === 'pos.exchange-cash-order'"><span>Maximum allowed</span><span>{{ maximumDifference || 'unset' }} {{ currency }}</span></div>
                      </div>
                    </template>
                  </template>

                  <template v-else>
                    <p class="cart-empty">The read-only smoke test does not build a cart. It opens the first listed order and checks its detail reference.</p>
                  </template>

                  <template v-if="isMutation">
                    <ion-text color="danger" v-if="planError"><p>{{ planError }}</p></ion-text>
                    <ion-text color="warning" v-else-if="!targetReady"><p>The test environment is not ready. Resolve what the left column reports.</p></ion-text>
                    <ion-button expand="block" @click="runMutation" :disabled="starting || !canRunMutation">{{ starting ? 'Starting…' : canRunMutation ? 'Review and run' : 'Add a product to run' }}</ion-button>
                  </template>
                </ion-card-content>
              </ion-card>
            </div>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-content>

    <!-- Product search -->
    <ion-modal :is-open="productModal !== 'closed'" @didDismiss="closeProductModal">
      <ion-header>
        <ion-toolbar>
          <ion-title>{{ productModal === 'replacement' ? 'Choose a replacement product' : 'Add products' }}</ion-title>
          <ion-buttons slot="end"><ion-button @click="closeProductModal">Done</ion-button></ion-buttons>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar v-model="variantSearch" aria-label="Search products and variants" placeholder="Search products, variants, or SKU" :debounce="0" />
        </ion-toolbar>
      </ion-header>
      <ion-content class="ion-padding">
        <ion-note color="medium"><p>Search starts after two characters. Stock is read at {{ selectedLocationName || 'the expected POS location' }}.</p></ion-note>
        <ion-text color="medium" v-if="variantLoading"><p>Searching products…</p></ion-text>
        <ion-list v-if="variants.length">
          <ion-item v-for="variant in variants" :key="variant.gid">
            <ion-checkbox
              :checked="isVariantChecked(variant)"
              @ionChange="toggleVariant(variant, $event.detail.checked)"
              label-placement="end"
              justify="start"
            >
              <div class="variant-row">
                <span>{{ variant.productTitle || 'Unnamed product' }}</span>
                <span class="variant-sub">{{ variant.title }}<template v-if="variant.sku"> · SKU {{ variant.sku }}</template></span>
                <span class="variant-facts">
                  <span>{{ priceLabel(variant) }}</span>
                  <span v-if="wasPriceLabel(variant)" class="variant-was">{{ wasPriceLabel(variant) }}</span>
                  <span :class="['variant-stock', stockTone(variant)]">{{ stockLabel(variant) }}</span>
                  <span v-if="variant.totalInventory != null" class="variant-sub">{{ variant.totalInventory }} across all locations</span>
                  <span class="variant-sub">{{ variantLayoutLabel(variant) }}</span>
                </span>
                <span v-if="unsellableLabel(variant)" class="variant-warn">{{ unsellableLabel(variant) }}</span>
              </div>
            </ion-checkbox>
          </ion-item>
        </ion-list>
        <ion-note v-else-if="variantSearch.trim().length >= 2 && !variantLoading" color="medium"><p>No products matched “{{ variantSearch.trim() }}”. Try a different product name or SKU.</p></ion-note>
        <ion-button expand="block" fill="clear" @click="searchVariants(true)" :disabled="variantLoading" v-if="variantCursor">Load more products</ion-button>
      </ion-content>
      <ion-footer v-if="productModal === 'cart'">
        <ion-toolbar>
          <ion-title size="small">{{ cart.itemCount }} item{{ cart.itemCount === 1 ? '' : 's' }} in the cart</ion-title>
          <ion-buttons slot="end"><ion-button fill="solid" @click="closeProductModal">Done</ion-button></ion-buttons>
        </ion-toolbar>
      </ion-footer>
    </ion-modal>

    <!-- Customer: pick an existing one or describe a new one -->
    <ion-modal :is-open="customerModalOpen" @didDismiss="closeCustomerModal">
      <ion-header>
        <ion-toolbar>
          <ion-title>Customer</ion-title>
          <ion-buttons slot="end"><ion-button @click="closeCustomerModal">Close</ion-button></ion-buttons>
        </ion-toolbar>
        <ion-toolbar>
          <ion-segment v-model="customerTab">
            <ion-segment-button value="existing"><ion-label>Existing customer</ion-label></ion-segment-button>
            <ion-segment-button value="new"><ion-label>New customer</ion-label></ion-segment-button>
          </ion-segment>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <template v-if="customerTab === 'existing'">
          <ion-searchbar v-model="customerSearch" aria-label="Search customers" placeholder="Search name, email, or phone" :debounce="0" />
          <ion-item lines="none">
            <ion-note color="medium"><p>Search starts after two characters and reads the test store only.</p></ion-note>
          </ion-item>
          <ion-text color="medium" v-if="customerLoading"><p>Searching customers…</p></ion-text>
          <ion-radio-group v-if="customers.length" :value="cart.planning.customer?.gid" @ionChange="chooseCustomerById($event.detail.value)">
            <ion-item v-for="person in customers" :key="person.gid">
              <ion-radio :value="person.gid" label-placement="end" justify="start">
                <div class="choice-label">
                  <span>{{ person.displayName }}</span>
                  <ion-note>{{ [person.email, person.phone].filter(Boolean).join(' · ') || 'No contact details' }}</ion-note>
                  <ion-note v-if="person.orderCount !== null || person.location">{{ person.orderCount !== null ? `${person.orderCount} order(s)` : '' }}<template v-if="person.location"> · {{ person.location }}</template></ion-note>
                </div>
              </ion-radio>
            </ion-item>
          </ion-radio-group>
          <ion-note v-else-if="customerSearch.trim().length >= 2 && !customerLoading" color="medium"><p>No customers matched “{{ customerSearch.trim() }}”.</p></ion-note>
          <ion-button expand="block" fill="clear" @click="searchCustomers(true)" :disabled="customerLoading" v-if="customerCursor">Load more customers</ion-button>
        </template>

        <template v-else>
          <ion-list class="ion-padding-horizontal">
            <ion-item lines="none">
              <ion-note>These are the fields Shopify POS asks for when a cashier adds a customer at the till. Shopify needs at least one of them.</ion-note>
            </ion-item>
            <ion-input class="ion-margin-bottom" fill="outline" v-model="customerDraft.firstName" label="First name" label-placement="stacked" autocomplete="given-name" />
            <ion-input class="ion-margin-bottom" fill="outline" v-model="customerDraft.lastName" label="Last name" label-placement="stacked" autocomplete="family-name" />
            <ion-input class="ion-margin-bottom" fill="outline" v-model="customerDraft.email" label="Email" label-placement="stacked" type="email" autocomplete="email" />
            <ion-input class="ion-margin-bottom" fill="outline" v-model="customerDraft.phone" label="Phone" label-placement="stacked" type="tel" autocomplete="tel" />
            <ion-item lines="none"><ion-checkbox v-model="customerDraft.acceptsMarketing">Accepts marketing</ion-checkbox></ion-item>
            <ion-textarea class="ion-margin-bottom" fill="outline" v-model="customerDraft.note" label="Note" label-placement="stacked" auto-grow :maxlength="200" />
          </ion-list>
          <ion-note v-if="!customerDraftUsable" color="medium"><p>Enter a name, email, or phone before saving.</p></ion-note>
          <ion-button expand="block" class="ion-margin" @click="saveNewCustomer" :disabled="!customerDraftUsable">Save customer details</ion-button>
        </template>
      </ion-content>
    </ion-modal>

    <!-- Existing order as a template -->
    <ion-modal :is-open="templateModalOpen" @didDismiss="closeTemplateModal">
      <ion-header>
        <ion-toolbar>
          <ion-title>Use an existing order as a template</ion-title>
          <ion-buttons slot="end"><ion-button @click="closeTemplateModal">Close</ion-button></ion-buttons>
        </ion-toolbar>
        <ion-toolbar>
          <ion-searchbar v-model="orderSearch" aria-label="Search existing orders" placeholder="Search order number, customer, email, or status" :debounce="0" />
        </ion-toolbar>
      </ion-header>
      <ion-content>

        <!-- Recent POS orders, shown before any search so there is something to pick -->
        <template v-if="!isSearchingOrders">
          <ion-list-header><ion-label>Recent POS orders</ion-label></ion-list-header>
          <ion-text color="medium" v-if="posOrderLoading"><p>Reading recent POS orders…</p></ion-text>
          <ion-list v-else-if="posOrders.length">
            <ion-item v-for="order in posOrders" :key="order.gid" button detail="true" @click="useOrderAsTemplate(order)">
              <ion-label class="ion-text-wrap">
                {{ order.name }}<span v-if="order.total"> · {{ order.total.amount }} {{ order.total.currency }}</span>
                <p>{{ order.customerName || 'No customer' }}<span v-if="order.createdAt"> · {{ formatOrderDate(order.createdAt) }}</span></p>
                <p>{{ order.financialStatus || 'Payment status unavailable' }}<span v-if="order.fulfillmentStatus"> · {{ order.fulfillmentStatus }}</span></p>
                <p class="order-items">{{ itemPreview(order) }}</p>
              </ion-label>
            </ion-item>
          </ion-list>
          <ion-note v-else-if="!posOrderLoading" color="medium"><p>No POS orders were found in this store. Search above to copy any order.</p></ion-note>
          <ion-button expand="block" fill="clear" @click="loadPosOrders(true)" :disabled="posOrderLoading" v-if="posOrderCursor">Load more POS orders</ion-button>
        </template>

        <!-- Any order in the store, once the tester types -->
        <template v-else>
          <ion-list-header><ion-label>Search results</ion-label></ion-list-header>
          <ion-text color="medium" v-if="orderLoading"><p>Searching orders…</p></ion-text>
          <ion-list v-else-if="orders.length">
            <ion-item v-for="order in orders" :key="order.gid" button detail="true" @click="useOrderAsTemplate(order)">
              <ion-label class="ion-text-wrap">
                {{ order.name }}
                <p>{{ order.financialStatus || 'Payment status unavailable' }}<span v-if="order.fulfillmentStatus"> · {{ order.fulfillmentStatus }}</span></p>
              </ion-label>
            </ion-item>
          </ion-list>
          <ion-note v-else-if="!orderLoading" color="medium"><p>No orders matched “{{ orderSearch.trim() }}”.</p></ion-note>
          <ion-button expand="block" fill="clear" @click="searchOrders(true)" :disabled="orderLoading" v-if="orderCursor">Load more orders</ion-button>
        </template>
      </ion-content>
    </ion-modal>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { IonAccordion, IonAccordionGroup, IonBackButton, IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonCheckbox, IonChip, IonCol, IonContent, IonFooter, IonGrid, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonPage, IonRadio, IonRadioGroup, IonRow, IonSearchbar, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonSkeletonText, IonSpinner, IonText, IonTextarea, IonTitle, IonToolbar, onIonViewWillEnter } from '@ionic/vue';
import { addOutline, alertCircleOutline, closeCircleOutline, documentTextOutline, removeOutline, searchOutline, trashOutline } from 'ionicons/icons';
import { customerIsUsable, customerLabel, deliveryMethods, emptyCustomer, useCartStore, type CartLine, type PlannedCustomer } from '../stores/cart.ts';
import type { DeviceProfile, OmsCustomer, OmsPosOrder, OmsConnectionSummary, OmsLocation, OmsOrder, OmsShop, OmsShopifyOrderDetail, OmsVariant, TargetContext } from '../../shared/contracts.ts';
import { getHealth, getOmsConnections, listOmsPosOrders, searchOmsCustomers, getOmsShops, getOmsShopifyOrderDetail, getProfiles, listOmsLocations, searchOmsOrders, searchOmsVariants, startRun } from '../api.ts';
import { useTestEnvStore } from '../stores/test-env.ts';
import { instanceNameFromOrigin } from '../oms-origin.ts';
import { buildMutationParameters, buildTargetContext, type MutationScenarioId, type PosPlanInput } from '../pos-plan.ts';
import { describeVariantSelection, plannedVariantSelection } from '../../shared/variant-selection.ts';

type ScenarioId = 'pos.open-first-order' | MutationScenarioId;
type VariantTarget = 'create' | 'replacement';

const scenarios = [
  { id: 'pos.open-first-order', name: 'Open first order', description: 'Read-only Home → Orders → first listed order detail smoke.', effect: 'read-only' },
  { id: 'pos.create-cash-order', name: 'Create a cash order', description: 'Add selected variants in Shopify POS and complete a test-store cash order.', effect: 'create-order' },
  { id: 'pos.return-cash-order', name: 'Return an existing order', description: 'Return exact eligible lines from a cash test fixture with explicit restock choices.', effect: 'return' },
  { id: 'pos.exchange-cash-order', name: 'Exchange an existing order', description: 'Exercise equal, collect-difference or refund-difference cash exchange paths.', effect: 'exchange' },
] as const;

const router = useRouter();
const cart = useCartStore();
const testEnv = useTestEnvStore();

// 'closed' | 'cart' (add items to the cart) | 'replacement' (exchange target).
const productModal = ref<'closed' | 'cart' | 'replacement'>('closed');
const templateModalOpen = ref(false);
const templateSkipped = ref(0);
const discountDraft = ref(''); const giftCardDraft = ref('');
const customerModalOpen = ref(false);
const customerTab = ref<'existing' | 'new'>('existing');
const customerSearch = ref(''); const customers = ref<OmsCustomer[]>([]);
const customerCursor = ref<string | null>(null); const customerLoading = ref(false);
const customerDraft = ref<PlannedCustomer>(emptyCustomer());
let customerRequest = 0; let customerTimer: ReturnType<typeof setTimeout> | undefined;
const posOrders = ref<OmsPosOrder[]>([]); const posOrderCursor = ref<string | null>(null); const posOrderLoading = ref(false);
let posOrderRequest = 0;
const selectedScenario = ref<ScenarioId>('pos.open-first-order');
const profiles = ref<DeviceProfile[]>([]); const connections = ref<OmsConnectionSummary[]>([]); const shops = ref<OmsShop[]>([]); const locations = ref<OmsLocation[]>([]); const variants = ref<OmsVariant[]>([]); const orders = ref<OmsOrder[]>([]);
const selectedVariant = ref<OmsVariant>(); const selectedReplacementVariant = ref<OmsVariant>(); const selectedOrder = ref<OmsOrder>(); const selectedOrderDetail = ref<OmsShopifyOrderDetail>();
const profileId = ref(''); const connectionId = ref(''); const shopId = ref(''); const locationGid = ref('');
const savedEnvironment = computed(() => testEnv.savedEnvironment);
const variantGid = ref(''); const replacementVariantGid = ref(''); const quantity = ref('1'); const replacementQuantity = ref('1'); const orderGid = ref(''); const lineGid = ref(''); const returnQuantity = ref('1'); const restock = ref(true);
const maximumDifference = ref('20.00'); const currency = ref('USD'); const direction = ref<'collect' | 'even' | 'refund'>('collect'); const note = ref('');
const orderSearch = ref(''); const variantSearch = ref(''); const variantCursor = ref<string | null>(null); const orderCursor = ref<string | null>(null);
const environmentLoading = ref(false); const variantLoading = ref(false); const orderLoading = ref(false); const starting = ref(false); const error = ref('');
let variantRequest = 0; let orderRequest = 0; let variantTimer: ReturnType<typeof setTimeout> | undefined; let orderTimer: ReturnType<typeof setTimeout> | undefined;

const activeConnection = computed(() => connections.value.find(connection => connection.id === connectionId.value));
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));
const selectedProfile = computed(() => profiles.value.find(profile => profile.id === profileId.value));
const selectedLocationName = computed(() => locations.value.find(location => location.gid === locationGid.value)?.name ?? '');
const selectedScenarioName = computed(() => scenarios.find(scenario => scenario.id === selectedScenario.value)?.name ?? 'Selected workflow');
const isMutation = computed(() => selectedScenario.value !== 'pos.open-first-order');
const eligibleLines = computed(() => (selectedOrderDetail.value?.lines ?? []).filter(line => (line.refundableQuantity ?? 0) > 0));
const selectedLine = computed(() => eligibleLines.value.find(line => line.gid === lineGid.value));
const sourceIsCash = computed(() => selectedOrderDetail.value?.paymentGatewayNames.length === 1 && selectedOrderDetail.value.paymentGatewayNames[0]?.trim().toLowerCase() === 'cash');
// Display name only. The frozen run target still uses the OMS userId, which is
// what the reviewed test-store policy is matched against.
// Read-only: the Shopify API version comes from the OMS shop record, never
// from the operator, so a run cannot be frozen against a hand-typed version.
const apiVersion = computed(() => selectedShop.value?.apiVersion ?? '');

// The workflow choice comes first and collapses once made, so the page reads as
// one decision at a time rather than every form at once.
const workflowPanel = ref<string | undefined>('workflow');
function workflowPanelChanged(event: CustomEvent): void {
  // The inner radio group also emits ionChange, so only the accordion's own
  // event may move the panel.
  if ((event.target as HTMLElement | null)?.tagName !== 'ION-ACCORDION-GROUP') return;
  workflowPanel.value = (event.detail as { value?: string }).value ?? undefined;
}
// Order search and order-detail fetch used to share one flag, so a detail load
// looked like a list load. This one names the exact order being fetched.
const sourcePanel = ref<string | undefined>('source');
function sourcePanelChanged(event: CustomEvent): void {
  if ((event.target as HTMLElement | null)?.tagName !== 'ION-ACCORDION-GROUP') return;
  sourcePanel.value = (event.detail as { value?: string }).value ?? undefined;
}

const orderDetailLoadingGid = ref('');
const orderDetailLoading = computed(() => Boolean(orderDetailLoadingGid.value));

const selectedScenarioEffect = computed(() => scenarios.find(scenario => scenario.id === selectedScenario.value)?.effect ?? '');

const omsUser = computed(() => activeConnection.value?.username || activeConnection.value?.userId || 'not connected');

const targetReady = computed(() => Boolean(profiles.value.some(profile => profile.id === profileId.value) && activeConnection.value?.state === 'connected' && activeConnection.value.userId && selectedShop.value?.shopGid && selectedShop.value.shopDomain && locationGid.value && apiVersion.value));

// Everything below is chosen once in onboarding. This page only reports what is
// missing and links back; it never offers its own pickers.
const environmentIssues = computed(() => {
  const issues: string[] = [];
  if (!selectedProfile.value) issues.push('No iPad profile is saved on this Mac. Save one in iPad setup.');
  if (activeConnection.value?.state !== 'connected') { issues.push('No test OMS is signed in. Sign in on the OMS connections page.'); return issues; }
  const saved = savedEnvironment.value;
  if (!saved) { issues.push('No test store or POS location has been saved. Choose them on the OMS connections page.'); return issues; }
  if (saved.instanceName !== instanceNameFromOrigin(activeConnection.value.origin)) issues.push(`The saved environment belongs to ${saved.instanceName}, but this session is signed in to ${instanceNameFromOrigin(activeConnection.value.origin) || 'another OMS'}. Save the environment again for this OMS.`);
  else if (!selectedShop.value) issues.push('The saved test store is no longer available to this OMS session. Choose it again on the OMS connections page.');
  else if (!locationGid.value) issues.push('The saved POS location is no longer available for this store. Choose it again on the OMS connections page.');
  if (selectedShop.value && !apiVersion.value) issues.push('This OMS shop record has no Shopify API version, so a run cannot be frozen against it.');
  return issues;
});

function profileLabel(profile: DeviceProfile): string { return profile.name?.trim() || profile.id; }
function variantLabel(variant: OmsVariant): string { return `${variant.productTitle || 'Unnamed product'} · ${variant.title}${variant.sku ? ` · SKU ${variant.sku}` : ''}`; }
function friendlyPlanError(message: string): string {
  if (/create-order plan requires at least one/i.test(message)) return 'Add at least one product to the cart.';
  if (/create-order lines.*unique|Create-order lines must be unique/i.test(message)) return 'The cart has the same product twice; adjust its quantity instead.';
  if (/variant.*exact Shopify GID/i.test(message)) return 'Choose a product from the search results.';
  if (/source order.*exact Shopify GID|return plan.*exact Shopify order GID/i.test(message)) return 'Choose an existing order from the search results.';
  if (/source line.*exact Shopify GID|return lines.*exact Shopify order line GID/i.test(message)) return 'Choose a refundable item from the selected order.';
  if (/POS order reference/i.test(message)) return 'Choose an order from the search results so its POS reference can be frozen safely.';
  return message;
}

function planInput(): PosPlanInput {
  // A create-order run is frozen against the cart. Return and exchange keep
  // their own source-order inputs.
  const fromCart = selectedScenario.value === 'pos.create-cash-order';
  return {
    scenario: selectedScenario.value as MutationScenarioId,
    currency: fromCart ? cart.currency : currency.value,
    maximumDifference: maximumDifference.value,
    ...(fromCart ? { lines: cart.executableLines.map(line => ({ variantGid: line.variantGid, productGid: line.productGid, search: line.search, quantity: String(line.quantity), variantSelection: line.variantSelection })) } : {}),
    variantGid: variantGid.value, productGid: selectedVariant.value?.productGid ?? '', search: selectedVariant.value?.productTitle || '', quantity: quantity.value, orderGid: orderGid.value, orderReference: selectedOrderDetail.value?.name ?? '', lineGid: lineGid.value, returnQuantity: returnQuantity.value, restock: restock.value,
    replacementVariantGid: replacementVariantGid.value, replacementQuantity: replacementQuantity.value, direction: direction.value, note: fromCart ? cart.note : note.value,
    remaining: Object.fromEntries((selectedOrderDetail.value?.lines ?? []).map(line => [line.gid, line.refundableQuantity ?? -1])),
  };
}

const planError = computed(() => { if (!isMutation.value || orderDetailLoading.value) return ''; try { buildMutationParameters(planInput()); return ''; } catch (cause) { return friendlyPlanError(cause instanceof Error ? cause.message : 'Complete the test inputs.'); } });
const canRunMutation = computed(() => Boolean(targetReady.value && !planError.value));
const summary = computed(() => {
  if (selectedScenario.value === 'pos.create-cash-order') {
    if (cart.isEmpty) return 'Add at least one product to the cart.';
    const items = cart.lines.map(line => `${line.productTitle} × ${line.quantity}`).join(', ');
    return `${items}; tendered as cash in ${cart.currency}.`;
  }
  if (!selectedOrderDetail.value) return 'Choose a source order and eligible item before review.';
  const line = selectedLine.value ? `${selectedLine.value.productTitle || 'Selected item'}${selectedLine.value.variantTitle ? ` · ${selectedLine.value.variantTitle}` : ''}` : 'Choose an eligible item';
  if (selectedScenario.value === 'pos.return-cash-order') return `${selectedOrderDetail.value.name} · ${line} × ${returnQuantity.value}; tendered as cash in ${currency.value}.`;
  return `${selectedOrderDetail.value.name} · return ${line} × ${returnQuantity.value}; replace with ${selectedReplacementVariant.value ? variantLabel(selectedReplacementVariant.value) : 'choose a product'} × ${replacementQuantity.value}; ${direction.value}, maximum ${maximumDifference.value || 'unset'} ${currency.value}.`;
});

function clearShopData(): void {
  variantRequest++; orderRequest++; variants.value = []; orders.value = []; posOrders.value = []; locations.value = []; variantCursor.value = null; orderCursor.value = null; posOrderCursor.value = null; selectedVariant.value = undefined; selectedReplacementVariant.value = undefined; selectedOrder.value = undefined; selectedOrderDetail.value = undefined; locationGid.value = ''; variantGid.value = ''; replacementVariantGid.value = ''; orderGid.value = ''; lineGid.value = '';
}
function resolveConnectionId(): string {
  const connected = connections.value.filter(connection => connection.state === 'connected');
  const saved = savedEnvironment.value;
  const matching = saved ? connected.find(connection => instanceNameFromOrigin(connection.origin) === saved.instanceName) : undefined;
  return (matching ?? connected[0])?.id ?? '';
}

// Only the saved identifiers come from browser storage. The shop record itself
// is always re-read from the live OMS, so a stale local entry cannot become a
// run target.
async function loadEnvironment(): Promise<void> {
  if (!connectionId.value || environmentLoading.value) return;
  environmentLoading.value = true; error.value = '';
  try {
    shops.value = (await getOmsShops(connectionId.value)).shops;
    const saved = savedEnvironment.value;
    shopId.value = saved && shops.value.some(shop => shop.connectorShopId === saved.connectorShopId) ? saved.connectorShopId : '';
    clearShopData();
    if (!shopId.value || !saved) return;
    locations.value = (await listOmsLocations({ connectionId: connectionId.value, shopId: shopId.value })).items;
    locationGid.value = locations.value.some(location => location.gid === saved.locationGid) ? saved.locationGid : '';
    void loadPosOrders();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not read the saved test environment from the OMS.'; }
  finally { environmentLoading.value = false; }
}

function scenarioChanged(): void {
  workflowPanel.value = undefined;
  sourcePanel.value = 'source';
  error.value = '';
  variants.value = [];
  variantCursor.value = null;
  selectedVariant.value = undefined;
  selectedReplacementVariant.value = undefined;
  variantGid.value = '';
  replacementVariantGid.value = '';
  if (selectedScenario.value !== 'pos.create-cash-order' && !posOrders.value.length && connectionId.value && shopId.value) {
    void loadPosOrders();
  }
}
// In the cart modal a tick adds the item and an untick removes it. For the
// exchange replacement the planner still freezes exactly one variant, so that
// list stays single-select.
function isVariantChecked(variant: OmsVariant): boolean {
  return productModal.value === 'replacement' ? replacementVariantGid.value === variant.gid : cart.hasLine(variant.gid);
}

function toggleVariant(variant: OmsVariant, checked: boolean): void {
  if (productModal.value === 'replacement') {
    if (checked) { selectedReplacementVariant.value = variant; replacementVariantGid.value = variant.gid; }
    else { selectedReplacementVariant.value = undefined; replacementVariantGid.value = ''; }
    return;
  }
  if (checked) cart.addVariant(variant);
  else cart.removeLine(variant.gid);
}

function openProductModal(): void { productModal.value = 'cart'; variantSearch.value = ''; variants.value = []; variantCursor.value = null; }
function openReplacementModal(): void { productModal.value = 'replacement'; variantSearch.value = ''; variants.value = []; variantCursor.value = null; }
function closeProductModal(): void { productModal.value = 'closed'; }

function startNewTemplate(): void { cart.startNew(selectedShop.value?.currency || currency.value); templateSkipped.value = 0; }
const isSearchingOrders = computed(() => orderSearch.value.trim().length >= 2);
const fulfilledOrders = computed(() => {
  const fulfilled = posOrders.value.filter(order => {
    const status = order.fulfillmentStatus?.toUpperCase();
    return status === 'FULFILLED' || status === 'PARTIALLY_FULFILLED';
  });
  return fulfilled.length ? fulfilled : posOrders.value;
});

function openTemplateModal(): void {
  templateModalOpen.value = true;
  orderSearch.value = ''; orders.value = []; orderCursor.value = null;
  void loadPosOrders();
}

// Newest POS orders for the picker, so the modal is useful before the tester
// types anything.
async function loadPosOrders(append = false): Promise<void> {
  if (!connectionId.value || !shopId.value || posOrderLoading.value) return;
  const request = ++posOrderRequest; posOrderLoading.value = true; error.value = '';
  try {
    const result = await listOmsPosOrders({ connectionId: connectionId.value, shopId: shopId.value, cursor: append ? posOrderCursor.value ?? undefined : undefined });
    if (request !== posOrderRequest) return;
    posOrders.value = append ? [...posOrders.value, ...result.items] : result.items;
    posOrderCursor.value = result.nextCursor;
  } catch (cause) { if (request === posOrderRequest) error.value = cause instanceof Error ? cause.message : 'Recent POS orders could not be read.'; }
  finally { if (request === posOrderRequest) posOrderLoading.value = false; }
}

function formatOrderDate(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unknown date';
}

// The reviewed document caps the preview, so an order with more lines says so
// rather than presenting a short list as the whole order.
function itemPreview(order: OmsPosOrder): string {
  if (!order.items.length) return 'No item detail available';
  const shown = order.items.map(item => `${item.quantity} × ${item.title}`).join(', ');
  return order.hasMoreItems ? `${shown}, and more` : shown;
}
function closeTemplateModal(): void { templateModalOpen.value = false; }

// Copies a real order into a fresh cart so the tester can adjust it. The source
// order itself is only read.
async function useOrderAsTemplate(order: { gid: string }): Promise<void> {
  if (!connectionId.value || !shopId.value) return;
  orderLoading.value = true; error.value = '';
  try {
    const result = await getOmsShopifyOrderDetail({ connectionId: connectionId.value, shopId: shopId.value, gid: order.gid });
    cart.startFromOrder(result.order, selectedShop.value?.currency || currency.value);
    templateSkipped.value = cart.skippedFromOrder(result.order);
    templateModalOpen.value = false;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'That order could not be copied.'; }
  finally { orderLoading.value = false; }
}

const customerDraftUsable = computed(() => customerIsUsable({ ...customerDraft.value, mode: 'new' }));

function openCustomerModal(): void {
  customerModalOpen.value = true;
  const current = cart.planning.customer;
  customerTab.value = current?.mode === 'new' ? 'new' : 'existing';
  customerDraft.value = current && current.mode === 'new' ? { ...current } : emptyCustomer();
  customerSearch.value = ''; customers.value = []; customerCursor.value = null;
}
function closeCustomerModal(): void { customerModalOpen.value = false; }

function chooseExistingCustomer(person: OmsCustomer): void {
  cart.setExistingCustomer(person);
  customerModalOpen.value = false;
}

function saveNewCustomer(): void {
  if (!customerDraftUsable.value) return;
  cart.setNewCustomer(customerDraft.value);
  customerModalOpen.value = false;
}

async function searchCustomers(append = false): Promise<void> {
  if (!connectionId.value || !shopId.value) return;
  const search = customerSearch.value.trim();
  if (search.length < 2) { customerRequest++; customerLoading.value = false; customers.value = []; customerCursor.value = null; return; }
  const request = ++customerRequest; customerLoading.value = true; error.value = '';
  try {
    const result = await searchOmsCustomers({ connectionId: connectionId.value, shopId: shopId.value, search, cursor: append ? customerCursor.value ?? undefined : undefined });
    if (request !== customerRequest) return;
    customers.value = append ? [...customers.value, ...result.items] : result.items;
    customerCursor.value = result.nextCursor;
  } catch (cause) { if (request === customerRequest) error.value = cause instanceof Error ? cause.message : 'Customer search failed.'; }
  finally { if (request === customerRequest) customerLoading.value = false; }
}

function commitCode(kind: 'discountCodes' | 'giftCardCodes'): void {
  const draft = kind === 'discountCodes' ? discountDraft : giftCardDraft;
  cart.addCode(kind, draft.value);
  draft.value = '';
}

function overstocked(line: CartLine): boolean {
  return line.inventoryTracked !== false && line.availableAtLocation !== null && line.quantity > line.availableAtLocation;
}

const cartSubtitle = computed(() => {
  if (selectedScenario.value !== 'pos.create-cash-order') return 'What this run will do.';
  return cart.origin === 'order' && cart.sourceOrderReference ? `Copied from ${cart.sourceOrderReference}` : 'New test order';
});

const shopCurrency = computed(() => selectedShop.value?.currency || currency.value);

function priceLabel(variant: OmsVariant): string {
  return variant.price ? `${variant.price} ${shopCurrency.value}` : 'Price unavailable';
}

function wasPriceLabel(variant: OmsVariant): string {
  const was = Number(variant.compareAtPrice);
  const now = Number(variant.price);
  return Number.isFinite(was) && Number.isFinite(now) && was > now ? `was ${variant.compareAtPrice}` : '';
}

// An untracked item and an item with no stock record at this location are both
// reported as such, never as a zero the operator might read as a real count.
function stockLabel(variant: OmsVariant): string {
  const where = selectedLocationName.value || 'the expected location';
  if (variant.inventoryTracked === false) return 'Stock not tracked';
  if (variant.availableAtLocation === null) return `No stock record at ${where}`;
  return `${variant.availableAtLocation} available at ${where}`;
}

// How POS will add this product, decided from Shopify's variant facts so the
// run knows whether to expect the product tap to add or to open the picker.
function variantLayoutLabel(variant: OmsVariant): string {
  const selection = plannedVariantSelection(variant);
  if (selection === 'single') return 'Single variant';
  if (selection === 'multi') return variant.productVariantCount !== null ? `${variant.productVariantCount} variants` : 'Multiple variants';
  return 'Variant layout unknown';
}

function stockTone(variant: OmsVariant): string {
  if (variant.inventoryTracked === false) return 'is-muted';
  if (variant.availableAtLocation === null) return 'is-warning';
  return variant.availableAtLocation > 0 ? 'is-ready' : 'is-warning';
}

function unsellableLabel(variant: OmsVariant): string {
  if (variant.availableForSale === false) return 'Not available for sale in Shopify';
  if (variant.productStatus && variant.productStatus.toUpperCase() !== 'ACTIVE') return `Product is ${variant.productStatus.toLowerCase()}`;
  return '';
}

function selectVariant(variant: OmsVariant, target: VariantTarget): void { if (target === 'replacement') { selectedReplacementVariant.value = variant; replacementVariantGid.value = variant.gid; } else { selectedVariant.value = variant; variantGid.value = variant.gid; } }
function selectLine(line: OmsShopifyOrderDetail['lines'][number]): void { lineGid.value = line.gid; }
function chooseCustomerById(gid: string): void { const match = customers.value.find(c => c.gid === gid); if (match) chooseExistingCustomer(match); }
async function selectOrderById(gid: string): Promise<void> { const match = fulfilledOrders.value.find(o => o.gid === gid) ?? orders.value.find(o => o.gid === gid); if (match) await selectOrder(match); }

async function searchVariants(append = false): Promise<void> {
  if (!connectionId.value || !shopId.value) return;
  const search = variantSearch.value.trim();
  if (search.length < 2) { variantRequest++; variantLoading.value = false; variants.value = []; variantCursor.value = null; return; }
  const request = ++variantRequest; variantLoading.value = true; error.value = '';
  try {
    const result = await searchOmsVariants({ connectionId: connectionId.value, shopId: shopId.value, search, cursor: append ? variantCursor.value ?? undefined : undefined, locationGid: locationGid.value || undefined });
    if (request !== variantRequest) return;
    variants.value = append ? [...variants.value, ...result.items] : result.items; variantCursor.value = result.nextCursor;
    if (!append) { selectedVariant.value = undefined; selectedReplacementVariant.value = undefined; variantGid.value = ''; replacementVariantGid.value = ''; }
  } catch (cause) { if (request === variantRequest) error.value = cause instanceof Error ? cause.message : 'Product search failed.'; }
  finally { if (request === variantRequest) variantLoading.value = false; }
}

async function searchOrders(append = false): Promise<void> {
  if (!connectionId.value || !shopId.value) return;
  const search = orderSearch.value.trim();
  if (search.length < 2) { orderRequest++; orderLoading.value = false; orders.value = []; orderCursor.value = null; return; }
  const request = ++orderRequest; orderLoading.value = true; error.value = '';
  try {
    const result = await searchOmsOrders({ connectionId: connectionId.value, shopId: shopId.value, search, cursor: append ? orderCursor.value ?? undefined : undefined });
    if (request !== orderRequest) return;
    orders.value = append ? [...orders.value, ...result.items] : result.items; orderCursor.value = result.nextCursor;
    if (!append) { selectedOrder.value = undefined; selectedOrderDetail.value = undefined; lineGid.value = ''; orderGid.value = ''; }
  } catch (cause) { if (request === orderRequest) error.value = cause instanceof Error ? cause.message : 'Order search failed.'; }
  finally { if (request === orderRequest) orderLoading.value = false; }
}

async function selectOrder(order: OmsOrder): Promise<void> { selectedOrder.value = order; orderGid.value = order.gid; selectedOrderDetail.value = undefined; lineGid.value = ''; sourcePanel.value = undefined; await loadOrderDetail(); }
async function loadOrderDetail(): Promise<void> {
  if (!connectionId.value || !shopId.value || !selectedOrder.value) return;
  const request = ++orderRequest; orderDetailLoadingGid.value = selectedOrder.value.gid; error.value = '';
  try { const result = await getOmsShopifyOrderDetail({ connectionId: connectionId.value, shopId: shopId.value, gid: selectedOrder.value.gid }); if (request !== orderRequest) return; selectedOrderDetail.value = result.order; lineGid.value = eligibleLines.value[0]?.gid ?? ''; }
  catch (cause) { if (request === orderRequest) error.value = cause instanceof Error ? cause.message : 'Order detail failed.'; }
  finally { if (request === orderRequest) orderDetailLoadingGid.value = ''; }
}

function targetContext(): TargetContext {
  if (!activeConnection.value?.userId || !selectedShop.value?.shopGid || !selectedShop.value.shopDomain) throw new Error('The OMS connection and shop must be selected before a run can be frozen.');
  return buildTargetContext({ connectionId: connectionId.value, omsOrigin: activeConnection.value.origin, userId: activeConnection.value.userId, connectorShopId: shopId.value, shopGid: selectedShop.value.shopGid, shopDomain: selectedShop.value.shopDomain, locationGid: locationGid.value, apiVersion: apiVersion.value });
}

async function runMutation(): Promise<void> {
  if (!canRunMutation.value || starting.value) return;
  starting.value = true; error.value = '';
  try { const health = await getHealth(); const parameters = buildMutationParameters(planInput()); const accepted = await startRun({ scriptId: selectedScenario.value as MutationScenarioId, deviceProfileId: profileId.value, parameters: parameters as unknown as Record<string, unknown>, assertionMode: 'pos-shopify-oms', expectedRevision: health.revision, context: targetContext() }); await router.push(`/runs/${accepted.id}`); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'The POS run could not be started.'; }
  finally { starting.value = false; }
}

function scheduleVariantSearch(): void { if (variantTimer) clearTimeout(variantTimer); variantTimer = setTimeout(() => { void searchVariants(); }, 300); }
function scheduleOrderSearch(): void { if (orderTimer) clearTimeout(orderTimer); orderTimer = setTimeout(() => { void searchOrders(); }, 300); }
watch(customerSearch, () => { if (customerTimer) clearTimeout(customerTimer); customerTimer = setTimeout(() => { void searchCustomers(); }, 300); });
watch([variantSearch, connectionId, shopId], () => { if (isMutation.value) scheduleVariantSearch(); });
watch([orderSearch, connectionId, shopId], () => { if (isMutation.value && selectedScenario.value !== 'pos.create-cash-order') scheduleOrderSearch(); });
onBeforeUnmount(() => { if (variantTimer) clearTimeout(variantTimer); if (orderTimer) clearTimeout(orderTimer); if (customerTimer) clearTimeout(customerTimer); });

onMounted(async () => {
  try {
    const savedProfiles = await getProfiles();
    profiles.value = savedProfiles.profiles;
    const remembered = localStorage.getItem('iosTesting.profileId') ?? '';
    profileId.value = profiles.value.some(profile => profile.id === remembered) ? remembered : profiles.value[0]?.id ?? '';
    connections.value = (await getOmsConnections()).connections;
    testEnv.loadSavedEnvironment();
    connectionId.value = resolveConnectionId();
    await loadEnvironment();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load Shopify POS planning data.'; }
});

onIonViewWillEnter(async () => {
  testEnv.loadSavedEnvironment();
  const saved = savedEnvironment.value;
  if (!saved) return;
  const resolvedId = resolveConnectionId();
  if (resolvedId !== connectionId.value || saved.connectorShopId !== shopId.value || saved.locationGid !== locationGid.value || locations.value.length === 0) {
    connectionId.value = resolvedId;
    await loadEnvironment();
  }
});

watch(() => testEnv.savedEnvironment, async (newSaved) => {
  if (newSaved) {
    connectionId.value = resolveConnectionId();
    await loadEnvironment();
  } else {
    shopId.value = '';
    locationGid.value = '';
    clearShopData();
  }
});
</script>

<style scoped>.lede { font-size: 1.08rem; max-width: 860px; }
.cart-rail { position: sticky; top: 1rem; }
.cart-card { margin-inline: 0; }
.cart-empty { color: var(--ion-color-medium-shade); }
.cart-line-warn { color: var(--ion-color-danger-shade); }
.qty-control { display: flex; align-items: center; gap: .1rem; }
.qty-value { min-width: 1.5rem; text-align: center; font-variant-numeric: tabular-nums; }
.cart-totals { display: flex; flex-direction: column; gap: .3rem; margin-top: 1rem; padding-top: .75rem; border-top: 1px solid var(--ion-color-step-150, var(--ion-background-color-step-150, #e0e0e0)); }
.cart-totals > div { display: flex; justify-content: space-between; gap: 1rem; }
.cart-planning { margin-top: 1rem; padding-top: .75rem; border-top: 1px solid var(--ion-color-step-150, var(--ion-background-color-step-150, #e0e0e0)); }
.cart-planning-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.cart-planning-row { display: flex; justify-content: space-between; gap: 1rem; margin-top: .3rem; font-size: .9rem; }
.cart-planning-row > span:first-child { color: var(--ion-color-medium-shade); }
.order-items { color: var(--ion-color-medium-shade); }.executed-field { margin-top: .5rem; }
.chip-row { display: flex; flex-wrap: wrap; gap: .25rem; margin: .35rem 0 .5rem; }
@media (max-width: 991px) { .cart-rail { position: static; } }
.variant-row { display: flex; flex-direction: column; gap: .15rem; white-space: normal; }
.variant-sub { color: var(--ion-color-medium-shade); font-size: .85rem; }
.variant-facts { display: flex; flex-wrap: wrap; gap: .1rem .75rem; font-size: .85rem; margin-top: .1rem; }
.variant-was { color: var(--ion-color-medium-shade); text-decoration: line-through; }
.variant-stock.is-ready { color: var(--ion-color-success-shade); }
.variant-stock.is-warning { color: var(--ion-color-warning-shade); }
.variant-stock.is-muted { color: var(--ion-color-medium-shade); }
.variant-warn { color: var(--ion-color-danger-shade); font-size: .85rem; }
.setup-warning { margin-bottom: 1rem; }
.cart-loading { display: flex; align-items: center; gap: .6rem; }
.workflow-card ion-accordion-group, .workflow-card ion-accordion { background: transparent; }
.workflow-card ion-item { --background: transparent; }
</style>
