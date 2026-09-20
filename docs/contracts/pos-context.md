# Shopify POS device-context contract

Status: **read-only device baseline verified; mutation identity gate remains
open**.

Observed: 2026-09-20 on the configured physical iPad.

## Verified device/session baseline

- Device is paired and Developer Mode is enabled according to `xcrun devicectl`.
- Device model is iPad Pro (11-inch, 3rd generation), product type `iPad13,4`.
- iPadOS is 27.0.
- Shopify POS 11.14.0 (505086) is installed.
- Existing WDA/Appium setup established a native accessibility session.
- The read-only Home → Orders → first actual row → matching detail scenario
  passed after returning POS to Home.

The test used accessibility identifiers, predicates and native element labels.
It did not use pixel coordinates, image recognition, Device Hub, Shopify source
code or a Shopify POS binary.

## Observed native workflow

The existing helper verifies:

1. No blocking alert is present.
2. `Screen.Home` is displayed and the Home tab is selected.
3. Orders navigation reaches a loaded non-empty `Screen.OrdersScreen`.
4. The scoped Orders list is scrolled to its beginning.
5. The first row is refetched immediately before selection and its reference is
   captured from the combined accessibility label.
6. The selected reference matches the unique order-detail header.

The existing configuration preserves POS state: no reset, no forced app launch,
no automatic alert acceptance, no whole-test retries and no silent cart/filter
repair.

## Safety boundary

The toolkit may establish an Appium/WDA session for approved automated tests.
It must not open iPad Settings, toggle Developer Mode/UI Automation, alter trust,
install unrelated apps, or dismiss a security prompt on the user's behalf. If
the required setting/trust is missing, the setup UI reports the exact user
action and blocks the run until the user completes it.

No reliable native proof of the active Shopify shop identity or POS location has
been established yet. A selected GUI shop/location or a remembered device
profile is not proof. Mutation workflows remain disabled until the POS context
reader and OMS shop/location mapping can be independently correlated.

## Live OMS cross-check

On 2026-09-20, an ephemeral authenticated read against the configured test OMS
listed two shops. The read included both the OMS Shopify-location mapping
endpoint and the reviewed Shopify location GraphQL read:

- The first shop returned 24 OMS mapping rows and 20 Shopify locations. Fifteen
  mapping IDs matched a Shopify location ID; none of the Shopify locations was
  named `Commerce Next`, the sale-location label present in the captured POS
  Orders screen.
- The second shop returned one OMS mapping row, but its Shopify location
  GraphQL read returned HTTP 400, so its location identity could not be
  established.

The session logged out and emitted no credentials or resource identifiers. This
is evidence of an unresolved target mapping/connector-read issue, not
permission to substitute a different location or to enable mutations.

## Mutation observations still required

The current live order-detail observation showed a paid/unfulfilled order and a
disabled Return or exchange action. This is not sufficient to characterize a
return or exchange. Task 1 must inspect permitted, noncommitting screens and
record selector/effect contracts without completing a business transaction.
