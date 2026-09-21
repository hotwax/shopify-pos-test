# Compatibility and evidence matrix

Updated: 2026-09-20.

| Area | Observed | Status / consequence |
| --- | --- | --- |
| Mac runtime | Node 26.4.0, npm 11.17.0 | Supported local baseline |
| Xcode | 27.0 (27A266a) | Supported local baseline |
| iPad | iPad Pro 11-inch (3rd generation), iPad13,4, iPadOS 27.0 | Paired; Developer Mode enabled |
| Shopify POS | 11.14.0 (505086) | Read-only selectors verified |
| WDA/Appium | WDA 16.12.9, Appium 3.7.0, XCUITest 12.12.6 | Fresh read-only native diagnostics pass when the iPad is unlocked; the runner fails closed when it is locked and never changes device security or automation settings |
| POS smoke | Home → Orders → first row → matching detail | Passed on physical iPad |
| POS store-context diagnostic | Observed More-menu header format exposes store, location and plan; parser drops staff identity | Implemented and unit-tested; current live rerun awaits the RemoteXPC tunnel |
| OMS login | `test-maarg.hotwax.io`, BASIC login | Live contract observed; credentials remain runtime-only |
| OMS profile/permissions | Profile and permissions routes returned HTTP 200 | Live contract observed |
| OMS Shopify shops | Authenticated shop list returned two records | Live contract observed; field projection required |
| OMS Shopify location mapping | First shop returned 24 OMS mapping rows, 20 Shopify locations and 15 matching IDs; exactly one remote location named `Brooklyn` had exactly one matching OMS mapping. Second shop returned one mapping row, but its Shopify location GraphQL read returned HTTP 400 | Live read observed; the POS `Brooklyn` location is correlated to the working shop for diagnostics, but native shop identity is still unresolved and cannot be substituted |
| OMS GraphQL facade | Named variant/order/location reads plus exact Shopify order-detail read returned connector envelope with `response`/`cost` for the working shop; the second configured shop returned HTTP 400 for all three named reads | Live read observed; no arbitrary GraphQL or mutation is exposed; the second shop remains unavailable for target mapping |
| Shopify POS planning UI | Workflow chooser, OMS-scoped shop/location/variant/order reads and exact identity display | Implemented locally; selections never change POS state |
| Missing/invalid OMS auth | Missing token 403; invalid/expired token 401 | Fail-closed behavior confirmed |
| POS active shop/location identity | Location `Brooklyn` read from POS Settings and correlated to one working-OMS mapping; native Shopify shop GID not independently read | Mutation gate remains blocked until native shop identity and approved target policy are proven |
| Cart precondition | Current native cart surface was visible, but empty-cart state was not proven; checkout was absent and Add to cart was disabled | Diagnostic failed closed with `effect: not-started`; no cart repair or mutation was attempted |
| Returns/exchanges | First observed order showed a disabled Return or exchange action; no completed mutation performed | Native mutation screens/selectors and real-device proof remain unavailable; GUI stays fail-closed |
| Transaction policy | Explicit `testOnly` target loader, exact-ID validation, cash-only direction checks, coordinator acknowledgement before commit, sanitized worker inputs, runner mutation guards and confirmed/unknown effect states are unit-tested | Safety foundation exists; it is not evidence that a live target is approved |
| POS Pro and staff permissions | Not fully characterized | Exchange capability gate remains open |

## Scope rules

This matrix describes this Mac/iPad and this target instance only. It is not a
claim that every teammate's device, POS version, OMS deployment, shop, location,
language or layout is supported. The setup UI must fingerprint the relevant
versions and turn unknown combinations into an actionable blocked state.

The current source checkout is standalone. AccxUI was used only as a read-only
reference for the OMS auth protocol; no AccxUI package, workspace or runtime
dependency is required by this project.
