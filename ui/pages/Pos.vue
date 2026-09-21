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

                  <!-- POS hides "Return or exchange" entirely for an order with
                       nothing shipped, so the operator is told here instead of
                       discovering a dead end on the iPad. -->
                  <ion-item v-if="orderHasNoFulfilledLines" color="danger" lines="none" class="setup-warning">
                    <ion-icon slot="start" :icon="alertCircleOutline" />
                    <ion-label class="ion-text-wrap">Nothing on {{ selectedOrderDetail.name }} has been fulfilled, so Shopify POS will not offer “Return or exchange” for it. Choose an order with at least one fulfilled line.</ion-label>
                  </ion-item>

                  <p v-if="!returnCandidates.length">This order has no refundable lines available for this workflow.</p>
                  <div v-else class="return-lines">
                    <div v-for="candidate in returnCandidates" :key="candidate.line.gid" class="return-line">
                      <ion-item lines="none">
                        <ion-checkbox
                          :checked="returnLineDrafts[candidate.line.gid]?.selected === true"
                          :disabled="candidate.fulfilled === 0"
                          @ionChange="toggleReturnLine(candidate.line.gid, $event.detail.checked)"
                          label-placement="end"
                          justify="start"
                          :aria-label="`Return ${candidate.line.productTitle || 'this item'}`"
                        >
                          <div class="choice-label">
                            <span>{{ candidate.line.productTitle || 'Unnamed product' }}</span>
                            <ion-note>{{ candidate.line.variantTitle || 'Default variant' }}<template v-if="candidate.line.sku"> · SKU {{ candidate.line.sku }}</template></ion-note>
                            <ion-note>Purchased {{ candidate.line.quantity }} · refundable {{ candidate.refundable }} · fulfilled {{ candidate.fulfilled }}<template v-if="candidate.line.unitPrice"> · {{ candidate.line.unitPrice.amount }} {{ candidate.line.unitPrice.currency }}</template></ion-note>
                            <ion-note v-if="candidate.fulfilled === 0" color="danger">Not fulfilled, so Shopify POS cannot return it on the device.</ion-note>
                          </div>
                        </ion-checkbox>
                      </ion-item>

                      <!-- POS asks for restock, reason and note once per line,
                           so the selected line carries its own controls. -->
                      <div v-if="returnLineDrafts[candidate.line.gid]?.selected" class="return-line-controls">
                        <ion-item>
                          <ion-input v-model="returnLineDrafts[candidate.line.gid].quantity" type="number" min="1" :max="candidate.refundable" label="Return quantity" label-placement="stacked" :aria-label="`Return quantity for ${candidate.line.productTitle || 'this item'}`" />
                        </ion-item>
                        <ion-item>
                          <ion-toggle v-model="returnLineDrafts[candidate.line.gid].restock" :aria-label="`Restock ${candidate.line.productTitle || 'this item'}`">Restock this item</ion-toggle>
                        </ion-item>
                        <ion-item>
                          <ion-select v-model="returnLineDrafts[candidate.line.gid].reason" label="Return reason" label-placement="stacked" interface="popover" :aria-label="`Return reason for ${candidate.line.productTitle || 'this item'}`">
                            <ion-select-option v-for="reason in returnReasons" :key="reason" :value="reason">{{ describeReturnReason(reason) }}</ion-select-option>
                          </ion-select>
                        </ion-item>
                        <ion-item>
                          <ion-input v-model="returnLineDrafts[candidate.line.gid].note" label="Note (optional)" label-placement="stacked" :maxlength="200" :aria-label="`Return note for ${candidate.line.productTitle || 'this item'}`" />
                        </ion-item>
                      </div>
                    </div>
                  </div>

                  <ion-item lines="none">
                    <ion-label class="ion-text-wrap">
                      Currency
                      <p>{{ sourceCurrency || 'This order reports no total, so no currency can be frozen with the run.' }}</p>
                    </ion-label>
                    <ion-note slot="end">Read from the source order</ion-note>
                  </ion-item>
                </template>

                <template v-if="isExchangeScenario && selectedOrderDetail">
                  <ion-list-header><ion-label>Replacement items</ion-label></ion-list-header>
                  <ion-button fill="outline" @click="openReplacementModal" :disabled="!targetReady">
                    <ion-icon slot="start" :icon="searchOutline" />
                    Add replacement products
                  </ion-button>
                  <p v-if="!replacementLines.length" class="cart-empty">No replacement chosen yet. An exchange needs at least one.</p>
                  <ion-list v-else lines="full">
                    <ion-item v-for="line in replacementLines" :key="line.variantGid">
                      <ion-label class="ion-text-wrap">
                        {{ line.productTitle }}
                        <p>{{ line.variantTitle }}<span v-if="line.sku"> · SKU {{ line.sku }}</span></p>
                        <p>{{ line.unitPrice ? `${line.unitPrice} ${sourceCurrency}` : 'Price unavailable' }} each</p>
                        <p>{{ describeVariantSelection(line.variantSelection, line.productVariantCount) }}</p>
                      </ion-label>
                      <div slot="end" class="qty-control">
                        <ion-button fill="clear" size="small" @click="setReplacementQuantity(line.variantGid, line.quantity - 1)" :disabled="line.quantity <= 1" :aria-label="`Decrease ${line.productTitle}`">
                          <ion-icon slot="icon-only" :icon="removeOutline" />
                        </ion-button>
                        <span class="qty-value">{{ line.quantity }}</span>
                        <ion-button fill="clear" size="small" @click="setReplacementQuantity(line.variantGid, line.quantity + 1)" :aria-label="`Increase ${line.productTitle}`">
                          <ion-icon slot="icon-only" :icon="addOutline" />
                        </ion-button>
                        <ion-button fill="clear" size="small" color="medium" @click="removeReplacement(line.variantGid)" :aria-label="`Remove ${line.productTitle}`">
                          <ion-icon slot="icon-only" :icon="trashOutline" />
                        </ion-button>
                      </div>
                    </ion-item>
                  </ion-list>

                  <ion-list-header><ion-label>Customer on the exchanged order</ion-label></ion-list-header>
                  <ion-note color="medium"><p>{{ selectedOrderDetail.customer ? `The source order belongs to ${orderCustomerLabel(selectedOrderDetail.customer)}.` : 'The source order has no customer.' }}</p></ion-note>
                  <ion-segment v-model="customerAction" aria-label="Exchange customer action">
                    <ion-segment-button value="keep"><ion-label>Keep</ion-label></ion-segment-button>
                    <ion-segment-button value="remove"><ion-label>Remove</ion-label></ion-segment-button>
                    <ion-segment-button value="replace"><ion-label>Replace</ion-label></ion-segment-button>
                  </ion-segment>
                  <ion-item v-if="customerAction === 'replace'">
                    <!-- The hyphen is escaped because a `pattern` attribute is
                         compiled with the `v` flag, where a bare `-` inside a
                         character class is a syntax error and the whole
                         pattern is then dropped. -->
                    <ion-input v-model="exchangeCustomerGid" label="Replacement customer GID" label-placement="stacked" aria-label="Replacement customer GID" placeholder="gid://shopify/Customer/1234567890" pattern="^gid://shopify/Customer/[A-Za-z0-9_\-]+$" />
                  </ion-item>

                  <ion-list-header><ion-label>Balance</ion-label></ion-list-header>
                  <!-- Computed from the operator's own selections, so an exact,
                       lesser or greater exchange is visible before the run
                       rather than only in the POS summary. -->
                  <div class="cart-totals">
                    <div><span>Returning</span><span>{{ returnTotalLabel }}</span></div>
                    <div><span>Replacing</span><span>{{ replacementTotalLabel }}</span></div>
                    <div><span>Net</span><span>{{ directionPreview }}</span></div>
                  </div>
                  <ion-item>
                    <ion-select v-model="direction" label="Approved balance direction" label-placement="stacked" interface="popover" aria-label="Exchange direction">
                      <ion-select-option value="collect">Collect difference</ion-select-option>
                      <ion-select-option value="even">Even exchange</ion-select-option>
                      <ion-select-option value="refund">Refund difference</ion-select-option>
                    </ion-select>
                  </ion-item>
                  <ion-text color="warning" v-if="directionDisagrees"><p role="alert">These selections add up to “{{ directionPreview }}”, but the run is approved as “{{ direction }}”. The safety layer blocks the commit if the real POS amount points the other way.</p></ion-text>
                  <ion-item>
                    <ion-input v-model="maximumDifference" inputmode="decimal" label="Maximum absolute difference" label-placement="stacked" aria-label="Maximum exchange difference" />
                    <ion-note slot="end">{{ sourceCurrency || 'no currency' }}</ion-note>
                  </ion-item>
                </template>

                <!-- Shown last because it is how the run ends: POS only offers a
                     refund method when money actually goes back. -->
                <ion-item v-if="selectedOrderDetail && showRefundMethod">
                  <ion-select v-model="refundMethod" label="Refund method" label-placement="stacked" interface="popover" aria-label="Refund method">
                    <ion-select-option v-for="method in refundMethods" :key="method" :value="method">{{ describeRefundMethod(method) }}</ion-select-option>
                  </ion-select>
                </ion-item>
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
                      <ion-list v-if="selectedReturnCandidates.length" lines="none" class="plan-lines">
                        <ion-item v-for="candidate in selectedReturnCandidates" :key="candidate.line.gid" lines="none">
                          <ion-label class="ion-text-wrap">
                            Return {{ candidate.line.productTitle || 'Unnamed product' }} × {{ returnLineDrafts[candidate.line.gid]?.quantity }}
                            <p>{{ returnLineDrafts[candidate.line.gid]?.restock ? 'Restock' : 'No restock' }} · {{ describeReturnReason(returnLineDrafts[candidate.line.gid]?.reason ?? defaultReturnReason) }}</p>
                            <p v-if="returnLineDrafts[candidate.line.gid]?.note.trim()">Note: {{ returnLineDrafts[candidate.line.gid]?.note.trim() }}</p>
                          </ion-label>
                        </ion-item>
                      </ion-list>
                      <p v-else class="cart-empty">Choose at least one fulfilled, refundable item.</p>
                      <div class="cart-totals">
                        <div v-if="showRefundMethod"><span>Refund method</span><span>{{ describeRefundMethod(refundMethod) }}</span></div>
                        <div v-if="isExchangeScenario"><span>Replacements</span><span>{{ replacementLines.length ? replacementLines.map(line => `${line.productTitle} × ${line.quantity}`).join(', ') : 'Choose a product' }}</span></div>
                        <div v-if="isExchangeScenario"><span>Customer</span><span>{{ customerActionLabel }}</span></div>
                        <div v-if="isExchangeScenario"><span>Computed net</span><span>{{ directionPreview }}</span></div>
                        <div v-if="isExchangeScenario"><span>Approved direction</span><span>{{ direction }}</span></div>
                        <div v-if="isExchangeScenario"><span>Maximum allowed</span><span>{{ maximumDifference || 'unset' }} {{ sourceCurrency }}</span></div>
                        <div><span>Currency</span><span>{{ sourceCurrency || 'unknown' }}</span></div>
                      </div>
                      <ion-note color="medium"><p>{{ summary }}</p></ion-note>
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
          <ion-title>{{ productModal === 'replacement' ? 'Add replacement products' : 'Add products' }}</ion-title>
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
      <ion-footer v-if="productModal !== 'closed'">
        <ion-toolbar>
          <ion-title size="small">{{ productModal === 'replacement' ? `${replacementLines.length} replacement item${replacementLines.length === 1 ? '' : 's'}` : `${cart.itemCount} item${cart.itemCount === 1 ? '' : 's'} in the cart` }}</ion-title>
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
import { IonAccordion, IonAccordionGroup, IonBackButton, IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonCheckbox, IonChip, IonCol, IonContent, IonFooter, IonGrid, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonListHeader, IonModal, IonNote, IonPage, IonRadio, IonRadioGroup, IonRow, IonSearchbar, IonSegment, IonSegmentButton, IonSelect, IonSelectOption, IonSkeletonText, IonSpinner, IonText, IonTextarea, IonTitle, IonToggle, IonToolbar, onIonViewWillEnter } from '@ionic/vue';
import { addOutline, alertCircleOutline, closeCircleOutline, documentTextOutline, removeOutline, searchOutline, trashOutline } from 'ionicons/icons';
import { customerIsUsable, customerLabel, deliveryMethods, emptyCustomer, useCartStore, type CartLine, type PlannedCustomer } from '../stores/cart.ts';
import type { DeviceProfile, OmsCustomer, OmsOrderCustomer, OmsPosOrder, OmsConnectionSummary, OmsLocation, OmsOrder, OmsShop, OmsShopifyOrderDetail, OmsVariant, TargetContext } from '../../shared/contracts.ts';
import { getHealth, getOmsConnections, listOmsPosOrders, searchOmsCustomers, getOmsShops, getOmsShopifyOrderDetail, getProfiles, listOmsLocations, searchOmsOrders, searchOmsVariants, startRun } from '../api.ts';
import { useTestEnvStore } from '../stores/test-env.ts';
import { instanceNameFromOrigin } from '../oms-origin.ts';
import { buildMutationParameters, buildTargetContext, type MutationScenarioId, type PosPlanInput } from '../pos-plan.ts';
import { describeVariantSelection, plannedVariantSelection, type VariantSelection } from '../../shared/variant-selection.ts';
import { defaultReturnReason, describeReturnReason, returnReasons, type ReturnReason } from '../../shared/return-reason.ts';
import { refundMethods, type CustomerAction, type RefundMethod } from '../../core/safety/transaction-inputs.ts';

type ScenarioId = 'pos.open-first-order' | MutationScenarioId;
type OrderLine = OmsShopifyOrderDetail['lines'][number];
type ExchangeDirection = PosPlanInput['direction'];

/**
 * One source line as the operator configured it. POS asks for restock, reason
 * and note per line, so the page keeps one draft per line rather than one set
 * of controls for the whole return.
 */
interface ReturnLineDraft { selected: boolean; quantity: string; restock: boolean; reason: ReturnReason; note: string }

/** A refundable source line together with the facts that decide whether POS will offer it. */
interface ReturnCandidate { line: OrderLine; fulfilled: number; refundable: number }

/** A replacement item, carrying everything a create-order cart line carries. */
interface ReplacementDraft {
  variantGid: string;
  productGid: string;
  search: string;
  quantity: number;
  variantSelection: VariantSelection;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  unitPrice: string | null;
  productVariantCount: number | null;
}

const scenarios = [
  { id: 'pos.open-first-order', name: 'Open first order', description: 'Read-only Home → Orders → first listed order detail smoke.', effect: 'read-only' },
  { id: 'pos.create-cash-order', name: 'Create a cash order', description: 'Add selected variants in Shopify POS and complete a test-store cash order.', effect: 'create-order' },
  { id: 'pos.return-cash-order', name: 'Return an existing order', description: 'Return exact eligible lines from a cash test fixture with explicit restock choices.', effect: 'return' },
  { id: 'pos.exchange-cash-order', name: 'Exchange an existing order', description: 'Exercise equal, collect-difference or refund-difference cash exchange paths.', effect: 'exchange' },
  // Same plan as a return, stopped one tap short of the refund. Worth its own
  // entry because the device work is what breaks, and finding that out should
  // not cost a real refund.
  { id: 'pos.rehearse-return', name: 'Rehearse a return (no refund)', description: 'Builds the whole return cart on the iPad, reads every per-line setting back and opens the refund-method chooser, then clears the cart. Nothing is refunded.', effect: 'read-only' },
  { id: 'pos.rehearse-exchange', name: 'Rehearse an exchange (no tender)', description: 'Builds the whole exchange cart on the iPad, adds the replacements through the same product search a sale uses, and checks the cart agrees with the approved direction, then clears the cart. Nothing is tendered.', effect: 'read-only' },
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
const selectedVariant = ref<OmsVariant>(); const selectedOrder = ref<OmsOrder>(); const selectedOrderDetail = ref<OmsShopifyOrderDetail>();
const profileId = ref(''); const connectionId = ref(''); const shopId = ref(''); const locationGid = ref('');
const savedEnvironment = computed(() => testEnv.savedEnvironment);
const variantGid = ref(''); const quantity = ref('1'); const orderGid = ref('');
// Keyed by line GID, and kept for every refundable line rather than only the
// ticked ones, so unticking a line and ticking it again returns the quantity,
// restock, reason and note the operator already chose.
const returnLineDrafts = ref<Record<string, ReturnLineDraft>>({});
const refundMethod = ref<RefundMethod>('cash');
const replacementLines = ref<ReplacementDraft[]>([]);
const customerAction = ref<CustomerAction>('keep');
const exchangeCustomerGid = ref('');
// True once the operator has approved a direction that is not the one their own
// selections add up to. Until then the select follows the computed value.
const directionTouched = ref(false);
const maximumDifference = ref('20.00'); const currency = ref('USD'); const direction = ref<ExchangeDirection>('collect'); const note = ref('');
const orderSearch = ref(''); const variantSearch = ref(''); const variantCursor = ref<string | null>(null); const orderCursor = ref<string | null>(null);
const environmentLoading = ref(false); const variantLoading = ref(false); const orderLoading = ref(false); const starting = ref(false); const error = ref('');
let variantRequest = 0; let orderRequest = 0; let variantTimer: ReturnType<typeof setTimeout> | undefined; let orderTimer: ReturnType<typeof setTimeout> | undefined;

const activeConnection = computed(() => connections.value.find(connection => connection.id === connectionId.value));
const selectedShop = computed(() => shops.value.find(shop => shop.connectorShopId === shopId.value));
const selectedProfile = computed(() => profiles.value.find(profile => profile.id === profileId.value));
const selectedLocationName = computed(() => locations.value.find(location => location.gid === locationGid.value)?.name ?? '');
const selectedScenarioName = computed(() => scenarios.find(scenario => scenario.id === selectedScenario.value)?.name ?? 'Selected workflow');
const isMutation = computed(() => selectedScenario.value !== 'pos.open-first-order');
// A rehearsal is configured exactly like the thing it rehearses; only the
// last tap differs, and the rehearsal never takes it.
const isExchangeScenario = computed(() => selectedScenario.value === 'pos.exchange-cash-order' || selectedScenario.value === 'pos.rehearse-exchange');
const eligibleLines = computed(() => (selectedOrderDetail.value?.lines ?? []).filter(line => (line.refundableQuantity ?? 0) > 0));
const sourceIsCash = computed(() => selectedOrderDetail.value?.paymentGatewayNames.length === 1 && selectedOrderDetail.value.paymentGatewayNames[0]?.trim().toLowerCase() === 'cash');
// The exchange arithmetic and the approved maximum only mean anything in the
// source order's own currency, so it is read from the order and never typed.
const sourceCurrency = computed(() => selectedOrderDetail.value?.total?.currency ?? '');

// Shopify POS greys out "Return or exchange" for anything that was never
// shipped, so the page has to know the fulfilled quantity per line before it
// offers the line at all. Only a SUCCESS fulfillment counts: a cancelled or
// still-pending one moved no goods and leaves the line unreturnable on the
// device.
const fulfilledQuantities = computed<Record<string, number>>(() => {
  const totals: Record<string, number> = {};
  for (const fulfillment of selectedOrderDetail.value?.fulfillments ?? []) {
    if ((fulfillment.status ?? '').trim().toUpperCase() !== 'SUCCESS') continue;
    for (const line of fulfillment.lines) totals[line.lineGid] = (totals[line.lineGid] ?? 0) + line.quantity;
  }
  return totals;
});

const returnCandidates = computed<ReturnCandidate[]>(() => eligibleLines.value.map(line => ({
  line,
  fulfilled: fulfilledQuantities.value[line.gid] ?? 0,
  refundable: line.refundableQuantity ?? 0,
})));
const posReturnableLines = computed(() => returnCandidates.value.filter(candidate => candidate.fulfilled > 0));
const orderHasNoFulfilledLines = computed(() => Boolean(selectedOrderDetail.value) && returnCandidates.value.length > 0 && posReturnableLines.value.length === 0);
const selectedReturnCandidates = computed(() => returnCandidates.value.filter(candidate => returnLineDrafts.value[candidate.line.gid]?.selected === true));

// The refund method is only meaningful when money goes back: on a return
// always, on an exchange only when the balance ends up in the customer's
// favour. POS never asks for it on a collect or an even exchange.
/** A return and its rehearsal are configured identically; only the last tap differs. */
const isReturnShaped = computed(() => selectedScenario.value === 'pos.return-cash-order' || selectedScenario.value === 'pos.rehearse-return');
const showRefundMethod = computed(() => isReturnShaped.value || (isExchangeScenario.value && direction.value === 'refund'));

const plannedReturnLines = computed(() => returnCandidates.value.flatMap(candidate => {
  const draft = returnLineDrafts.value[candidate.line.gid];
  if (!draft?.selected) return [];
  return [{ lineGid: candidate.line.gid, quantity: draft.quantity, restock: draft.restock, reason: draft.reason, note: draft.note }];
}));

/**
 * The exchange preview is arithmetic on money, so it runs on integer minor
 * units: summing "10.10" and "0.20" as binary floats drifts by a fraction of a
 * cent and can flip an even exchange into a collect. `null` means a price was
 * missing or carried more precision than the planner's own two-decimal money
 * contract accepts, and the preview then says it cannot be computed rather
 * than showing a number built from a guess.
 */
function minorUnits(amount: string | null | undefined): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec((amount ?? '').trim());
  if (!match) return null;
  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) return null;
  return whole * 100 + Number((match[2] ?? '').padEnd(2, '0'));
}

function formatMinorUnits(value: number): string {
  const absolute = Math.abs(value);
  return `${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

const returnTotalMinor = computed<number | null>(() => {
  let total = 0;
  for (const candidate of selectedReturnCandidates.value) {
    const draft = returnLineDrafts.value[candidate.line.gid];
    const unit = minorUnits(candidate.line.unitPrice?.amount);
    const quantity = Number((draft?.quantity ?? '').trim());
    if (unit === null || !Number.isSafeInteger(quantity) || quantity <= 0) return null;
    total += unit * quantity;
  }
  return total;
});

const replacementTotalMinor = computed<number | null>(() => {
  let total = 0;
  for (const line of replacementLines.value) {
    const unit = minorUnits(line.unitPrice);
    if (unit === null) return null;
    total += unit * line.quantity;
  }
  return total;
});

// Positive means POS collects from the customer, negative means it refunds.
const netMinor = computed<number | null>(() => {
  const returned = returnTotalMinor.value;
  const replaced = replacementTotalMinor.value;
  if (returned === null || replaced === null) return null;
  return replaced - returned;
});

const computedDirection = computed<ExchangeDirection | null>(() => {
  if (netMinor.value === null) return null;
  if (netMinor.value > 0) return 'collect';
  if (netMinor.value < 0) return 'refund';
  return 'even';
});

function amountLabel(value: number | null): string {
  return value === null ? 'Unknown' : `${formatMinorUnits(value)} ${sourceCurrency.value}`.trim();
}
const returnTotalLabel = computed(() => amountLabel(returnTotalMinor.value));
const replacementTotalLabel = computed(() => amountLabel(replacementTotalMinor.value));
const directionPreview = computed(() => {
  if (netMinor.value === null) return 'Net unknown: a selected line or replacement has no usable price';
  if (netMinor.value === 0) return 'Even exchange';
  return `${netMinor.value > 0 ? 'Collect' : 'Refund'} ${amountLabel(netMinor.value)}`;
});
const directionDisagrees = computed(() => Boolean(computedDirection.value) && computedDirection.value !== direction.value);

function describeRefundMethod(method: RefundMethod): string {
  return method === 'gift-card' ? 'Gift card' : 'Cash, original payment';
}
function orderCustomerLabel(customer: OmsOrderCustomer): string {
  const name = [customer.firstName, customer.lastName].map(part => part.trim()).filter(Boolean).join(' ');
  return [name, customer.email.trim(), customer.phone.trim()].filter(Boolean).join(' · ') || customer.gid;
}
const customerActionLabel = computed(() => {
  if (customerAction.value === 'replace') return `Replace with ${exchangeCustomerGid.value.trim() || 'an unset GID'}`;
  return customerAction.value === 'remove' ? 'Remove from the order' : 'Keep as is';
});
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
function friendlyPlanError(message: string): string {
  if (/create-order plan requires at least one/i.test(message)) return 'Add at least one product to the cart.';
  if (/create-order lines.*unique|Create-order lines must be unique/i.test(message)) return 'The cart has the same product twice; adjust its quantity instead.';
  // Replacement wording is matched before the generic variant wording, which
  // would otherwise claim the create-order cart is at fault.
  if (/exchange plan requires at least one replacement|replacement variant.*exact Shopify GID|replacement product.*exact Shopify GID/i.test(message)) return 'Choose at least one replacement product.';
  if (/exchange replacements contains duplicate/i.test(message)) return 'The same replacement product is listed twice; adjust its quantity instead.';
  if (/replacement customer|customer GID/i.test(message)) return 'Enter the exact Shopify customer GID this exchange should move the order to.';
  if (/variant.*exact Shopify GID/i.test(message)) return 'Choose a product from the search results.';
  if (/source order.*exact Shopify GID|return plan.*exact Shopify order GID/i.test(message)) return 'Choose an existing order from the search results.';
  if (/source line.*exact Shopify GID|return lines.*exact Shopify order line GID/i.test(message)) return 'Choose a refundable item from the selected order.';
  if (/return line quantity exceeds/i.test(message)) return 'A return quantity is higher than the quantity that line still has refundable.';
  if (/return line quantity must be/i.test(message)) return 'Give every selected line a whole return quantity of at least 1.';
  if (/maximum exchange difference/i.test(message)) return sourceCurrency.value ? `Enter the maximum allowed difference as a plain ${sourceCurrency.value} amount, for example 20.00.` : 'The source order reports no currency, so an exchange difference cannot be bounded. Choose an order that has a total.';
  if (/POS order reference/i.test(message)) return 'Choose an order from the search results so its POS reference can be frozen safely.';
  return message;
}

function planInput(): PosPlanInput {
  // A create-order run is frozen against the cart. Return and exchange keep
  // their own source-order inputs.
  const fromCart = selectedScenario.value === 'pos.create-cash-order';
  const returnLines = plannedReturnLines.value;
  // The planner's single-line fields are only read when no per-line selection
  // exists. Mirroring the first selected line keeps them honest, and leaving
  // them empty when nothing is selected is what produces the "choose a
  // refundable item" message instead of a silently valid plan.
  const first = returnLines[0];
  return {
    scenario: selectedScenario.value as MutationScenarioId,
    currency: fromCart ? cart.currency : sourceCurrency.value,
    maximumDifference: maximumDifference.value,
    ...(fromCart ? { lines: cart.executableLines.map(line => ({ variantGid: line.variantGid, productGid: line.productGid, search: line.search, quantity: String(line.quantity), variantSelection: line.variantSelection })) } : {}),
    variantGid: variantGid.value, productGid: selectedVariant.value?.productGid ?? '', search: selectedVariant.value?.productTitle || '', quantity: quantity.value, orderGid: orderGid.value, orderReference: selectedOrderDetail.value?.name ?? '',
    returnLines,
    ...(showRefundMethod.value ? { refundMethod: refundMethod.value } : {}),
    lineGid: first?.lineGid ?? '', returnQuantity: first?.quantity ?? '1', restock: first?.restock ?? true,
    ...(isExchangeScenario.value ? { replacements: replacementLines.value.map(line => ({ variantGid: line.variantGid, productGid: line.productGid, search: line.search, quantity: String(line.quantity), variantSelection: line.variantSelection })) } : {}),
    replacementVariantGid: '', replacementQuantity: '1', direction: direction.value,
    // Recorded even when the exchange keeps the customer, so the read-back
    // check proves the customer the operator approved rather than assuming it.
    ...(isExchangeScenario.value ? { customerAction: customerAction.value, ...(customerAction.value === 'replace' ? { customerGid: exchangeCustomerGid.value } : {}) } : {}),
    note: fromCart ? cart.note : note.value,
    remaining: Object.fromEntries((selectedOrderDetail.value?.lines ?? []).map(line => [line.gid, line.refundableQuantity ?? -1])),
  };
}

const planError = computed(() => { if (!isMutation.value || orderDetailLoading.value) return ''; try { buildMutationParameters(planInput()); return ''; } catch (cause) { return friendlyPlanError(cause instanceof Error ? cause.message : 'Complete the test inputs.'); } });
const canRunMutation = computed(() => Boolean(targetReady.value && !planError.value));
// One sentence describing exactly what the run has been configured to do, so
// the operator reviews the whole multi-line plan rather than the last control
// they happened to touch.
function describeReturnDraft(candidate: ReturnCandidate): string {
  const draft = returnLineDrafts.value[candidate.line.gid];
  const name = `${candidate.line.productTitle || 'Unnamed product'}${candidate.line.variantTitle ? ` · ${candidate.line.variantTitle}` : ''}`;
  if (!draft) return name;
  return `${name} × ${draft.quantity} (${draft.restock ? 'restock' : 'no restock'}, ${describeReturnReason(draft.reason)}${draft.note.trim() ? `, note “${draft.note.trim()}”` : ''})`;
}

const summary = computed(() => {
  if (selectedScenario.value === 'pos.create-cash-order') {
    if (cart.isEmpty) return 'Add at least one product to the cart.';
    const items = cart.lines.map(line => `${line.productTitle} × ${line.quantity}`).join(', ');
    return `${items}; tendered as cash in ${cart.currency}.`;
  }
  if (!selectedOrderDetail.value) return 'Choose a source order and at least one eligible item before review.';
  const returned = selectedReturnCandidates.value.length ? selectedReturnCandidates.value.map(describeReturnDraft).join('; ') : 'choose at least one fulfilled, refundable item';
  const money = sourceCurrency.value || 'the source order currency';
  const head = `${selectedOrderDetail.value.name} · return ${returned}`;
  if (selectedScenario.value === 'pos.rehearse-return') return `${head}; would refund as ${describeRefundMethod(refundMethod.value)} in ${money}. Rehearsal only: the cart is cleared and nothing is refunded.`;
  if (selectedScenario.value === 'pos.return-cash-order') return `${head}; refunded as ${describeRefundMethod(refundMethod.value)} in ${money}.`;
  const replaced = replacementLines.value.length ? replacementLines.value.map(line => `${line.productTitle} · ${line.variantTitle} × ${line.quantity}`).join('; ') : 'choose at least one replacement product';
  const refund = showRefundMethod.value ? `, refunded as ${describeRefundMethod(refundMethod.value)}` : '';
  const exchangeTail = `replace with ${replaced}; customer: ${customerActionLabel.value}; ${directionPreview.value}, approved as ${direction.value}${refund}, maximum ${maximumDifference.value || 'unset'} ${money}.`;
  if (selectedScenario.value === 'pos.rehearse-exchange') return `${head}; ${exchangeTail} Rehearsal only: the cart is cleared and nothing is tendered.`;
  return `${head}; ${exchangeTail}`;
});

/** Drops the per-line drafts, which are keyed by the GIDs of one exact order. */
function clearReturnDrafts(): void { returnLineDrafts.value = {}; }

/** Everything the operator configured for a return or exchange. */
function clearReturnConfiguration(): void {
  clearReturnDrafts();
  replacementLines.value = [];
  refundMethod.value = 'cash';
  customerAction.value = 'keep';
  exchangeCustomerGid.value = '';
  directionTouched.value = false;
}

// Seeded once per loaded order, for every refundable line, so a line that is
// unticked and ticked again comes back with the settings it already had.
function seedReturnDrafts(): void {
  const drafts: Record<string, ReturnLineDraft> = {};
  for (const candidate of returnCandidates.value) {
    drafts[candidate.line.gid] = { selected: false, quantity: '1', restock: true, reason: defaultReturnReason, note: '' };
  }
  // Preselecting the first line POS can actually return keeps a chosen order
  // immediately plannable, the way the single-line picker used to be.
  const first = posReturnableLines.value[0];
  const firstDraft = first ? drafts[first.line.gid] : undefined;
  if (firstDraft) firstDraft.selected = true;
  returnLineDrafts.value = drafts;
}

function toggleReturnLine(gid: string, selected: boolean): void {
  const draft = returnLineDrafts.value[gid];
  if (!draft) return;
  draft.selected = selected;
}

function clearShopData(): void {
  variantRequest++; orderRequest++; variants.value = []; orders.value = []; posOrders.value = []; locations.value = []; variantCursor.value = null; orderCursor.value = null; posOrderCursor.value = null; selectedVariant.value = undefined; selectedOrder.value = undefined; selectedOrderDetail.value = undefined; locationGid.value = ''; variantGid.value = ''; orderGid.value = '';
  clearReturnConfiguration();
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
  variantGid.value = '';
  clearReturnConfiguration();
  if (selectedOrderDetail.value) seedReturnDrafts();
  if (selectedScenario.value !== 'pos.create-cash-order' && !posOrders.value.length && connectionId.value && shopId.value) {
    void loadPosOrders();
  }
}

// An exchange can put several items back in the cart, so the replacement list
// behaves exactly like the create-order cart: a tick adds the item, an untick
// removes it, and the quantity is adjusted on the row afterwards.
function replacementFromVariant(variant: OmsVariant): ReplacementDraft {
  return {
    variantGid: variant.gid,
    productGid: variant.productGid,
    // Product title is the term POS product search is driven with; the result
    // row is then matched by exact product id, exactly as a cart line is.
    search: variant.productTitle || 'Unnamed product',
    quantity: 1,
    variantSelection: plannedVariantSelection(variant),
    productTitle: variant.productTitle || 'Unnamed product',
    variantTitle: variant.title,
    sku: variant.sku,
    unitPrice: variant.price,
    productVariantCount: variant.productVariantCount,
  };
}

function setReplacementQuantity(variantGid: string, quantity: number): void {
  const line = replacementLines.value.find(entry => entry.variantGid === variantGid);
  if (!line || !Number.isSafeInteger(quantity) || quantity < 1) return;
  line.quantity = quantity;
}

function removeReplacement(variantGid: string): void {
  replacementLines.value = replacementLines.value.filter(line => line.variantGid !== variantGid);
}

function isVariantChecked(variant: OmsVariant): boolean {
  return productModal.value === 'replacement' ? replacementLines.value.some(line => line.variantGid === variant.gid) : cart.hasLine(variant.gid);
}

function toggleVariant(variant: OmsVariant, checked: boolean): void {
  if (productModal.value === 'replacement') {
    if (!checked) { removeReplacement(variant.gid); return; }
    if (!replacementLines.value.some(line => line.variantGid === variant.gid)) replacementLines.value.push(replacementFromVariant(variant));
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
    // A fresh search never drops items the operator already chose: the cart and
    // the replacement list both survive retyping the search term.
    if (!append) { selectedVariant.value = undefined; variantGid.value = ''; }
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
    if (!append) { selectedOrder.value = undefined; selectedOrderDetail.value = undefined; clearReturnDrafts(); orderGid.value = ''; }
  } catch (cause) { if (request === orderRequest) error.value = cause instanceof Error ? cause.message : 'Order search failed.'; }
  finally { if (request === orderRequest) orderLoading.value = false; }
}

async function selectOrder(order: OmsOrder): Promise<void> { selectedOrder.value = order; orderGid.value = order.gid; selectedOrderDetail.value = undefined; clearReturnDrafts(); sourcePanel.value = undefined; await loadOrderDetail(); }
async function loadOrderDetail(): Promise<void> {
  if (!connectionId.value || !shopId.value || !selectedOrder.value) return;
  const request = ++orderRequest; orderDetailLoadingGid.value = selectedOrder.value.gid; error.value = '';
  try { const result = await getOmsShopifyOrderDetail({ connectionId: connectionId.value, shopId: shopId.value, gid: selectedOrder.value.gid }); if (request !== orderRequest) return; selectedOrderDetail.value = result.order; seedReturnDrafts(); }
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

// The approved direction defaults to whatever the operator's own selections
// add up to, and stops following it the moment they approve something else.
// Tracking the override by comparing the two values rather than by listening
// for a change event keeps the flag right however the select was set.
watch(computedDirection, value => { if (value && !directionTouched.value) direction.value = value; }, { immediate: true });
watch(direction, value => { directionTouched.value = Boolean(computedDirection.value) && value !== computedDirection.value; });

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
.return-line + .return-line { border-top: 1px solid var(--ion-color-step-150, var(--ion-background-color-step-150, #e0e0e0)); }
/* Indents a selected line's own controls under its checkbox, so the per-line
   settings read as belonging to that line rather than to the whole return. */
.return-line-controls { padding-inline-start: 2.25rem; padding-bottom: .5rem; }
.plan-lines { background: transparent; }
.plan-lines ion-item { --background: transparent; --padding-start: 0; --inner-padding-end: 0; }
</style>
