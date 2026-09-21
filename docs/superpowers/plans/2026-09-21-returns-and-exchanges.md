# Returns and exchanges in Shopify POS: implementation plan

Written 2026-09-21 for the next implementer (Opus 5). Everything under
"Observed" was captured on POS 11.14.0, iPadOS 27.0, test store
hc-sandbox / OMS test-maarg, order HCDEV#5860, with the read-only walker
`pos.inspect-walk` (runs run-1789960050617 through run-1789961381360). Nothing
was committed; the fixtures are intact. Anything marked **TO VERIFY** has not
been observed and must be captured with the walker before code depends on it.

Read first: `README.md` ("Cash-sale building blocks"), `test/screens/wait.ts`,
`test/screens/pos-cart.ts`, `test/flows/cash-sale.ts`,
`test/scenarios/return-order.ts`, `test/scenarios/exchange-order.ts`,
`core/verification/order.ts`, `ui/pages/Pos.vue` (return/exchange cards),
`ui/pos-plan.ts`, `core/safety/transaction-inputs.ts`, `test/scenarios/registry.ts`.

---

## 1. What POS does (observed)

### 1.1 Getting to the return surface

| Step | Selector / behaviour | Notes |
|---|---|---|
| Orders tab | `~Component.AppNavigation.BottomTabs.Orders` | |
| Order search | `-ios predicate string:type == "XCUIElementTypeSearchField" AND visible == 1`, type the reference | `pos.openOrderByReference` does this; it now accepts rows without a customer (`readOrderRowSummary`). |
| Order row | `~Component.OrdersList.Order.<legacyOrderId>` | Label `HCDEV#5860, Today at 9:26 PM, Paid, Fulfilled, $171.00`. The legacy id is `OmsShopifyOrderDetail.legacyResourceId`. |
| Order detail | `Screen.OrderDetailsScreen`, `Component.ActionBar.PrimaryActionButton` label `Close` | Lines: `<fulfillmentLineItemId>.LineItem.ListItem`, label `White Shirt, $120.00` / `Hyperion Elements Jacket, XS / Green, $51.00`. Badges `Paid`, `Fulfilled`. Section `Fulfilled (2) · Brooklyn · HCDEV#5860-F1`. |
| Return or exchange | `-ios predicate string:name == "Return or exchange" AND accessible == 1` | **Element taps do nothing** (inner button and accessible wrapper both return success, no effect). Only a **coordinate tap** at the element centre (`mobile: tap`) opens the surface, and only once the detail has settled: it worked after ~8 s, failed 1.5 s after the detail appeared. Wait until the control is hittable, pause ~2 s, coordinate-tap, and if the sheet title `Select items to return` is not present within 5 s, tap once more. |
| Disabled button | `enabled="false"` | Seen on unfulfilled orders (HCDEV#5697 on 2026-09-20). Tonight's orders were `Unfulfilled` for roughly an hour and then `Fulfilled` by the OMS. **Returns need a fulfilled order.** |

### 1.2 The return sheet ("Select items to return")

It is not a new screen. POS turns the Home cart into a return cart; `Screen.Home`
and `Screen.Cart` stay in the tree and the sheet's controls are plain buttons.

| Control | Selector | Notes |
|---|---|---|
| Title | `~Component.ActionBar.Title` label `Select items to return` | Presence test for "sheet open". |
| Back | `~Component.ActionBar.PrimaryActionButton` label `Back` | Closes the sheet, cart keeps the return lines. |
| Done | `~Component.ActionBar.SecondaryActionButton` label `Done` | Disabled until an item is selected. Closes the sheet; the Home tiles return; the cart keeps the return lines. |
| Item | `-ios predicate string:type == "XCUIElementTypeButton" AND name == "<title>[, <variant>]"` | `White Shirt`, `Hyperion Elements Jacket, XS / Green`. Tapping selects the item (qty 1) and expands its panel. |
| Add exchange items | `-ios predicate string:type == "XCUIElementTypeButton" AND name == "Add exchange items"` | Disabled until an item is selected. Opens `Screen.Search`, the same product search as a sale, with Back `Component.SearchBar.Text.CancelSearchIconLeft`. `posCart` routines apply unchanged. |
| Grab handle | `~adaptive-card-grab-handle` label `Close` | Not used. |

### 1.3 The per-item panel (after selecting an item)

| Config | Selector | Observed default |
|---|---|---|
| Quantity | `~Screen.ManageItem.quantityStepper.TextInput` (value), `.DecrementButton`, `.IncrementButton` | `1`; increment disabled when the line's quantity is 1. |
| Return reason | `-ios predicate string:type == "XCUIElementTypeButton" AND name == "Return reason"` | Opens a picker of ten buttons named exactly: `Too big`, `Too small`, `Color`, `Style`, `Changed my mind`, `Item not as described`, `Received the wrong item`, `Damaged or defective`, `Unknown`, `Other`. After choosing, the button's name becomes the chosen reason and the cart line label gains `Return reason: <reason>`. |
| Restock | `XCUIElementTypeSwitch` name `Restock at this location: <title>`, value `1`/`0` | On by default. Toggle with a tap on the switch. |
| Note | `XCUIElementTypeTextField` name `Note` | Free text. Where it lands in Shopify: **TO VERIFY** (likely the return line note). |

### 1.4 The cart pane during a return or exchange

| Element | Selector / label |
|---|---|
| Header | StaticText `Return HCDEV#5860` |
| Return line | `SharedCart.ReturnLineItem.<uuid>` label `White Shirt, Return reason: Changed my mind, −$120.00`; child `.title`, `.label-0`. The uuid is per session, never stable. Match lines by label prefix (title, variant). |
| Exchange (sale) line | `SharedCart.LineItem.<uuid>` label `White Shirt, Tax-exempt, $120.00`, under a `Purchase` header. Note: **not** `Screen.Cart.cartLineItem-N`; `anyCartLineItem` does not see these. |
| Subtotal | Button `Subtotal,  • 2 items, $0.00` |
| Checkout control | `~Screen.Cart.CheckoutButton`. Label `Refund $120.00` (net refund), `Complete exchange` (net zero). Net collect: **TO VERIFY** (expected `Checkout $X` or `Charge $X`). |
| Clear cart | `~Screen.Cart.AddCartButton` label `Clear cart` | Clears the whole return cart; the safe way to abandon. |
| Customer row | `~Screen.Cart.AddCustomerRow` label `Add customer` | HCDEV#5860 has no customer. Remove/replace on an order with a customer: **TO VERIFY**. |

### 1.5 Refund method (net refund only)

Tapping `Refund $120.00` opens **Select refund method** (title StaticText), with
Back `~Component.ActionBar.PrimaryActionButton`, and buttons named:
`Cash, Original payment`, `Gift card`, `Split refund`. Nothing was committed.

**TO VERIFY**: what `Cash, Original payment` opens. The sale flow taught us the
exact-amount chip commits by itself; assume the same here until seen. Capture
with the walker but do not tap any amount or confirm control.

### 1.6 Exchange checkout

Even (`Complete exchange`) and collect: **TO VERIFY**. Expect the sale checkout
(`Screen.CheckoutSelectPayment` → `Screen.CheckoutSelectPayment.Cash` →
`Screen.AcceptCash` chip) for collect, and a direct completion for even.

### 1.7 Things that bit us during discovery (bake these in)

- Element taps that "succeed" and do nothing: use coordinate taps for the
  Return or exchange action; keep element taps everywhere else.
- Adding a variant product as an exchange item: the variant row tap that
  works in a sale did not add the line here (run-1789961195804). Tap the
  row's inner add button as `posCart.chooseVariant` already does; **TO VERIFY**.
- Reset: `posReset.clearCartAndReturnHome` does not know return carts
  (`SharedCart.ReturnLineItem.*`) or the return sheet. Extend it: treat the
  sheet title as an overlay (Back), treat `SharedCart.*` lines as "cart holds
  lines", and rely on `Clear cart` which clears both kinds.
- Read-only diagnostics leave POS where they stop; `pos.navigate-home` then
  `pos.clear-cart` restores Home + empty cart.

---

## 2. How the user configures each case in the app

All of this is in the existing planner card "Return details / Exchange
details" in `ui/pages/Pos.vue`, driven by `ui/pos-plan.ts` and validated by
`core/safety/transaction-inputs.ts`. Today it supports one line, one quantity,
one restock checkbox, one replacement variant, a direction and a maximum
difference.

### 2.1 Source order

- Keep the existing OMS order picker (recent POS orders first, search by
  reference). Show `financialStatus` and `fulfillmentStatus`.
- **Fulfilled vs unfulfilled**: POS only enables Return or exchange on
  fulfilled orders. The planner should show the status and, for an
  unfulfilled order, offer two configurations: (a) *expect blocked*: the run
  proves the action is disabled and stops (a read-only run); (b) *wait for
  fulfillment*: not automated; the OMS fulfils POS orders on its own schedule
  (about an hour tonight). Do not try to fulfil from this app; it exposes no
  Shopify mutation by design.

### 2.2 Return lines (multi-select, per line)

Replace the single radio with a checklist of `eligibleLines`
(`refundableQuantity > 0`). Per selected line:

| Config | Control | Contract |
|---|---|---|
| Quantity | number input, 1..refundableQuantity | `lines[].quantity` (exists) |
| Restock | toggle, default on | `lines[].restock` (exists) |
| Return reason | select of the ten POS reasons, default `Unknown` | `lines[].reason: ReturnReason` (new enum, exact POS strings) |
| Note | optional text, ≤ 200 | `lines[].note?` (new) |

The existing top-level `reason` (free text) is retired in favour of per-line
reasons; keep the order-level `note` only if POS exposes one (it does not in
the sheet observed).

### 2.3 Refund method (return, and exchange with net refund)

Select: `Cash (original payment)` default; `Gift card`; `Split` later.
Contract: `refundMethod: 'cash' | 'gift-card'` (v1 accepts `cash` only and the
UI says so). Split refund is out of scope until the surface is captured.

### 2.4 Exchange

- **Replacement items**: reuse the product picker and the cart store so each
  replacement carries `variantGid`, `productGid`, `search`, `quantity` and
  `variantSelection`, exactly like create-order lines. Contract:
  `replacements[]` gains `productGid`, `search`, `variantSelection`
  (today it has only `variantGid`, `quantity`).
- **Exact / lesser / greater** are not chosen; they are derived. The planner
  computes `net = sum(replacement prices) − sum(returned unit prices)` from
  the read-back order's `unitPrice` and the variants' `price`, and shows it as
  the expected direction (`even`, `refund`, `collect`) with the amount. The
  user sets `maximumDifference` (exists). The run refuses to commit if POS's
  net (from the cart control label) disagrees in direction or exceeds the bound.
- **Payment method for a collect**: select `Cash` (v1). Contract:
  `collectMethod: 'cash'`. "Different payment method" means anything other
  than the original tender; card is not automatable without hardware, so v1
  proves cash for a cash order and leaves a hook for `custom` payments
  (POS "Custom payment" tender, **TO VERIFY** it exists in this store).
- **Customer**: radio `Keep`, `Remove`, `Replace with…` (existing OMS
  customer search). Contract: `customer: { action: 'keep' | 'remove' | 'replace'; gid?: string }`.
  The return cart shows `Screen.Cart.AddCustomerRow`; removing and replacing
  on an order that has a customer is **TO VERIFY**.

### 2.5 Frozen intent

`TransactionIntent` already has `returnLines`, `purchaseLines`,
`expectedDirection`, `maximumAbsoluteAmount`. Extend `returnLines` with
`reason` and `restock` (restock exists), add `refundMethod`, `collectMethod`
and `customer` so the ledger hash covers every configured choice.

---

## 3. How the run performs each case in POS

Build these as screen routines in a new `test/screens/pos-return.ts`, using
only `wait.ts` primitives (`isPresent`, `waitForPresent`, `waitForGone`,
`enabledIfPresent`, `clickIfPresent`) plus `posCart` for exchange items and
`posCheckout` for a collect. Then implement `ReturnOrderDriver` and
`ExchangeOrderDriver` on top; `returnCashOrder` and `exchangeCashOrder`
already orchestrate ledger, pre-commit checks and Shopify verification.

### 3.1 Open the return sheet

1. `pos.assertHome()`, `pos.assertEmptyCart()`.
2. `pos.openOrders()`, `pos.openOrderByReference(reference)`, `pos.assertOrderDetail(reference)`.
3. Wait until the Return or exchange wrapper is hittable, pause 2 s, coordinate-tap its centre, wait for `Component.ActionBar.Title` = `Select items to return` (5 s), retry the tap once.
4. If the wrapper is `enabled="false"`: the order is not returnable (unfulfilled). For the *expect blocked* configuration this is the pass condition; otherwise fail before any state changes.

### 3.2 Select and configure each return line

For each configured line, in order:

1. Tap the item button by its label prefix (`<productTitle>` or `<productTitle>, <variantTitle>`), matched against the read-back order line so gid and title stay tied together.
2. Quantity: read `Screen.ManageItem.quantityStepper.TextInput`; tap `IncrementButton` until it equals the configured quantity (verify the value after each tap; the button disables at the maximum).
3. Restock: read the switch `Restock at this location: <title>`; tap only if its value differs from the configuration; re-read.
4. Reason: tap `Return reason`, tap the button named exactly as configured, verify the cart line label now contains `Return reason: <reason>`.
5. Note: `setValue` on the `Note` field if configured.
6. Verify the cart shows one `SharedCart.ReturnLineItem.*` per configured line with the expected `−$amount`.

### 3.3 Exchange items

1. Tap `Add exchange items` (element tap works).
2. For each replacement: `posCart.addItemToCart` semantics (search by `search`, tap `productRow(productId)`, single vs multi by `variantSelection`), but the cart-line wait must look for a new `SharedCart.LineItem.*` whose label starts with the product title, not `Screen.Cart.cartLineItem-N`. Add a `lineMatcher` parameter to `posCart` for this.
3. Back out of picker/search with `posCart.closeProductSurfaces()`.
4. Tap `Done`.

### 3.4 Bound the net before anything irreversible

Read the `~Screen.Cart.CheckoutButton` label:

| Label | Direction | Next |
|---|---|---|
| `Refund $X` | refund | 3.5 |
| `Complete exchange` | even | 3.6 |
| collect label (**TO VERIFY**) | collect | 3.7 |

Compare with the frozen `expectedDirection` and `maximumDifference`
(`assertExchangeDirection` exists). Mismatch: fail closed, then reset.

### 3.5 Net refund: choose the refund method and commit

1. Tap `Refund $X` → wait for `Select refund method`.
2. Record the commit attempt (`context.recordCommitAttempt`) **before** tapping the method: the cash path may commit on the method or on the next control.
3. Tap `Cash, Original payment` (or `Gift card`). Whatever follows is **TO VERIFY**; handle it like `commitExactCash`: wait for the refund surface to leave the tree or for a single confirm control, never tap an amount chip blind.
4. `finishReceipt()`-equivalent: receipt/complete surface, Done, Home, empty cart.

### 3.6 Even exchange

Tap `Complete exchange` after recording the commit attempt. **TO VERIFY**
whether it completes immediately or shows a confirmation.

### 3.7 Collect exchange

`posCheckout.openCheckout()` → `selectCashTender()` → `commitExactCash()`
with the `beforeCommit` ledger hook, exactly as a sale. **TO VERIFY** that the
payment selection and cash surfaces are the same identifiers.

### 3.8 Customer changes (exchange)

**TO VERIFY** on a fixture that has a customer: the cart's customer row
control names for remove and replace. Replace uses POS customer search
(`Screen.Search` with the customer scope, **TO VERIFY**).

### 3.9 Verification in Shopify (through the OMS)

Extend `resolveOrderQuery` and `OmsShopifyOrderDetail`:

- `returns { id status returnLineItems { quantity returnReason returnReasonNote fulfillmentLineItem { lineItem { id } } } }`
- `refunds { id createdAt refundLineItems { quantity restockType lineItem { id } } transactions { gateway kind amountSet } }`
- `customer { id }` (already read; expose on the detail for the customer case)

Then extend the verifiers:

- `verifyReturnedOrder`: per line, refundable delta (exists), `returnReason` equals the configured reason, `restockType` is `RETURN` when restock is on and `NO_RESTOCK` when off, refund transaction gateway equals the refund method.
- `verifyExchangedOrder`: replacement lines (exists), net transaction direction and amount within bound, customer id matches the `keep`/`remove`/`replace` choice.

Correlation is by the source order gid (no lookup needed), so no new bridge
operation is required.

---

## 4. Ledger, fixtures, rehearsal, reset

- Ledger: unchanged. Commit attempt before the committing tap, `confirmed`
  only after read-back matches, otherwise `needs-reconciliation`.
- Fixtures: each cash sale is returnable once per line after the OMS fulfils
  it. HCDEV#5855 to HCDEV#5860 (two lines each, $171.00) are available;
  HCDEV#5859 has no confirmed ledger entry but is a valid fixture. Make new
  fixtures with `pos.create-cash-order`, then wait for `Fulfilled`.
- Rehearsal: `pos.return-rehearsal` performs 3.1 to 3.4 and then `Clear cart`,
  so the sheet, panel and cart labels can be tuned without spending fixtures.
- Reset: extend `posReset.clearCartAndReturnHome` as in 1.7. Keep the
  after-spec reset (`POS_RESET_AFTER_SPEC`) for both new scenarios.
- Speed: the return sheet costs about 10 taps; keep every wait at one
  command per poll (`wait.ts`), and read cart labels once after each change.

---

## 5. Discovery still needed (walker commands)

Start each walk with POS on Home and an empty cart (`pos.navigate-home`,
`pos.clear-cart`). Post to `/api/runs/start` with `scriptId`
`pos.inspect-walk`, `assertionMode` `pos`, `expectedRevision` from
`/api/health`, and `parameters.steps` as below. Add `allowLabels` for exactly
the committing-looking labels you intend to tap. Captures land in the run's
artifacts as `NN-<capture>.xml/.png`.

1. **Cash refund surface**: steps up to `Refund $120.00` (allow it), then
   `Cash, Original payment` (allow). Capture only; identify the confirm
   control and whether it needs a further tap. Then Back / Clear cart.
2. **Collect exchange label**: return the jacket (51), add the shirt (120)
   via `Add exchange items`, Back, Done; capture the cart control label.
3. **Even exchange completion**: with the even cart, tap `Complete exchange`
   only after 1 is understood; this one commits.
4. **Variant exchange item**: after `Add exchange items`, search the jacket,
   tap the product row, then the inner add button of
   `~Screen.VariantList.ProductVariantListItem.44342252404900`; confirm a
   `SharedCart.LineItem.*` appears.
5. **Customer remove/replace**: needs a fixture placed with a customer
   (`pos.create-cash-order` has no customer support yet; place one by hand
   or add the planner's customer to the sale flow first).
6. **Unfulfilled order**: capture the disabled Return or exchange wrapper on
   a fresh sale before the OMS fulfils it, to lock the *expect blocked* check.

---

## 6. Implementation order

1. Contracts and validation: `ReturnReason` enum, per-line `reason`/`note`,
   `refundMethod`, `collectMethod`, `customer`, replacement fields
   (`core/safety/transaction-inputs.ts`, `test/scenarios/registry.ts`,
   `shared/transaction.ts`, unit tests).
2. Planner UI (`ui/pages/Pos.vue`, `ui/pos-plan.ts`, cart store reuse for
   replacements, direction preview). Unit tests for the plan builder.
3. OMS read-back fields and verifiers (`core/oms/queries/documents.ts`,
   `core/oms/client.ts`, `core/runner/bridge.ts` bounded copy,
   `core/verification/order.ts`, tests).
4. `test/screens/pos-return.ts` routines for 3.1 to 3.4, plus reset support;
   `pos.return-rehearsal` spec, registry, catalog; run it on HCDEV#5860.
5. Discovery items 1, 2, 4 above; then 3.5 to 3.7 routines.
6. `ReturnOrderDriver` and spec (`test/specs/return-cash-order.spec.ts`
   replacing `mutation-not-ready.spec.ts` for `pos.return-cash-order`); live
   proof on one fixture; ledger confirmed.
7. `ExchangeOrderDriver` and spec; even, refund and collect proofs.
8. Customer cases after discovery item 5.

Acceptance for each case: a passing run whose `summary.json` shows
`effect: confirmed`, a `shopify-order` (and `shopify-return`) resource, and a
read-back that proves every configured choice (quantity, restock, reason,
refund method, replacement lines, net amount, customer).
