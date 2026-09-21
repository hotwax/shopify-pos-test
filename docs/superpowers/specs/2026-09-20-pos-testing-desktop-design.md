# HotWax POS Testing Toolkit — localhost product and technical specification

Status: **implementation baseline**. The standalone localhost shell, read-only
OMS browser, script catalog, coordinator and native read-only diagnostics are
implemented; live mutation execution remains gated by the evidence listed in
the compatibility documents. Prepared 2026-09-19–20.

Companion: [phased implementation plan](../plans/2026-09-20-pos-testing-desktop.md).
Existing foundation: [verified iPad smoke test](../../../README.md).

## 1. Outcome and agreed boundaries

Give a HotWax teammate one Mac application that helps them prepare an iPad,
connect to an OMS test instance, find suitable Shopify data, choose a test,
run it against the real Shopify POS app, and understand the result.

The core journey is:

**Get Setup → Connect OMS → Choose a test → Select data → Review → Run → Inspect results.**

The same tested workflows remain runnable from the command line. The GUI is a
control panel for the existing automation stack, not a replacement device driver.
HotWax continues to test the unmodified App Store Shopify POS application.

### Confirmed by Aditya

- Work in the existing `iosTesting` project and reuse established frameworks.
- Provide guided setup, a named script library, Shopify POS scenario forms,
  and OMS login for retrieving real Shopify data.
- Cover new orders, returns, and equal/lower/higher-value exchanges.
- Accept precise product, order, and location identifiers when users have them.
- Design extension points for transfers, sales-order fulfillment, and BOPIS.
- **First release: approved development/test stores only; real card payments blocked.**
- The specification is the implementation contract; changes to the first
  release must preserve its test-store-only, cash-only and fail-closed gates.

### Recommended defaults for this review

- Localhost web application, Ionic Vue + TypeScript, with a Node sidecar that
  starts with the local development/serve command.
- One active run and one explicitly selected iPad per Mac. No parallel device farm.
- English POS UI and a documented supported layout/version matrix initially.
- Cash-only new-order tender and cash-only eligible refund/exchange balances.
- OMS API access is read-only; business actions under test happen in POS.
- First deliver a useful GUI around the existing read-only test, then add
  data access and one mutation workflow at a time.
- Begin with a verified Moqui OMS login contract; do not advertise every
  legacy OMS or SSO configuration as supported without a compatibility test.

### Not part of the first release

Production stores; real card/gift-card/store-credit processing; offline sales;
unverified returns; automatic account creation; shared cloud scheduling;
arbitrary GraphQL editing; AI-generated taps; visual test recording; a general
no-code test language; Windows/Linux; automatic deletion of business test data.
The later fulfillment/transfer workflows get separate domain specifications.

## 2. What exists, and what is still a proposal

The current checkout has the original Appium/XCUITest/WDA, WDIO/Mocha,
TypeScript, doctor command, local signing configuration, failure artifacts and
real-device Home → Orders → first-order test, plus the localhost Ionic/Vue
shell, named script catalog, run coordinator, setup page, OMS login/data
browser, read-only POS diagnostics and run history. The current proof is still
read-only: mutation workflows have safety scaffolding and planning UI, but no
live create/return/exchange transaction is claimed complete.

| Existing asset | Reuse / change |
| --- | --- |
| `scripts/doctor.ts:9–53` | Extract structured diagnostic checks; keep the CLI wrapper |
| `config/device.ts:7–40` | Reuse validation/preservation flags; accept an explicit device profile |
| `wdio.conf.ts:10–49` | Turn into a per-run configuration factory; preserve current CLI behavior |
| `test/screens/pos.ts:16–97` | Keep observed native selectors and read-only scenario as the first GUI test |
| `test/specs/open-first-order.spec.ts` | Register it in the script catalog without changing its meaning |
| Existing PNG/XML failure capture | Add run-scoped storage, privacy controls and GUI links |

No order creation, return, exchange, POS-context identification, or live OMS
authentication is claimed verified by this proposal. Those are explicit build gates.

## 3. Architecture choice

| Option | Advantages | Cost / limitation | Decision |
| --- | --- | --- | --- |
| Ionic Vue in a browser + localhost Node service | Familiar UI; reuses Node/Appium tooling; one local command can start the UI and sidecar; easy browser inspection | Requires Node/Xcode prerequisites; browser cannot itself run Xcode/Appium; localhost security boundary must be designed | **Recommended** |
| Ionic Vue + Electron | Desktop shell and managed child process lifecycle | Larger package; signing/notarization; duplicates a Node runtime; not needed while the product is intentionally localhost-only | Deferred alternative |
| Tauri + Vue | Smaller desktop shell | Introduces Rust and still needs a Node/Appium sidecar; less reuse of the proven stack | Not preferred for this team/tool |

Ionic supplies the browser interface, not physical-iPad control. The Node
sidecar is the local Mac control plane: it owns Appium/WDA, OMS sessions, run
journals and safety checks. The browser calls only the sidecar's named localhost
API; Appium/WDA still control the installed POS application.
[Ionic Vue](https://ionicframework.com/vue).

```text
Browser at http://127.0.0.1:8127: setup / scripts / POS / connections / runs
             │ same-origin JSON API + SSE run events
Node sidecar at http://127.0.0.1:8128: profiles, session secrets, catalog,
             │ run coordinator, safety policy, journals and evidence
             ├── read-only OMS adapter ── OMS Shopify connector ── Shopify GraphQL
             └── one owned runner child
                       └── WDIO → Appium → signed WDA → installed Shopify POS
```

Use Vite to serve the Ionic Vue site during development and a Node HTTP server
to serve the built site in local-serve mode. Use Fastify (or the project's
equivalent typed Node HTTP framework selected during implementation) for named
sidecar routes, JSON Schema + Ajv for manifests and request validation, decimal.js
for monetary comparisons, the existing WDIO/Mocha stack for device execution,
Node's test runner for pure/backend modules, Vitest/Vue Test Utils for components,
and Playwright against the real localhost browser site for end-to-end UI tests.
These are recommendations;
new package versions must be compatibility-tested and locked during the build.
Keep the proven Appium/XCUITest versions until a deliberate upgrade is validated.

The term “sidecar” describes the internal Node control-plane module; it is not
a second application that teammates manage. In normal `./run.sh`/serve mode,
the Node server, browser asset host, API, run coordinator and local storage run
inside one Node process. Only developer hot-reload mode introduces a Vite child
process, and the supervisor owns that process lifecycle.

The repository exposes one normal user launch command and one developer mode:

- `./run.sh` is the documented teammate command from the repository root. On
  first use it checks Node/npm, installs the locked dependencies if needed,
  builds missing browser assets, starts the one-process local host and opens the
  localhost URL. Later runs reuse the installed dependencies and start quickly.
- `npm run dev` is maintainer-only development mode: a supervisor launches the
  sidecar, waits for health, starts Vite with an API proxy, and opens the browser.
  A single interrupt stops only the processes owned by this invocation.
- `npm run build` followed by `npm run start` is the underlying local-serve mode:
  one Node process serves the static UI, `/api` routes and run-event stream from
  loopback. Ordinary users do not need to start Appium or a second terminal
  manually; Xcode, iPad trust/signing and POS login remain explicit external
  prerequisites.

`npm run build` itself remains a finite artifact-producing command; it must not
leave a server or device process running when invoked by CI. The auto-start
behavior belongs to the dev/serve launcher that runs the local app.

No new OMS database entities are proposed for local settings or run history.
Do not turn local test execution into OMS service jobs. Reuse the OMS connector
only for authenticated, authorized data access and later read-only assertions.

### Standalone repository boundary

This is a standalone monolithic application in the `iosTesting` repository. It
is not an AccxUI app, does not join the AccxUI workspace, does not import
AccxUI components/composables, and does not require another repository to build
or run. The application ships its own Ionic/Vue UI, Node server, catalog,
runner, storage and setup checks. AccxUI source may be consulted as a protocol
reference for OMS login behavior, but it is not a runtime dependency or a build
input.

In normal use, one root-level command starts one Node process that serves the
browser UI and API from localhost. The internal folders remain separated for
testability, but users do not start separate frontend/backend services or
assemble a multi-repository workspace.

## 4. Navigation and page specification

Permanent sidebar: **Get Setup, Scripts, Shopify POS, OMS Connections, Runs**.
Settings is a small utility destination, not another workflow dashboard.
A compact header shows selected iPad, OMS instance, shop and POS location. Show
each context once; use an obvious persistent “TEST STORE” indicator.

### 4.1 Get Setup

A resumable checklist with one primary next action. Each check is **Not checked,
Checking, Ready, Needs your action, Blocked, or Unsupported**. “Ready” must mean
observed success, not a user having clicked a checkbox.

Each failure explains: what was checked, the actual result, why it matters,
exact steps to fix it, and a **Check again** button. Technical output stays in
an expandable details panel with copyable sanitized diagnostics.

| Step | App verifies / helps with | User-controlled action |
| --- | --- | --- |
| 1. This Mac | Architecture, macOS, full Xcode selection/version, supported runtime, free disk space | Install Xcode, accept Apple terms, install required platform support |
| 2. Connect iPad | List real connected devices; explicitly choose and save UDID; show OS/model | Plug in USB, unlock, Trust this Mac |
| 3. Allow development | Developer Mode status; later perform actual automation probe | Enable Developer Mode, restart/confirm, enable UI Automation |
| 4. Apple signing | Detect valid identity, team/profile configuration, WDA bundle ID; explain expiry | Add Apple account in Xcode, authorize signing key and trust developer app on iPad |
| 5. Prepare helper | Build/install/start WDA using normal Xcode test orchestration; show separate build/install/launch states | Approve native Apple prompts; never type Apple/Mac passwords into the toolkit |
| 6. Prepare POS | POS installed/version, unlocked Home, compatible layout; optional read-only navigation proof | Sign into the intended test store and location in POS |
| 7. Connect OMS | Reuse OMS Connections flow; verify test shop/location binding and available read capabilities | Sign in with permitted OMS credentials |
| 8. First success | Run the existing read-only smoke and show its evidence | Keep iPad untouched during execution; return to Home for another run |

Steps 1–6 make the read-only smoke usable without OMS. Mutation scenarios also
require step 7 and verified store/payment permissions. An unavailable exchange
capability must not block someone from running the read-only smoke.

Useful actions: Open Xcode, Show instructions, Recheck connection, Retry helper
build, Test native screen reading, Open local evidence. The app does not accept
security prompts, recreate certificates, override trust, disable Gatekeeper,
change the global Xcode selection, install global packages, or reset POS silently.
Machine-changing repairs require a specific explanation and explicit user action.

Store check results with timestamps and dependency fingerprints. Changing iPad,
Xcode, signing team, POS/iPadOS version or runner version invalidates relevant
checks. Do not demand a full rebuild on every run. A valid certificate alone
does not establish a usable profile, trusted app or UI Automation authorization.

### 4.2 Scripts

List scripts by human-readable name, with domain, read-only/mutating badge,
required capabilities, compatibility, source revision and last local result.
Filter by domain, availability, name and tags. Disabled scripts explain why.

Script detail includes purpose, preconditions, parameters, expected assertions,
side effects, source file, last runs and **Configure / Run**. Users can duplicate
a configuration, save it with a useful name, export a portable JSON file, or
open the reviewed TypeScript source. Do not auto-run scripts when discovered.

Two related objects are deliberately separate:

1. **Scenario implementation:** reviewed TypeScript using WDIO/page helpers.
2. **Saved test:** JSON selecting a scenario/version, parameter values and
   assertion mode. This is what non-developers browse and manage.

The Shopify POS page and Scripts page use the same catalog and run coordinator;
they must not evolve into two independent test engines.

### 4.3 Shopify POS

Scenario cards: Open first order, Create order, Return order, Exchange—equal
value, Exchange—collect difference, Exchange—refund difference. Only implemented
and verified cards have Run enabled. Future transfers/fulfillment appear in the
roadmap, not as working controls.

The configure flow uses five steps with retained values on Back:

1. **Environment:** OMS connection → Shopify shop → expected POS location → iPad.
2. **Scenario and source:** choose a saved scenario; for returns/exchanges choose
   an eligible existing test order or explicitly create a new fixture order.
3. **Items:** searchable real variant/order-line pickers, quantities and restock
   choices; an “Enter exact ID” alternative is always available.
4. **Expectations:** expected quantities, transaction direction, currency and
   maximum approved amount; select POS-only, POS+Shopify, or later full integration.
5. **Review and Run:** plain-language action summary, exact context and affected
   records, expected money/inventory changes and evidence policy.

Mutating scenarios require POS + Shopify verification. POS-only is available
for read-only scenarios/inspection, not as a way to skip mutation reconciliation.

Create-order fields: variants and quantities; optional approved test customer;
expected POS location; cash tender; run note; amount bound. No live customer
receipt delivery by default. Create customer profiles manually/outside this release.

Return fields: original order, specific original order lines, return quantities,
reason/note where required, explicit restock yes/no per line and supported cash
refund. Do not equate “return recorded” with “refund settled.” A cash-only v1
must reject an original card/gift-card/mixed-tender order, even on a test store.

Exchange fields: return selection plus replacement variants/quantities, expected
balance direction, amount bound and restock choice. Store prices are preview
inputs; the actual POS-calculated tax/discount/refund total governs the checkpoint.
Use decimal amounts with currency, never JavaScript floating-point comparisons.

Define exchange direction as **POS final net amount due from the customer**:
positive = collect difference; zero = even; negative = refund difference. Do not
classify using catalog unit prices alone. Currency precision comes from the
supported currency definition; unknown precision/currency fails before payment.

Product IDs are not necessarily purchasable variant IDs. An entered Product GID
opens variant selection; a Variant GID resolves directly. Order name, numeric ID,
Shopify Order GID, OMS order ID, Shopify Location GID and OMS facility ID remain
distinct typed concepts. Never guess an ID namespace or assume an SKU is unique.
Resolve within the selected shop and show a human-readable confirmation.

Location selection is an **expected POS location**, not a hidden device-setting
change. If POS is at another location, stop with instructions. Returned stock
must be checked against the actual supported POS restock behavior. Shopify
documents that POS exchanges restock at the processing location; they require
POS Pro and staff return/exchange permissions. Automatic discounts have exchange
limitations, so v1 excludes complex discounts/bundles until separately proven.
[Shopify exchange behavior](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/exchange).

### 4.4 OMS Connections

Fields: HotWax instance name and credentials. The app derives the canonical
HTTPS origin (for example `test-maarg` → `https://test-maarg.hotwax.io`) and
never asks ordinary users to edit an environment file for the target URL.
Detect supported login mode before showing credentials. Show environment,
authenticated identity, expiry, permitted shops, connector/API compatibility,
and separate read-capability checks.

Use BASIC login only for a backend that advertises it. A supported browser SSO
flow must use the system browser and its real approved callback contract; do not
embed an arbitrary login page with privileged server-side forwarding. Until that contract
is verified, show “This login method is not supported yet,” not a password form.

The app signs into OMS, **not directly into Shopify**. Shopify credentials stay
on OMS. Save connection metadata locally. OMS passwords are never persisted;
keep access tokens in the Node sidecar's memory by default. The browser receives
connection status/data, never stored token values. A sidecar restart clears all
sessions in v1; an optional macOS Keychain adapter can be added only after its
native dependency and logout/rotation behavior are verified. There is no
plaintext local-storage fallback.

Switching connection, user or shop cancels in-flight reads, discards old picker
pages and selections, and invalidates pending run approval. Do not switch during
an active run. Reauthentication cannot silently resume an uncertain transaction.

### 4.5 Runs and run detail

List run time, saved-test name, environment/shop/location, device, source
revision, status and duration. A detail page provides a readable step timeline,
resolved inputs, expected/observed outcomes, relevant Shopify/OMS IDs, sanitized
logs, screenshots and native-source attachments, and a next action.

Show independent verification lanes:

- **POS execution:** the intended device workflow completed and was read back.
- **Shopify verification:** read-only API evidence matches the exact affected IDs.
- **OMS integration:** selected downstream assertions passed, failed, are pending,
  or were not requested. “Not requested” is not green.

The overall run passes only when every required assertion passed. A timeout
waiting for OMS must not turn into “POS failed” or a second order-creation attempt.
“Verify again” reruns reads only; “Run again” creates a new attempt after normal
preconditions and approval, with a duplicate/consumed-fixture warning.

Controls: Request stop, view artifacts, copy redacted summary, export selected
evidence and open related permitted Shopify/OMS record links. No automatic upload.
There is no promise of rollback or instant safe pause in the middle of payment.

## 5. Script catalog and reproducibility

Recommended repository additions:

```text
server/                     Node sidecar, named HTTP routes and process control
ui/                         Ionic Vue pages/components served from localhost
core/
  catalog/                  manifest validation and discovery
  setup/                    diagnostic checks and onboarding state
  runner/                   lifecycle, process ownership, events, approvals
  oms/                      login, supported connector adapter, data readers
  safety/                   store/device/context/payment policy
  storage/                  profiles, run journal, artifact policy
shared/                     JSON Schemas and cross-process contracts
scripts/catalog/            one committed JSON definition per named test
test/scenarios/             reviewed scenario registry and implementations
test/screens/               native POS helpers, existing code retained
test/unit/                  pure/core regression tests
test/browser/               component and localhost-browser tests
test/specs/                 real-iPad WDIO scenario entry points
docs/                       onboarding, contracts and compatibility evidence
```

Example committed definition (proposed schema, not an executable command):

```json
{
  "schemaVersion": 1,
  "id": "pos.open-first-order",
  "name": "Open the first order",
  "description": "From POS Home, open the first order in the current list.",
  "domain": "shopify-pos",
  "scenario": "pos.open-first-order",
  "scenarioVersion": 1,
  "parameters": {},
  "assertionMode": "pos",
  "tags": ["smoke", "read-only"]
}
```

Scenario registry owns parameter schema, supported assertions, requirements,
implementation entry point, effect class and compatibility. JSON cannot
downgrade a mutating handler to read-only, supply shell commands, override safety
capabilities, inject JavaScript or select arbitrary filesystem paths.

Adding a saved variant of an existing scenario means adding JSON only. Adding a
new workflow means TypeScript + registry entry + parameter schema + JSON + tests.
No bespoke Vue page is required for simple additional parameters: a small typed
field renderer covers text, IDs, integer quantities, enums, booleans and lists;
POS domain pickers remain purpose-built Ionic components, not a custom form DSL.

Test authors can select the reviewed team checkout as a **trusted workspace**.
The app reads metadata without importing executable modules, detects changed
manifests and displays newly added tests without a GUI rebuild. Before execution,
it resolves the registered entry point inside that workspace, validates schemas,
records source/lockfile hashes and uses the trusted workspace's compatible runner.
Changes to executable test code invalidate prior trust/approval for that revision.
Built-in scenarios remain available when a trusted external workspace is not selected.

Trust is explicit: TypeScript tests execute with the user's OS permissions, like
running `npm run test:orders`. Process isolation is not a sandbox for hostile
test code. Only reviewed team code may be trusted; v1 has no plugin marketplace,
automatic Git pull/install hooks, remote module loading or execution of downloaded
scripts. Renderer/JSON validation prevents accidental command injection, not a
malicious trusted developer. Unknown/new mutating code is disabled until its
declared effects and safety-check usage have been reviewed.

Team templates use logical fixture aliases. Local saved presets may contain
shop-scoped IDs but never tokens/passwords. Export defaults to aliases and omits
personal device/signing settings; explicit environment-specific exports warn that
IDs are not portable to another shop. Saving a local preset does not commit or push.

Snapshot a run's manifest, resolved parameters, scenario version, source hash,
dependency-lock hash and environment/device versions before starting. Do not
execute from mutable files that can change after review: use an immutable
run-specific code/config snapshot, or abort if the full execution input changes.
Snapshot only reviewed source/config/schema files from an explicit inclusion list;
never copy the whole checkout, `.env`, signing assets, credentials or old artifacts.

## 6. OMS / Shopify contract and reuse analysis

### Verified source-level precedents

The following were read from the actual local source. This is **not** a claim
that any chosen OMS deployment exposes these routes or grants the desired user
permission. No authenticated instance request was made for this planning task.

| Design element | Existing source / proposed delta | Verdict |
| --- | --- | --- |
| Discover login mode and BASIC login | `hotwax-maarg-util/service/admin.rest.xml:12–19`; `accxui/common/composables/useAuth.ts:90–118,229–278` | NATIVE contract precedent; localhost adapter needed |
| List connector shops | `mantle-shopify-connector/service/sob.rest.xml:50–63`, entity `co.hotwax.shopify.ShopifyShop` | NATIVE entity-list route; verify authorization and response field minimization |
| Read Shopify GraphQL using OMS credentials | `service/shopify.rest.xml:82–85`; `ShopifyHelperServices.xml:172–279` | NATIVE service; live authentication/shop authorization UNVERIFIED |
| Existing shop/location mappings | `sob.rest.xml:66–68`, `co.hotwax.shopify.ShopifyShopLocation`; fresh Shopify locations via GraphQL | NATIVE for metadata; do not equate a cached mapping with current device location |
| Cross-user/shop access isolation | Not established by inspected generic GraphQL service | UNVERIFIED; mandatory gate before enabling the data browser |
| Local settings, catalog, run history | Local application concerns, not OMS business entities | NEW local records; no OMS schema changes proposed |

Pinned source references:

- [Login routes, maarg-util `8f2f4ad`](https://github.com/hotwax/hotwax-maarg-util/blob/8f2f4ad/service/admin.rest.xml#L12).
- [Existing auth client, AccxUI `634b52a`](https://github.com/hotwax/accxui/blob/634b52a/common/composables/useAuth.ts#L90).
- [Bearer client precedent](https://github.com/hotwax/accxui/blob/634b52a/common/core/remoteApi.ts#L28).
- [Shop list route, connector `9ba5c51e`](https://github.com/hotwax/mantle-shopify-connector/blob/9ba5c51e/service/sob.rest.xml#L50).
- [GraphQL REST mapping](https://github.com/hotwax/mantle-shopify-connector/blob/9ba5c51e/service/shopify.rest.xml#L82).
- [GraphQL parameters, scope handling, credentials and response](https://github.com/hotwax/mantle-shopify-connector/blob/9ba5c51e/service/co/hotwax/shopify/common/ShopifyHelperServices.xml#L172).
- [Connector API-version default, `2026-01`](https://github.com/hotwax/mantle-shopify-connector/blob/9ba5c51e/MoquiConf.xml#L5).

### Proposed adapter boundary

For the first proven Moqui profile, candidates are:

| Operation | Source-backed candidate |
| --- | --- |
| Login options | `GET /rest/s1/admin/checkLoginOptions` |
| BASIC login | `POST /rest/s1/admin/login`, `{username,password}`; observed client expects `token, expirationTime` |
| User identity / permissions | `GET /rest/s1/admin/user/profile` and `/permissions` |
| Logout | `POST /rest/s1/admin/logout`, plus unconditional local secret/cache deletion |
| Connected shops | `GET /rest/s1/sob/shopify/shops`; request/return only needed fields |
| Shopify data | `POST /rest/s1/shopify/graphql`, `{shopId,queryText,variables}` |

The generic helper returns `statusCode`, data under `response`, and potentially
`graphqlErrors`/`cost`; do not assume the direct Shopify `{data:...}` envelope.
Use `shopId`, not a UI-supplied credential-remote ID. Bind canonical OMS origin,
authenticated user, connector shop ID, Shopify Shop GID and domain together.

The inspected route/service declares `anonymous-all`, and its read-only scope
check uses `queryText.startsWith('mutation')`. Neither is sufficient evidence
of safe user/shop authorization or a robust query-only boundary. Do not claim a
deployed vulnerability from source alone, but do not ship on an assumption either.
Test missing/expired credentials and another user's shop explicitly. Review
framework/instance artifact permissions and current/open backend work before
declaring a missing facility.

The localhost app exposes named read operations, never raw query text from the
renderer or manifests. Parse GraphQL and allow only approved query documents;
bounded variables/cursors are the only configurable inputs. If the selected
OMS lacks a safe authenticated/scoped route, block that capability and create
a separately approved connector change using native Moqui REST/service/authz
facilities. Its exact external endpoint is not invented in this spec. The
existing read-only device smoke still works while that dependency is unresolved.

Operation catalog: shop identity, permitted locations, variant search, exact
variant resolution, order search, exact order/line detail, remaining returnable
quantities/eligibility, and read-back verification. Use cursor pages of 25 and
fetch selected-order lines fully before approving quantities. Display explicit
“more results” and “could not load,” never a false empty list.

Shopify's published APIs cover [variant search](https://shopify.dev/docs/api/admin-graphql/latest/queries/productVariants),
[orders](https://shopify.dev/docs/api/admin-graphql/latest/queries/orders), and
[locations](https://shopify.dev/docs/api/admin-graphql/latest/queries/locations).
Negotiate available read scopes/fields rather than demanding broad write scopes.
Older-order access and protected customer data may be unavailable; show that
restriction rather than asking users to repeatedly retry.
[Order access constraints](https://shopify.dev/docs/api/admin-graphql/latest/objects/Order).

Minimal proposed identity query, schema-validated with the installed Shopify
validator during this design task (not executed on a store):

```graphql
query ToolkitShopIdentity {
  shop {
    id
    name
    myshopifyDomain
    plan { partnerDevelopment }
  }
}
```

`partnerDevelopment` is supporting evidence, not sole policy: an approved
non-partner test store may exist, and an arbitrary store name containing “test”
is not approval. Current public schema validation does not certify the OMS's
configured API version. The local connector default is `2026-01`; verify the
target runtime version and validate the full operation catalog against it before
release. Do not silently upgrade the OMS version for this toolkit.
[Shop identity and plan fields](https://shopify.dev/docs/api/admin-graphql/2026-07/queries/shop).

Read retry policy: bounded backoff for throttling/transient failures, respect
returned cost/retry information, default 30-second operation budget. Authentication
or permission failures are not retried as transient errors. Cache keys include
connection, user, shop, API version, query and variables; cache picker reads only.
Re-read eligibility/amount inputs before committing an action.

## 7. Test-store and transaction safety

### Environment policy

Maintain a reviewed team allowlist binding canonical OMS origin + Shopify Shop
GID/domain + allowed Shopify Location GIDs. Store policy is separate from saved
test JSON; ordinary users cannot turn a production shop into a test shop by
renaming a profile. Policy changes need maintainer review and renewed trust.
New identity/domain/location, stale evidence, offline POS, or unknown environment
blocks mutation. A diagnostic override cannot enable production writes.

Before the first write workflow ships, prove a native POS context reader that
can independently establish the current shop and location and match them to the
OMS-resolved identity. Prefer an exposed unique account/domain/location value;
if unavailable, characterize another unambiguous native/API-correlated identifier.
A manually selected GUI shop or a device profile is not proof of the live POS
account. **If identity cannot be established reliably, mutation stays disabled.**
No POS extension or access to private app storage is assumed as a workaround.

Verify the context at run preparation and again at the irreversible-action
checkpoint. Reject an existing nonempty cart or unfinished return/exchange;
never clear someone else's work. Lock device/connection selection during execution.

### Tender and effects

V1 permits only validated cash flows in allowlisted test stores. It rejects card,
terminal, gift-card, store-credit and split-tender paths, including the original
tender on a return. Never switch Shopify Payments out of test mode. Shopify's
documented POS test transaction uses cash; card readers do not process credit
card transactions while Shopify Payments test mode is enabled.
[Official test-transaction guide](https://help.shopify.com/en/manual/sell-in-person/getting-started/setup-payment-method/test-transaction).

Cash testing still creates real store records and may change inventory, reporting,
cash tracking and downstream integrations. It does not automatically imply the
Shopify API's `test` flag is true. Warn clearly; do not promise a disposable
sandbox merely because there is no real card charge. Test-store readiness also
requires confirmed isolation of downstream email, shipping, accounting and other
customer-facing integrations. The toolkit never silently reconfigures those systems.

The review screen authorizes one frozen transaction intent: exact device/shop/
location, scenario/source hash, selected lines/quantities, currency, tender,
restock settings and amount bound. Before the final POS commit, compare the actual
cart/return/exchange summary to it. If the amount/direction/items differ or were
not known at approval, request explicit review in the GUI or abort. No blind
confirmation of new dialogs; no automatic override of return rules/permissions.

Write a durable `commitAttempted` checkpoint before the irreversible tap. The
worker must await the coordinator's persisted-checkpoint acknowledgement; emitting
an event or appending to an unflushed buffer is not sufficient. Disk/persistence
failure prevents the tap. A timeout or disconnect after that point is
**outcome unknown**, not “safe to retry.”
Reconcile through the POS screen and read-only API using exact IDs/run correlation.
If the result cannot be identified uniquely, retain uncertainty for the operator.
Do not promise exactly-once business execution; UI taps have no end-to-end
idempotency guarantee. No automatic mutation retries or rollback.

## 8. Execution, cancellation and result semantics

Normal lifecycle:

```text
validating → preparing → running → awaiting-approval (only when needed)
                                    ↓
                                 running → verifying → passed / failed
```

Other terminal outcomes: **blocked** (precondition/setup issue), **cancelled**
(confirmed stopped before irreversible effect), **interrupted** (host/worker
failure outside a known commit), **needs-reconciliation** (commit outcome unknown).
Each run additionally records `not-started | attempted | confirmed | unknown`
for its business effect. A failed assertion after a confirmed order creation
must still show that an order was created.

Coordinator rules:

- One app instance owns the run lock. CLI and GUI use the same lock mechanism;
  double-clicks and competing launches produce one run, not two transactions.
- Start the selected WDIO scenario as a child with argument arrays and a minimal
  environment, never a shell-interpolated command. Do not pass passwords/tokens
  in process arguments, environment, manifests or logs.
- The runner receives scoped immutable parameters. Any later API verification
  uses the sidecar's read adapter; it need not receive an OMS token.
- Use a versioned structured event stream, sequence numbers, run ID and step ID.
  Do not scrape human-readable console strings into statuses. WDIO reporter/hooks
  supply test lifecycle; scenario steps supply business checkpoints.
- Persist ordered JSONL events and atomically replaced run-summary JSON outside
  the app bundle. Unknown protocol versions, malformed events and exit code zero
  without a valid completed result do not count as success.
- Request stop is cooperative between safe steps. If the worker is hung, offer
  Force stop with an uncertainty warning; kill only the process tree started by
  this run. Never use broad `pkill` or stop another Appium/Xcode user's session.
- After a commit attempt, stopping preserves `needs-reconciliation` until read
  evidence establishes the result. Closing the window during a run asks whether
  to keep running or request stop; app crash/restart never auto-replays a mutation.
- Reserve/manage local Appium/WDA ports per owned run, verify conflicts, and bind
  Appium to loopback. Do not silently attach to an unrelated server on port 4723.
- Use process handles plus a run ownership token, not a persisted PID alone, for
  cleanup. Handle PID reuse and stale locks after a crash.

Read-only navigation may retain the current 120-second test budget. Mutating
scenarios have explicit bounded steps and a configurable total default of five
minutes excluding time awaiting human approval. Shopify read-back defaults to
60 seconds; optional OMS propagation checks default to five minutes. These are
tool budgets, not promises about integration delivery times. A verifier can be
run again without replaying the business action.

No background queue of mutating tests in v1. A later serial suite must define
fixture dependencies, approval and consumed-order behavior before release.

## 9. Scenario contract and fixture lifecycle

| Scenario | Preconditions and input | Required result |
| --- | --- | --- |
| Open first order | POS Home, current nonempty list | Same row/detail reference; no business effect |
| Create cash order | Verified test context, empty cart, exact variants/quantities, cash capability | One completed POS order with matching lines/quantity/currency/tender; capture order identity |
| Return test order | Exact eligible cash order/lines, remaining quantity, restock choices | Exact return/refund quantities and cash amount; read back affected identities |
| Equal exchange | Eligible source lines + replacements; zero actual net balance | Expected return and replacement lines, zero collection/refund |
| Higher-value exchange | Same, actual positive balance within approved bound | Correct cash collection of difference, correct resulting lines |
| Lower-value exchange | Same, actual negative balance within approved bound | Correct cash refund of difference, correct resulting lines |

The source order must be a toolkit-created fixture or an explicitly selected and
approved test fixture. An arbitrary “latest order” is never the default mutation
target. No choosing the first product/search hit when identifiers are ambiguous.

For convenience, “Create fresh test order, then return/exchange it” is an explicit
two-stage plan. It displays both sets of effects and tracks the created-order ID
as a dependency. Failure or stop between stages leaves that order recorded, not
deleted. Default to a new fixture for repeat runs; reusing a returned/exchanged
order requires fresh eligibility checks and cannot reuse stale line quantities.
Represent this as two linked run records, each with its own intent, approval,
commit checkpoint and effect status. The parent plan summarizes both; a failed
second stage cannot overwrite the first stage's confirmed creation.

Attach a run marker through a verified POS note field when supported and approved.
Record all actual affected GIDs and relationship evidence: an exchange may involve
more than one record, so never assume it is simply an edit of the original order.
Correlation by time and amount alone is insufficient to claim success.

Shopify API reads validate device actions; they must not create/refund/exchange
the order on behalf of a failed UI test. Optional OMS assertions remain independent
and use a separately verified HotWax order/import mapping; no invented OMS API.

## 10. Local records, secrets and evidence

| Fact the toolkit tracks | Local representation | Source requirement |
| --- | --- | --- |
| A user prepares a particular iPad for testing | DeviceProfile + timestamped SetupCheck results | Setup journey |
| A user connects to an OMS instance | ConnectionProfile + protected optional token | OMS page |
| A team permits a shop/location for testing | Reviewed EnvironmentPolicy | Test-only decision |
| A named test configures a reviewed workflow | ScriptDefinition + local SavedPreset | Script library |
| An execution freezes its inputs and records progress | RunRecord + append-only RunEvents | Run page/reproducibility |
| A run creates or consumes particular test records | FixtureReference + actual resource IDs | Return/exchange repeatability |
| An assertion reports independent evidence | AssertionResult + bounded artifact references | Three verification lanes |

Use versioned JSON files and append-only JSONL initially; one coordinator writes
them. No database service/SQLite dependency is necessary for this scale. Rebuild
the lightweight history index from run summaries if it is corrupted; preserve
original events. Store under a sidecar-owned per-user data directory, not inside
the built site or committed repository. Support a user-selected artifact
directory with path containment checks and restrictive file permissions.

Retain evidence locally until the user deletes it; display disk usage and offer
explicit selected-run deletion. No silent retention cleanup. Summary exports
exclude secrets and customer data by default. Screenshots/native XML are sensitive
and are not guaranteed redactable automatically; require an explicit choice and
preview before including them in an export. Do not print raw page source or tokens
into ordinary logs. Evidence cleanup is separate from business-record cleanup.

The sidecar binds to `127.0.0.1` only and rejects non-loopback Host/Origin
headers. The browser UI and API use the same origin in local-serve mode; the
development Vite origin is the only additional allowlisted origin. Mutating and
credential-bearing routes require an unguessable per-launch local session token
in a custom header plus the expected Origin. Do not accept credentials in query
strings, URLs, process arguments or logs. A sidecar restart invalidates the
token and clears in-memory OMS sessions.

The browser has no privileged Node access: it cannot read files, spawn commands,
open arbitrary URLs or reach Appium directly. Expose named JSON endpoints and a
server-sent-event run stream, never a generic shell, file, network proxy or raw
GraphQL endpoint. Validate every request body and path against schemas; escape
all script/API content; validate external links and OMS origins; reject
credential-bearing URLs, redirects to unapproved origins and non-HTTPS remote
endpoints. Explicit local developer profiles may permit loopback HTTP, but never
production-network credential forwarding. Add a strict content security policy
to the served UI and disable caching for session/bootstrap responses.

For v1, OMS credentials and tokens exist only in sidecar memory. If persistent
sessions become necessary, implement and test a separate macOS Keychain adapter;
never fall back to plaintext storage.

## 11. Local-host support model

There is no Electron shell or desktop installer in v1. The repository is the
deliverable: each teammate installs the supported Node runtime and Xcode once,
clones the approved checkout, runs `npm ci`, and uses `npm run dev` or the built
local-serve command. The supervisor starts the sidecar and browser development
server together, waits for health, opens the local URL, and owns cleanup. A
second invocation detects the existing sidecar/session and fails with a clear
message rather than attaching to another user's runner.

`npm run build` creates browser assets only. `npm run start` serves those assets
and the API from the sidecar on loopback. Never run `npm install` during an
ordinary test. Xcode, Apple account, device trust, UI Automation and POS sign-in
remain external prerequisites.

Build WDA from a writable per-user cache keyed by toolchain/device/signing
configuration. No redistribution of this Mac's development certificate,
provisioning profile, private key, UDID or `.env`. The sidecar must not load
secrets from the browser build output.

Ship Apple Silicon first, matching the current proof; add Intel only after a
separate local-host/device acceptance pass. A “works for anyone with a Mac and
iPad” release requires a second clean Mac/iPad onboarding test, including Node
installation and local permissions, not just this developer checkout.
Windows/Linux are explicitly unsupported in v1.

Keep updates manual in v1. A later signed installer or launch agent must preserve
settings, trust, run records and compatibility, but is not required for the first
team pilot. No subscription, hosted backend or AI API is required for local GUI
execution itself.

## 12. Delivery slices and release gates

| Slice | User-visible outcome | Gate |
| --- | --- | --- |
| A. GUI foundation | Guided setup, named scripts, existing smoke, live timeline/history | Fresh GUI-driven smoke on the real iPad; CLI still passes |
| B. OMS/data | Login, permitted test shops, variant/order/location pickers, saved inputs | Real target-instance auth/scoping/version validation; no credential leakage |
| C. Cash order | Configure and create one approved test-store order from POS | Reliable POS context and cash/summary checkpoints; exact read-back, uncertain-outcome handling |
| D. Return | Select eligible fixture lines, quantity/restock controls, cash refund | Partial/full eligible cases and duplicate/consumed fixture rejection |
| E. Exchanges | Equal/collect/refund-difference workflows | Pro/permission gate and all three balance paths proven independently |
| F. Team release | Localhost checkout and novice onboarding | Second clean Mac/iPad, Node/Xcode prerequisites and interrupted-run recovery acceptance |
| Later | Transfers, sales fulfillment, BOPIS fulfillment, richer OMS assertions | Separate workflow contracts and permissions; reuse runner/catalog/data boundaries |

Do not build every screen around fake data and defer the first device connection
until the end. Each slice must provide a working end-to-end path before the next.
Slices C–E require approved test fixtures and real device evidence, not mocks.

## 13. Acceptance criteria

1. A teammate can open Terminal in the installed checkout, run `./run.sh`, and
   complete setup with actionable instructions and no routine terminal editing;
   unavoidable Apple prompts are explicit and never bypassed.
2. JSON added to the approved catalog appears by name, validates its inputs and
   runs the matching reviewed scenario without bespoke GUI changes.
3. The existing smoke passes through both CLI and GUI; missing setup is reported
   as blocked, not as a Shopify functional regression.
4. Wrong shop/location, production or unknown store, unknown tender, missing
   capability, nonempty cart and expired authentication block before mutation.
5. Data pickers use real OMS-mediated Shopify reads; exact IDs resolve within the
   selected shop; duplicate SKUs and paginated lines cannot select the wrong item.
6. Each supported create/return/exchange flow passes on a real test-store iPad,
   with exact resource/quantity/money assertions and independent API read-back.
7. Double Run, CLI/GUI contention, disconnect, application crash and Stop after
   commit never automatically repeat the mutation or report unproven success.
8. Run history survives restart; source/inputs are reproducible; credentials are
   absent from JSON, source snapshots, logs, process arguments and default exports.
9. A failed downstream assertion preserves the confirmed POS result and offers
   read-only re-verification, not another sale/refund.
10. A second teammate completes localhost setup and repeats the supported tests
    without the original developer's local keys, build caches or shell environment.

## 14. Honesty ledger and review decisions

Known open evidence gates, each with an explicit build outcome:

- No target OMS instance/user is selected in this spec. Slice B starts by
  verifying its actual auth, permissions, routes, read scopes and API version.
- Generic GraphQL access control is not established by local route declarations.
  If safe reuse cannot be proved, block it and obtain a separately approved
  backend contract/change; do not claim an authenticated facade already exists.
- Native POS shop/location identity and mutation selectors are uncharacterized.
  Slice C cannot enable writes until an unambiguous context method is proven.
- Current Pro subscription, staff permissions, test tender setup and safe
  downstream isolation have not been checked. Treat them as capability gates.
- POS mutation totals, returned quantities, record relationships and receipt
  behavior need live characterization, not inferred selectors or API-created proof.
- Schema validation performed here is not target-OMS compatibility or a live
  Shopify call. The runtime API version may differ from current public docs.
- Long lists, other languages/layouts, Intel local-host support and additional OS/POS
  combinations remain outside the verified baseline until their matrix passes.

Source-level concerns intentionally not repaired during planning: the generic
GraphQL service's anonymous declarations/string-prefix scope check; differing
OMS login transports across deployments; the existing CLI's fixed port, shared
artifact paths and console-only diagnostics. The plan isolates these boundaries
instead of silently changing unrelated backends or replacing working POS code.

### Decisions requested in this review

1. Accept Ionic Vue in the browser with an auto-started localhost Node sidecar
   as the recommended Mac delivery approach?
2. Accept the A→F sequence, with the existing read-only test as the first GUI milestone?
3. Accept cash-only, ordinary non-bundle/single-currency transaction coverage first,
   with complex payments/discounts and future domains added separately?
4. Name the first OMS test instance, approved shop/location and pilot teammate
   when implementation begins. Do not send credentials in the spec or chat.

The test-store-only rule is already confirmed. Approval of this draft does not
authorize production access, backend deployment, public publishing or business
transactions during the present planning task.
