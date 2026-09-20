# Shopify POS device-context contract

Status: **read-only device baseline and POS location observation verified;
mutation identity gate remains open**.

Observed: 2026-09-20 on the configured physical iPad.

## Verified device/session baseline

- Device is paired and Developer Mode is enabled according to `xcrun devicectl`.
- Device model is iPad Pro (11-inch, 3rd generation), product type `iPad13,4`.
- iPadOS is 27.0.
- Shopify POS 11.14.0 (505086) is installed.
- Existing WDA/Appium setup established a native accessibility session.
- The read-only Home → Orders → first actual row → matching detail scenario
  passed after returning POS to Home.
- The read-only More → Settings → Locations observation reported `Brooklyn`
  and returned POS to Home without changing the location or other store data.

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

The current POS location is independently observable as `Brooklyn`. The working
OMS Shopify shop returned exactly one Shopify location named `Brooklyn` and one
matching OMS mapping, so the location correlation is strong enough for
diagnostics. This does **not** prove the native POS Shopify shop GID, and a
selected GUI shop/location or remembered device profile is not proof. Mutation
workflows remain disabled until the native shop identity, location, approved
test-store policy and mutation-screen preconditions are independently
correlated.

## Live OMS cross-check

On 2026-09-20, an ephemeral authenticated read against the configured test OMS
listed two shops. The read included both the OMS Shopify-location mapping
endpoint and the reviewed Shopify location GraphQL read:

- The first shop returned 24 OMS mapping rows and 20 Shopify locations. Fifteen
  mapping IDs matched a Shopify location ID. Exactly one remote location was
  named `Brooklyn`, and exactly one OMS mapping resolved to that location.
- The second shop returned one OMS mapping row, but its Shopify location
  GraphQL read returned HTTP 400, so its location identity could not be
  established.

The session logged out and emitted no credentials or resource identifiers. This
is evidence for the `Brooklyn` location correlation only; it is not permission
to substitute a different location or to enable mutations. The native POS shop
GID still needs an independent read.

## Live cart safety observation

The native cart diagnostic established that the cart surface was visible, but
the expected empty-cart state was not proven: the checkout control was absent
and the observed Add to cart control was disabled. The diagnostic failed closed
with `effect: not-started`; it did not tap, clear, open checkout, create an
order, or change an iPad setting. This remains a precondition for any create or
exchange run.

## Mutation observations still required

The current live order-detail observation showed a paid/unfulfilled order and a
disabled Return or exchange action. A read-only return-surface diagnostic
therefore failed closed without opening that surface. This is not sufficient to
characterize a return or exchange. The next task must inspect an explicitly
eligible test order and permitted, noncommitting screens, recording
selector/effect contracts without completing a business transaction.
