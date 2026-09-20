# OMS read adapter contract

Status: **observed against the configured test instance; credentials and
business identifiers intentionally omitted**.

Observed: 2026-09-20, `test-maarg.hotwax.io`, using the existing company-app
local session configuration in memory. No credential, token, shop ID, order ID
or customer data is stored in this document.

## Authentication

The test instance reports BASIC login through:

```text
GET  /rest/s1/admin/checkLoginOptions
POST /rest/s1/admin/login
GET  /rest/s1/admin/user/profile
GET  /rest/s1/admin/user/permissions
POST /rest/s1/admin/logout
```

Observed login request body:

```json
{"username":"<runtime value>","password":"<runtime value>"}
```

The successful response contained `token`, `api_key` and `expirationTime`.
The adapter uses the returned bearer token in memory only. Passwords and tokens
must never enter the browser, repository, process arguments, logs or exported
run evidence. A sidecar restart clears the session.

Observed authorization behavior for the shop-list route:

| Request | Result |
| --- | --- |
| Missing bearer token | HTTP 403 with `errorCode`/`errors` |
| Invalid/expired bearer token | HTTP 401 with `errorCode`/`errors` |
| Authenticated user | HTTP 200 |

The app must preserve these distinctions. Authentication and permission errors
are not empty search results and are not retried as transient failures.

## Shopify shop reads

```text
GET /rest/s1/sob/shopify/shops
Authorization: Bearer <runtime token>
```

The configured user received an array of two shops. A shop record can contain
the connector's shop ID, Shopify shop ID/domain/name, primary location,
currency, timezone, plan name and related remote/configuration fields. The
desktop adapter must project only the fields needed by the UI; it must not
return connector credentials or raw remote configuration to the browser.

## Shopify GraphQL reads

```text
POST /rest/s1/shopify/graphql
Authorization: Bearer <runtime token>
Content-Type: application/json
```

The tested request shape is:

```json
{
  "shopId": "<resolved OMS shop ID>",
  "queryText": "<compiled named read query>",
  "variables": {}
}
```

The live response contained `statusCode`, `cost` and `response`. The connector
places Shopify data under `response`; the adapter must not assume a direct
Shopify `{data: ...}` envelope.

An invalid/non-approved shop identifier produced HTTP 400 with an error shape.
This is a useful fail-closed signal, not proof of cross-user shop isolation.
Task 5 must still verify that a valid shop belonging to another permitted
context cannot be read by this session before enabling the data browser.

## Adapter rules

The browser can call only named operations such as `searchVariants`,
`searchOrders`, `listLocations`, `resolveReference` and `verifyOrder`. It cannot
submit arbitrary GraphQL text, a connector remote ID, or a user-selected URL.
The sidecar resolves the selected OMS shop, validates the operation document,
enforces read-only GraphQL AST rules, bounds pagination and normalizes the
connector response.

The effective Shopify API version for this instance remains unverified. The
local connector source inspected during planning defaults to `2026-01`; the
runtime must report the actual version or mark it unknown rather than silently
assuming compatibility with current public documentation.

## Live read verification

On 2026-09-20, the adapter authenticated against `https://test-maarg.hotwax.io`
using the company app's local runtime credentials in one ephemeral process.
The password and bearer token were not printed, stored or copied into this
repository. The process returned two Shopify shops, 20 locations, 25 variants
and 25 orders on the first page from the selected shop; following the returned
cursors returned another page for both variants and orders. The process logged
out before exit. This proves the verified
BASIC login and named read envelope for this account, not mutation permission
or POS shop/location identity.

## OMS order reads for return/exchange planning

The same authenticated session can read the OMS order model directly. These
routes are separate from Shopify Admin GraphQL: a Shopify order GID is not
assumed to be an OMS `orderId`.

```text
GET /rest/s1/oms/orders?pageSize=25&pageIndex=0&orderTypeId=SALES_ORDER&orderByField=-orderDate
GET /rest/s1/oms/orders?orderId=<exact OMS order ID>&dependentLevels=1
GET /rest/s1/oms/orders/<exact OMS order ID>
```

The list route returned 25 records per page. `pageIndex=1` and `pageIndex=2`
returned distinct subsequent pages during live verification. Exact `orderId`,
`orderName`, and `externalId` filters were accepted. The detail route returned
an `orderDetail` object with ship groups and item fields including
`orderItemSeqId`, `productId`, `quantity`, `shippedQuantity`,
`returnableQuantity`, `alreadyReturnedQuantity`, `unitPrice`, and facility or
status identifiers.

The desktop adapter projects only order identifiers, status/date/total, product
identifiers, quantities, prices, facility IDs, and backend-provided returnability
fields. Customer names, email addresses, addresses, payment details, raw
connector configuration, and unrecognized fields are not sent to the browser.
Missing `returnableQuantity` stays unavailable; the toolkit does not infer
eligibility by subtracting quantities. These reads inform a future POS return
or exchange workflow but do not enable or perform a mutation.
