# Compatibility and evidence matrix

Updated: 2026-09-20.

| Area | Observed | Status / consequence |
| --- | --- | --- |
| Mac runtime | Node 26.4.0, npm 11.17.0 | Supported local baseline |
| Xcode | 27.0 (27A266a) | Supported local baseline |
| iPad | iPad Pro 11-inch (3rd generation), iPad13,4, iPadOS 27.0 | Paired; Developer Mode enabled |
| Shopify POS | 11.14.0 (505086) | Read-only selectors verified |
| WDA/Appium | WDA 16.12.9, Appium 3.7.0, XCUITest 12.12.6 | Existing native session works |
| POS smoke | Home → Orders → first row → matching detail | Passed on physical iPad |
| OMS login | `test-maarg.hotwax.io`, BASIC login | Live contract observed; credentials remain runtime-only |
| OMS profile/permissions | Profile and permissions routes returned HTTP 200 | Live contract observed |
| OMS Shopify shops | Authenticated shop list returned two records | Live contract observed; field projection required |
| OMS GraphQL facade | Read query returned connector envelope with `response`/`cost` | Live read observed; full operation/schema matrix pending |
| Missing/invalid OMS auth | Missing token 403; invalid/expired token 401 | Fail-closed behavior confirmed |
| POS active shop/location identity | Not independently correlated | Mutation gate remains blocked |
| Returns/exchanges | No completed mutation performed | Not implemented/verified |
| POS Pro and staff permissions | Not fully characterized | Exchange capability gate remains open |

## Scope rules

This matrix describes this Mac/iPad and this target instance only. It is not a
claim that every teammate's device, POS version, OMS deployment, shop, location,
language or layout is supported. The setup UI must fingerprint the relevant
versions and turn unknown combinations into an actionable blocked state.

The current source checkout is standalone. AccxUI was used only as a read-only
reference for the OMS auth protocol; no AccxUI package, workspace or runtime
dependency is required by this project.
