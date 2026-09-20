# HotWax POS Testing Localhost Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Status:** review draft. No implementation, dependency installation, device
mutation, OMS configuration change or deployment is authorized by this document.

**Goal:** Let HotWax teammates set up a Mac/iPad, select named tests and real
Shopify data, run approved test-store POS workflows and inspect truthful results
from a browser app served on localhost.

**Architecture:** One standalone Node application serves the Ionic Vue UI and
named HTTP/SSE API from localhost in normal use. It owns local profiles/run
journals, an OMS-mediated read-only Shopify adapter, and one WDIO/Appium/WDA
runner. Keep the existing CLI and native POS test helpers. A developer-only
supervisor can start Vite with the Node host for hot reload; teammates use the
root `./run.sh` command, which starts the one-process local host.

**Tech Stack:** Vue 3, Ionic Vue, Vite, TypeScript, Node HTTP/Fastify (selected
and locked in Task 2), Vue Router, Pinia, JSON Schema/Ajv, decimal.js for
monetary comparisons, existing WDIO/Mocha/Appium/XCUITest/WDA, Node test runner,
Vitest/Vue Test Utils and Playwright browser tests against localhost. Exact new
versions are selected/locked in Task 2, not asserted compatible in advance.

**Spec:** [product and technical specification](../specs/2026-09-20-pos-testing-desktop-design.md).

## Global Constraints

- First release: approved development/test stores only; real card payments blocked.
- One active run and one explicitly selected iPad per Mac. No parallel device farm.
- OMS API access is read-only; business actions under test happen in POS.
- Mutating scenarios require POS + Shopify verification.
- No automatic mutation retries or rollback.
- No POS binary building/re-signing, POS reset, silent cart clearing or automatic alert acceptance.
- Preserve `npm run test:orders`, the existing smoke semantics and native-selector preference.
- Credentials never enter Git, manifests, process arguments, runner environment or ordinary logs.
- Unknown device/shop/location/tender/eligibility blocks mutation before commit.
- New POS selectors require actual native-screen inspection; no invented IDs/coordinate fallback.
- The browser UI talks only to a loopback sidecar API; it never receives Node privileges or talks to Appium directly.
- `./run.sh` is the normal teammate entry point from the repository root; it owns dependency/bootstrap checks, local-host startup and cleanup.
- `npm run dev` is maintainer-only Vite development mode; `npm run build` is finite and never starts a server.
- The sidecar binds to `127.0.0.1` only, rejects unapproved Host/Origin values, and uses a per-launch local session token for state-changing routes.
- Product code changes occur only after spec/plan approval; backend changes/deployments require their own scope.
- Each delivered slice requires real-device or real-OMS evidence appropriate to its claim.

## Review Focus

1. An OMS URL/login redirect, cached picker page or shop switch must never send
   credentials/selections into a different environment. Owned by Tasks 5–6.
2. A changed manifest/source revision, duplicate SKU, Product ID mistaken for
   Variant ID or paginated order line must not execute a different intent than
   the user reviewed. Owned by Tasks 2, 5–7.
3. A double Run, second CLI process, stale lock, reused PID or occupied port must
   not produce two runs or kill unrelated processes. Owned by Task 3.
4. A timeout/crash/Stop immediately after a commit tap must retain uncertainty
   and must not replay the sale/refund/exchange. Owned by Tasks 3, 6–9.
5. A partially returned or mixed-tender source order, changed tax/discount total
   or absent POS Pro/staff capability must fail safely, not substitute a different
   workflow. Owned by Tasks 5, 8–9.

## Delivery sequence and dependency gates

```text
1 Evidence/contracts
       ↓
2 Catalog + shell → 3 Runner/journal → 4 Setup + first GUI smoke [Slice A]
                                           ↓
                                 5 OMS/data browser [Slice B]
                                           ↓
                                 6 Transaction safety
                                           ↓
                                 7 Create cash order [Slice C]
                                           ↓
                                 8 Cash returns [Slice D]
                                           ↓
                                 9 Three exchange paths [Slice E]
                                           ↓
                                10 Local-host pilot [Slice F]
```

Task 1 has separate read-only GUI, OMS and mutation-context evidence gates.
If OMS/context evidence is unavailable, proceed through the independent GUI
smoke slice, but do not expose unverified data/write capabilities as working.
This is a program broken into releasable slices, not a request to scaffold all
features at once. No time estimates imply that Apple/backend access blockers
can be solved by a fixed amount of coding.

## Proposed file ownership

| Area | Files |
| --- | --- |
| Local host | `run.sh`, `server/index.ts`, `server/app.ts`, `server/routes.ts`, `server/session.ts`, `scripts/dev.ts`, `vite.config.ts` |
| GUI | `ui/App.vue`, `ui/router.ts`, `ui/api.ts`, `ui/pages/{Setup,Scripts,ScriptDetail,Pos,Connections,Runs,RunDetail}.vue` |
| Shared contracts | `shared/contracts.ts`, `shared/script.schema.json`, `shared/run-event.schema.json`, `shared/http.schema.json` |
| Catalog | `core/catalog/{load,trust,validate}.ts`, `scripts/catalog/*.json`, `test/scenarios/registry.ts` |
| Setup | `core/setup/{checks,profiles}.ts`, retained `scripts/doctor.ts` wrapper |
| Execution | `core/runner/{coordinator,process,lock,protocol,approval}.ts`, `test/support/{reporter,context}.ts` |
| Persistence | `core/storage/{profiles,runs,artifacts}.ts` |
| OMS/data | `core/oms/{auth,client,operations,capabilities,cache}.ts`, `core/oms/queries/*.graphql` |
| Safety | `core/safety/{environment,context,intent,money}.ts`, reviewed `config/test-environments.json` |
| Native workflows | `test/screens/{context,cart,payment,returns,exchanges}.ts`, matching `.selectors.ts`, `test/scenarios/*.ts` |
| Parameters/pickers | `ui/components/{ParameterForm,VariantPicker,OrderPicker,LocationPicker,RunReview,StepTimeline}.vue` |
| Verification | `core/verification/{shopify,results}.ts`; OMS verifier added only with its verified contract |
| Tests/docs | `test/unit/*.test.ts`, `test/browser/*.test.ts`, `test/browser/*.spec.ts`, `test/specs/*.spec.ts`, `docs/contracts/`, `docs/compatibility.md` |

Preserve existing files unless a listed task requires a scoped refactor. This
application is standalone: do not link it into AccxUI's multi-app build, import
AccxUI components/composables, or require the AccxUI repository to build or run.
Use inspected AccxUI auth behavior only as a protocol reference and implement
the required adapter inside this repository.

Test-file ownership makes the task boundaries explicit:

| Task | Tests created or extended |
| --- | --- |
| 1 | Existing `test/specs/open-first-order.spec.ts`; evidence-only baseline, no replacement proof |
| 2 | `test/unit/catalog.test.ts`, `test/unit/http-policy.test.ts`, `test/unit/launcher.test.ts`, `test/browser/shell.spec.ts` |
| 3 | `test/unit/run-state.test.ts`, `test/unit/run-storage.test.ts`, `test/unit/process-ownership.test.ts` |
| 4 | `test/unit/setup-checks.test.ts`, `test/browser/setup.test.ts`, `test/browser/scripts.test.ts`, `test/browser/run-detail.test.ts` |
| 5 | `test/unit/oms-auth.test.ts`, `test/unit/oms-reads.test.ts`, `test/browser/data-pickers.test.ts`, `test/contracts/oms-read.test.ts` |
| 6 | `test/unit/transaction-policy.test.ts`, `test/unit/money.test.ts`, `test/unit/commit-checkpoint.test.ts`, `test/specs/pos-context.spec.ts` |
| 7 | `test/unit/order-verifier.test.ts`, `test/browser/pos-create.test.ts`, `test/specs/create-cash-order.spec.ts` |
| 8 | `test/unit/return-eligibility.test.ts`, `test/unit/fixture-plan.test.ts`, `test/specs/return-cash-order.spec.ts` |
| 9 | `test/unit/exchange-policy.test.ts`, `test/specs/exchange-cash-order.spec.ts` |
| 10 | `test/unit/runtime-resolver.test.ts`, `test/browser/local-host.spec.ts` |

For a pure unit file, the focused RED/GREEN command is
`node --import tsx --test test/unit/<named-file>.test.ts`; the exact names are in
the table. New UI/browser commands in the validation section own those runners.
Real-OMS contract tests stay outside the default unit glob and require explicit
test-instance configuration. Real-device specs run only with their approved
parameters and selected fixture; never include mutating cases in an unattended
default command.

## Shared contracts to establish in Task 2

These are proposed TypeScript interfaces for the build. They are not existing
exports. Use JSON Schema at HTTP/file boundaries; TypeScript alone is insufficient.

```ts
export type Effect = 'read-only' | 'create-order' | 'return' | 'exchange';
export type AssertionMode = 'pos' | 'pos-shopify' | 'pos-shopify-oms';
export type RunState = 'validating' | 'preparing' | 'running' |
  'awaiting-approval' | 'verifying' | 'passed' | 'failed' |
  'blocked' | 'cancelled' | 'interrupted' | 'needs-reconciliation';
export type BusinessEffect = 'not-started' | 'attempted' | 'confirmed' | 'unknown';
export type AssertionStatus = 'pending' | 'passed' | 'failed' | 'not-requested' | 'inconclusive';
export interface Money { amount: string; currency: string }
export interface ScriptDefinition {
  schemaVersion: 1; id: string; name: string; description: string;
  domain: string; scenario: string; scenarioVersion: number;
  parameters: Record<string, unknown>; assertionMode: AssertionMode; tags: string[];
}
export interface ScenarioDescriptor {
  id: string; version: number; effect: Effect; entry: string;
  parameterSchema: Record<string, unknown>; requiredCapabilities: string[];
  supportedAssertionModes: AssertionMode[];
}
export interface DeviceProfile {
  id: string; udid: string; teamId: string; wdaBundleId: string;
}
export interface TargetContext {
  connectionId: string; omsOrigin: string; userId: string;
  connectorShopId: string; shopGid: string; shopDomain: string;
  locationGid: string; apiVersion: string;
}
export interface RunRequest {
  scriptId: string; deviceProfileId: string;
  parameters: Record<string, unknown>; assertionMode: AssertionMode;
  expectedRevision: string; context?: TargetContext;
}
export interface RunEvent {
  protocolVersion: 1; runId: string; sequence: number; at: string;
  type: 'run-state' | 'step-started' | 'step-finished' | 'assertion' |
    'artifact' | 'approval-required' | 'business-effect';
  stepId?: string; data: Record<string, unknown>;
}
export interface RunRecord {
  id: string; state: RunState; effect: BusinessEffect; request: RunRequest;
  lastSequence: number;
  sourceHash: string; createdAt: string; resourceIds: Record<string, string[]>;
  assertions: { lane: 'pos' | 'shopify' | 'oms'; status: AssertionStatus; message: string }[];
}
export interface SetupCheck {
  id: string; state: 'unchecked' | 'checking' | 'ready' | 'action' | 'blocked' | 'unsupported';
  message: string; checkedAt?: string; actions: string[];
}
export interface Page<T> { items: T[]; nextCursor: string | null }
```

Each event type has its own closed runtime payload schema; the abbreviated
`data` type above is not permission to accept arbitrary fields. Persist
`lastSequence` with the summary and reconstruct it when replaying the journal.
Run requests from the browser contain proposed selections, not trusted identity:
the sidecar re-resolves the connection/user/shop/version and compares the proposal.

Named HTTP operations: `GET /api/health`, `GET /api/setup/devices`,
`POST /api/setup/check`, `POST /api/setup/prepare-wda`,
`catalog.list`, `catalog.get`, `catalog.savePreset`, `connections.login`,
`connections.status`, `connections.logout`, `data.searchVariants`,
`data.searchOrders`, `data.listLocations`, `runs.start`, `runs.requestStop`,
`runs.approveCheckpoint`, `runs.list`, `runs.get`, `runs.verifyAgain` and
`artifacts.exportSelected`; run events use `GET /api/runs/:runId/events` as an
SSE stream. Every handler validates Origin/session token/payload, derives trusted
filesystem/origin/entry-point values itself and returns sanitized data. No generic
`exec`, `readFile`, arbitrary URL proxy or raw GraphQL forwarder.

The browser client has one typed `ui/api.ts` wrapper for these operations. It
does not construct URLs from user input or call a sidecar route directly from
page components. The Vite development server proxies `/api` to `127.0.0.1:8128`;
local-serve mode serves the UI and API from the sidecar on `127.0.0.1:8127`.

## Task 1: Establish compatibility and unresolved contracts

**Files:** create `docs/contracts/pos-context.md`, `docs/contracts/oms-read-adapter.md`,
`docs/compatibility.md`; inspect existing doctor, capabilities and screen helpers.

**Consumes:** current real-iPad baseline; user's nominated test OMS/shop/location.
**Produces:** versioned evidence profiles for supported login/data contracts,
POS identity method, native workflow stages and supported tender/capabilities.

- [ ] Read the approved spec and current checkout/branch/dirty state. Re-run the
  existing unit/type/device smoke on a user-prepared Home screen to establish
  a baseline; preserve unrelated work and record actual runtime versions.
- [ ] Inspect candidate OMS routes from the spec against the selected deployment.
  Record login options, auth header type, canonical origin, expiry semantics,
  permitted shop listing, connector envelope and effective Shopify API version.
  Use a user-established session; do not ask for passwords in chat or persist
  authenticated payloads in documentation.
- [ ] Read-only authorization probes must cover missing token, expired token,
  known allowed shop and known disallowed shop. Reject credential forwarding
  across redirects. Check current framework authz and newer/open backend work
  before proposing a new endpoint. If unsafe/unavailable, record the exact
  backend dependency and block Task 5's live connection, not Task 4's smoke GUI.
- [ ] Inspect POS native account/location surfaces and identify an independent,
  unambiguous match to API shop/location identity. Record the selectors and
  matching rule. A display name or configured profile alone fails this gate.
  If this cannot be proved, Tasks 7–9 remain unavailable rather than guessed.
- [ ] Inspect permitted, noncommitting create/return/exchange screens on approved
  test fixtures. Record selected-line IDs, variant identity, summary amounts,
  cash tender, final irreversible actions and completion evidence. Do not finish
  a transaction merely to explore; actual transaction proof belongs to approved
  workflow acceptance in Tasks 7–9.
- [ ] Check POS Pro/staff permissions, cash/refund eligibility, downstream test
  isolation and empty-cart preconditions. Record unsupported cases explicitly.
- [ ] Commit only the sanitized contract/compatibility documents. Acceptance:
  each enabled capability has an observed contract; remaining gaps have a
  named dependent task and fail-closed UI behavior, not fabricated endpoints.

## Task 2: Typed catalog, localhost sidecar and browser shell

**Files:** create `shared/contracts.ts`, schemas, `core/catalog/{load,trust,validate}.ts`,
`test/scenarios/registry.ts`, `scripts/catalog/open-first-order.json`,
`server/{index,app,routes,session,static}.ts`, `scripts/dev.ts`, `vite.config.ts`,
`ui/App.vue`, `ui/router.ts`, `ui/api.ts`, catalog/HTTP/launcher tests; modify
package/lock/tsconfig.

**Interfaces:**
- `validateScript(input: unknown, registry: ScenarioDescriptor[]): ScriptDefinition`
- `loadCatalog(root: string): Promise<{ scripts: ScriptDefinition[]; errors: string[] }>`
- `verifyWorkspaceTrust(root: string, revision: string): Promise<boolean>`
- Browser gets immutable catalog metadata; scenario modules load only in a trusted run.
- `startLocalHost(mode: 'dev' | 'serve'): Promise<{ url: string; close(): Promise<void> }>`
- `run.sh` performs the user-facing prerequisite/build checks, then delegates to `npm run start`.
- `createApiServer(options: { port: number; mode: 'dev' | 'serve' }): Promise<ServerHandle>`
- `createLocalSession(): { token: string; origin: string; expiresAt: string }`

- [ ] Write catalog tests before implementation. Use the existing smoke definition
  as the positive fixture and actual literal assertions for negative cases:

```ts
const smoke: ScriptDefinition = {
  schemaVersion: 1, id: 'pos.open-first-order', name: 'Open first order',
  description: 'Read-only navigation', domain: 'shopify-pos',
  scenario: 'pos.open-first-order', scenarioVersion: 1,
  parameters: {}, assertionMode: 'pos', tags: ['smoke']
};
const registry: ScenarioDescriptor[] = [{
  id: 'pos.open-first-order', version: 1, effect: 'read-only',
  entry: 'test/specs/open-first-order.spec.ts',
  parameterSchema: { type: 'object', properties: {}, additionalProperties: false },
  requiredCapabilities: ['pos-native-read'], supportedAssertionModes: ['pos']
}];
assert.equal(validateScript(smoke, registry).id, 'pos.open-first-order');
assert.throws(() => validateScript({ ...smoke, schemaVersion: 99 }, registry));
assert.throws(() => validateScript({ ...smoke, scenario: '../../foreign' }, registry));
assert.throws(() => validateScript({ ...smoke, command: 'arbitrary shell' }, registry));
assert.throws(() => validateScript({ ...smoke, parameters: { extra: true } }, registry));
```

- [ ] Run `npm run test:unit`; observe failures for missing validation. Implement
  Ajv schemas with unknown-field rejection, duplicate-ID rejection, supported
  scenario/version/mode lookup and bounded payload lengths. Resolve symlinks and
  enforce realpath containment for workspace entries, schemas and artifacts.
- [ ] Add revision/trust tests: changed executable source or dependency lock,
  manifest changed after review, symlink escaping the folder, duplicate catalog
  IDs, malformed JSON and untrusted folder all disable execution. Scanning
  metadata must not import a TypeScript module or execute an install hook.
- [ ] Install/lock mutually compatible Ionic/Vue/Vite and Node HTTP framework
  packages on the task branch. Preserve existing pinned device dependencies.
  Configure Vite to proxy only `/api` to `127.0.0.1:8128` during development;
  no browser route may proxy arbitrary origins.
- [ ] Implement the sidecar bootstrap: bind API to `127.0.0.1:8128` in dev mode
  and the combined local-host port in serve mode, serve
  `/api/health`, create one per-launch session token, enforce allowed Host/Origin
  values and the custom token header, set restrictive CSP/no-store headers, and
  expose only named routes. Add PID/lock metadata so a second supervisor reports
  the existing owner instead of attaching to it.
- [ ] Implement `scripts/dev.ts` as the only two-process development launcher:
  start the sidecar, poll health with a bounded timeout, start Vite on
  `127.0.0.1:8127`, open the browser URL, forward SIGINT/SIGTERM, and terminate
  only child processes it created. In serve mode, let the sidecar serve built
  assets and API from one loopback port.
- [ ] Add an executable root `run.sh` for non-maintainers. It must resolve its
  own repository directory, check the supported Node/npm versions, run `npm ci`
  only when dependencies are absent, run the finite build when build output is
  missing or stale, then `exec npm run start -- --open`. It must print one clear
  remediation for missing Node/Xcode and never pass credentials or arbitrary
  user input into a shell command.
- [ ] Add browser launch tests proving sidebar routes render and hostile script
  names/API text are escaped. Assert browser code has no Node/child-process/file
  primitives, cross-origin requests fail, missing/invalid session tokens are
  rejected, and launcher cleanup does not kill unrelated processes.
- [ ] Create the read-only script catalog entry and a registry mapping to the
  existing spec. Do not rewrite the test into JSON steps. Verify additions are
  discoverable without executing them and invalid entries show an inline reason.
- [ ] Run unit tests, `npm run typecheck`, component tests and a localhost launch test;
  commit this independently testable catalog/shell slice. The GUI does not yet
  claim device execution until Task 3.

## Task 3: One owned runner, durable events and run history

**Files:** create `core/runner/{coordinator,process,lock,protocol}.ts`,
`core/storage/{runs,artifacts}.ts`, `test/support/{reporter,context}.ts`,
`scripts/run-test.ts`, runner/storage tests; refactor `wdio.conf.ts`.

**Interfaces:**
- `startRun(request: RunRequest): Promise<RunRecord>`; resolves when persisted/accepted, not when the test passes.
- `requestStop(runId: string): Promise<void>`
- `getRun(runId: string): Promise<RunRecord>`
- `subscribeRun(runId: string, afterSequence: number, callback: (event: RunEvent) => void): () => void`
- `makeWdioConfig(input: { runId: string; device: DeviceProfile; entry: string; artifactDir: string; port: number }): WebdriverIO.Config`
- `applyRunEvent(record: RunRecord, event: RunEvent): RunRecord`, rejecting invalid transitions/sequence/run ID.

- [ ] Add reducer/journal tests first. In particular, an interrupted committed
  action may never be reduced to safe cancellation:

```ts
const record: RunRecord = {
  id: 'run-test', state: 'running', effect: 'attempted',
  request: { scriptId: 'pos.create-order', deviceProfileId: 'test-ipad',
    parameters: {}, assertionMode: 'pos-shopify', expectedRevision: 'revision-a' },
  sourceHash: 'revision-a', createdAt: '2026-09-20T00:00:00Z',
  lastSequence: 3, resourceIds: {}, assertions: []
};
const event: RunEvent = {
  protocolVersion: 1, runId: 'run-test', sequence: 4,
  at: '2026-09-20T00:01:00Z', type: 'run-state', data: { state: 'interrupted' }
};
assert.equal(applyRunEvent(record, event).state, 'needs-reconciliation');
assert.equal(applyRunEvent(record, event).effect, 'unknown');
```

- [ ] Observe RED, then implement validated transitions, append-only events,
  durable business checkpoints and atomic summary writes. Test truncated final
  journal records, corrupt summary/index recovery, disk-full failure before
  commit, malformed/oversized events and a child exiting zero without a result.
- [ ] Implement exclusive run/device ownership shared by CLI and GUI. Tests
  launch two harmless real child processes, race starts, simulate stale locks
  and reused PIDs, and occupy the chosen port. Assert only the owned process
  tree is stopped and no second worker starts. These process tests do not
  substitute for the later real-device acceptance.
- [ ] Snapshot trusted inputs/source and generate one worker configuration with
  argument arrays, minimal environment, loopback Appium, owned ports and run-local
  artifact paths. Reject unsafe path/config overrides. Preserve all existing
  no-reset/no-alert/zero-whole-test-retry protections and depth 62.
  Test an explicit source inclusion list: `.env`, signing assets, credentials,
  other runs and unrelated checkout files must never enter the snapshot.
- [ ] Use WDIO lifecycle hooks/custom reporter for versioned child-process events. Map the
  existing smoke steps to readable labels. Capture failures without replacing
  the original error. Never infer business success solely from process exit.
- [ ] Test cooperative stop before action, forced stop of a hung owned child,
  app restart with unfinished run, no replay after restart, and event replay
  after browser reload. Check that raw stdout/stderr is bounded/redacted.
- [ ] Retain `npm run test:orders`; route it through the same coordinator/lock as
  GUI execution. Add a general `npm run test:script -- --id <catalog-id>` command
  with the same policy checks, not a GUI-only guard.
- [ ] Run unit/type checks and the existing iPad smoke from Home through the
  new coordinator. Verify preserved POS data, exact detail match and process/port
  cleanup. Commit after both CLI and structured result agree.

## Task 4: Setup wizard, scripts and run UI — first usable GUI release

**Files:** `core/setup/{checks,profiles}.ts`, `core/storage/profiles.ts`,
`ui/pages/{Setup,Scripts,ScriptDetail,Runs,RunDetail}.vue`, shared UI components,
setup/browser tests; modify `scripts/doctor.ts`, sidecar routes and README.

**Interfaces:**
- `listDevices(): Promise<{ udid: string; name: string; model: string; os: string }[]>`
- `runSetupChecks(profile: DeviceProfile): Promise<SetupCheck[]>`
- `prepareWda(profile: DeviceProfile): Promise<void>` with progress events and user-owned prompt handling.
- `saveDeviceProfile(profile: DeviceProfile): Promise<void>`; scoped atomic local persistence.

- [ ] Write tests for missing/full-Xcode distinction, missing identity, multiple
  iPads without a selection, untrusted/locked device, unsupported OS, WDA launch
  denied, and invalidated checks after switching device/toolchain. A “next” click
  must not turn a failed probe into Ready.
- [ ] Extract bounded command-based checks from doctor without changing them
  into automatic repairs. Keep `npm run doctor` as a human-readable wrapper over
  the same results. Add WDA launch/native-query checks beyond signing validity.
- [ ] Build the eight setup steps in the spec using Ionic components, with
  persistence, one suggested action, expandable diagnostics and correct Back
  behavior. Apple passwords/trust confirmations stay in Apple's own UI.
- [ ] Implement script filtering/detail/configuration and run views from real
  catalog/coordinator events. Add Stop wording that distinguishes “requested”
  from “stopped” and warns that stopping does not undo a transaction.
- [ ] Add browser tests for keyboard navigation, focus/error announcements, loading/
  empty/error distinctions, offline state, clipped content boundaries and
  browser restart/reload reconnecting to the current run. Use desktop-sized Ionic
  lists/split navigation, not stretched phone screens.
- [ ] Run the GUI on the actual Mac: select the iPad, complete readiness, open
  the smoke by name, run it from Home and inspect a matching detail/result.
  Exercise a wrong-start failure and verify local artifacts are linked.
- [ ] Run CLI parity, unit/type/component/shell tests. Record actual evidence and
  commit Slice A. Do not require OMS login to run this read-only script.

## Task 5: OMS connection and real Shopify data browsing

**Gate:** Task 1's authenticated/scoped target-instance contract is verified.
**Files:** `core/oms/{auth,client,operations,capabilities,cache}.ts`, query documents,
`ui/pages/Connections.vue`, three pickers, OMS/HTTP/component tests,
`docs/contracts/oms-read-adapter.md`.

**Interfaces:**
- `loginConnection(profileId: string, credentials: { username: string; password: string }): Promise<{ userId: string; expiresAt: string }>`
- `logoutConnection(profileId: string): Promise<void>`
- `getConnectionStatus(profileId: string): Promise<{ state: string; capabilities: string[] }>`
- `searchVariants(context: TargetContext, input: { search: string; cursor?: string }): Promise<Page<{ gid: string; productGid: string; title: string; sku: string | null }>>`
- `searchOrders(context: TargetContext, input: { search: string; cursor?: string }): Promise<Page<{ gid: string; name: string; eligible: boolean; reason?: string }>>`
- `listLocations(context: TargetContext, input: { cursor?: string }): Promise<Page<{ gid: string; name: string }>>`
- `resolveReference(context: TargetContext, input: { kind: 'product' | 'variant' | 'order' | 'location'; id: string }): Promise<{ gid: string; label: string }>`

- [ ] Write pure transport/auth-policy tests first: canonical origin handling,
  HTTPS enforcement, no cross-origin redirects, no token to a changed host,
  expired session, unauthorized shop, 403, 429, GraphQL errors in a 200 response,
  partial data and unknown API version. Test no credential-bearing logs/exports.
- [ ] Implement only the verified login adapter; secrets stay in main memory,
  optional OS-encrypted storage with session-only fallback on unavailable
  encryption. Unsupported SSO/legacy types show a clear supported-mode message.
  Never auto-try credentials against guessed endpoint/origin combinations.
- [ ] Implement named GraphQL reads using reviewed query documents, variables
  and AST checks. Enforce query-only operation type, maximum page size and bounded
  variables. Reject arbitrary mutation text, multiple ambiguous operations and
  raw caller-supplied remote credential IDs. Normalize the OMS `response` envelope.
- [ ] Validate each query against the target API schema and then execute permitted
  read-only contract tests on the real test OMS. Verify missing/disallowed token
  requests do not expose data. A mock transport test is not this acceptance gate.
- [ ] Build connection status and searchable pickers. Tests cover stale response
  arrival after connection/shop switch, pagination, duplicate SKU, wrong ID type,
  Product ID requiring variant choice, inaccessible older order and nested line
  pagination. Never map permission/network failure to “no orders.”
- [ ] Implement scoped picker cache and clear it on logout/user/shop change.
  Revalidate exact selected IDs and returnable quantities before run preparation.
- [ ] Demonstrate real shop/product/order/location browsing without Shopify
  credentials on the Mac. Commit Slice B only after the instance contract passes;
  otherwise publish the exact blocker in the UI and keep Slice A usable.

## Task 6: Environment policy, frozen intent and commit safety

**Gate:** reliable native POS shop/location proof from Task 1.
**Files:** `core/safety/{environment,context,intent,money}.ts`,
`core/runner/approval.ts`, `ui/components/RunReview.vue`, `test/screens/context.ts`,
reviewed environment policy, unit and real-device context tests.

**Interfaces:**

```ts
export interface TransactionIntent {
  scenario: string; sourceHash: string; udid: string; context: TargetContext;
  originalOrderGid?: string;
  returnLines: { lineGid: string; quantity: number; restock: boolean }[];
  purchaseLines: { variantGid: string; quantity: number }[];
  tender: 'cash'; expectedDirection: 'collect' | 'even' | 'refund';
  maximumAbsoluteAmount: Money;
}
export interface PosContextEvidence {
  udid: string; shopGid: string; locationGid: string; observedAt: string;
  method: string; evidenceHash: string; online: boolean;
}
export declare function exchangeDirection(netDue: Money): 'collect' | 'even' | 'refund';
export declare function assertAllowedIntent(intent: TransactionIntent,
  evidence: PosContextEvidence, approvedTargets: TargetContext[]): void;
export declare function hashIntent(intent: TransactionIntent): string;
export declare function approveCheckpoint(runId: string, intentHash: string): Promise<void>;
```

- [ ] Write literal monetary tests and policy rejection cases before code:

```ts
assert.equal(exchangeDirection({ amount: '10.00', currency: 'USD' }), 'collect');
assert.equal(exchangeDirection({ amount: '0.00', currency: 'USD' }), 'even');
assert.equal(exchangeDirection({ amount: '-10.00', currency: 'USD' }), 'refund');
assert.throws(() => exchangeDirection({ amount: 'NaN', currency: 'USD' }));
```

- [ ] Add tests for unapproved test-looking domain, production shop, wrong POS
  location/UDID, stale context, offline POS, modified source/intent after approval,
  replayed approval, different currency and actual amount beyond the approved
  bound. Include card/mixed-original-tender rejection and existing-cart rejection.
- [ ] Observe RED; implement reviewed allowlist binding, decimal comparisons,
  intent canonicalization/hash, one-use approvals and context freshness checks.
  Effect type comes from the trusted scenario registry, never a JSON badge.
- [ ] Implement native context readback strictly using Task 1's observed method.
  If identity is ambiguous, return Blocked before any mutation. Test a real
  mismatch by configuring a different expected approved target without changing
  store data; assert that no transaction action is invoked.
- [ ] Add durable pre-commit checkpoint and final summary comparison. Test
  cancellation/exit at the boundary with a harmless process harness; later
  workflow tasks prove actual POS behavior. Prevent new approval from reviving
  an already attempted unknown transaction. `recordCommitAttempt` resolves only
  after the coordinator has durably flushed and acknowledged the checkpoint.
  Assert that journal failure, lost worker protocol and missing acknowledgement
  prevent the irreversible tap, not merely log an error.
- [ ] Verify GUI and CLI both call the same policy gate, and POS-only assertion
  mode is refused for a mutating scenario. Commit after unit/type/context proof.

## Task 7: Create one cash order from the GUI

**Files:** `test/scenarios/create-order.ts`, `test/screens/{cart,payment}.ts` and
verified selector modules, `scripts/catalog/create-cash-order.json`,
`ui/pages/Pos.vue`, parameter form, `core/verification/shopify.ts`, matching tests.

**Interfaces:**
- `CreateOrderParameters = { lines: { variantGid: string; quantity: number }[]; customerGid?: string; maximumTotal: Money; note?: string }`
- `createCashOrder(parameters: CreateOrderParameters, context: ScenarioContext): Promise<{ orderGid: string; orderName: string }>` through the scenario context/checkpoint API.
- `verifyShopifyOrder(context: TargetContext, orderGid: string, expected: CreateOrderParameters): Promise<{ passed: boolean; checks: { name: string; passed: boolean }[] }>`
- Define the following `ScenarioContext` in `test/support/context.ts` before the
  workflow consumes it. Its correlation request goes over owned worker IPC to
  the sidecar read adapter. The worker receives sanitized identities, not
  an OMS token or arbitrary network proxy.

```ts
export interface ScenarioContext {
  step<T>(name: string, operation: () => Promise<T>): Promise<T>;
  requireApproval(intent: TransactionIntent): Promise<{ intentHash: string }>;
  recordCommitAttempt(intentHash: string): Promise<void>;
  recordResource(kind: string, gid: string): Promise<void>;
  checkStopped(): void;
  resolveObservedOrder(input: {
    observedName: string; runMarker?: string;
  }): Promise<{ orderGid: string; orderName: string }>;
}
```

`resolveObservedOrder` uses the frozen target context and a compiled read
operation, validates an exact unique match and rejects ambiguity. Do not claim a
GID was obtained directly from a POS screen that exposed only an order number.

- [ ] Write the real-device scenario test first with exact resolved variant IDs,
  quantities and a capped approved total. Run to an explicit missing-behavior RED
  after setup/context passes; do not create an order via API to fake a green UI test.
- [ ] Implement observed native selection: search resolved products, distinguish
  variants by verified identity, verify cart line quantities, read POS totals,
  select cash, pass the frozen-intent checkpoint and commit once. Unknown UI,
  different tender or total requires stop/review. Do not send receipts by default.
- [ ] Capture the real order identity from verified UI/API correlation. Re-read
  exact Shopify resource to assert lines, quantities, currency, amount, location
  evidence and tender. An ambiguous match is needs-reconciliation, not a success.
- [ ] Add the GUI configuration/review path and JSON template. Save and reopen a
  named configuration; IDs remain scoped, environment bindings remain local.
- [ ] On the approved store, prove one normal run and one fresh repeat fixture.
  Test wrong-product/changed-price precommit rejection without committing. Test
  uncertain-result handling through an instrumented boundary test; any deliberate
  real-device interruption requires a specifically approved disposable fixture.
- [ ] Show separate POS and Shopify outcomes, record resulting IDs and no automatic
  deletion. Run all regression checks and the original smoke; commit Slice C.

## Task 8: Eligible cash returns and fixture reuse rules

**Files:** `test/scenarios/return-order.ts`, `test/screens/returns.ts` and selectors,
`scripts/catalog/return-cash-order.json`, `core/verification/results.ts`, fixture
selection/UI extensions and return tests.

**Interfaces:**
- `ReturnParameters = { orderGid: string; lines: { lineGid: string; quantity: number; restock: boolean }[]; reason?: string; maximumRefund: Money }`
- `returnCashOrder(parameters: ReturnParameters, context: ScenarioContext): Promise<{ orderGid: string; affectedIds: Record<string, string[]> }>`
- `readReturnEligibility(context: TargetContext, orderGid: string): Promise<{ eligible: boolean; reasons: string[]; lines: { lineGid: string; remaining: number }[]; tender: string }>`

- [ ] Write tests for partial/full quantities, already-returned units, unfulfilled/
  ineligible lines, foreign-shop line IDs, mixed/card tender, missing permissions,
  pending returns and stale eligibility. A return line belongs to the exact source
  order, not merely the same product SKU.
- [ ] Build eligibility reads from the verified target schema; fully paginate
  relevant lines and surface exact reasons. Do not infer refundable quantity from
  original quantity alone or label “paid” as sufficient eligibility.
- [ ] Write the live return scenario RED against an explicitly approved cash
  fixture; implement native order selection, selected-line/quantity/restock
  summary, safe cash refund checkpoint and exact return/refund readback.
- [ ] Prove partial and full eligible returns with separate fresh fixtures,
  restock choice behavior and repeated-run rejection after consumption. Verify
  any asserted stock change at the actual processing location; external activity
  must make a noisy inventory delta inconclusive, not automatically a regression.
- [ ] Keep the source/affected IDs and effect status on failures. “Create fixture
  then return” must be explicitly selected, journal both stages and never hide
  the created fixture when stage two fails. Add a local execution-plan record
  `{ id, stages: [{ scenarioId, runId, dependsOnRunId? }] }` linking two complete
  `RunRecord`s; each retains its own approval/checkpoint/effect. Test stage-one
  success plus stage-two block, stop between stages, and no automatic replay on
  restart. Commit Slice D after real evidence.

## Task 9: Equal, collect-difference and refund-difference exchanges

**Files:** `test/scenarios/exchange-order.ts`, `test/screens/exchanges.ts` and
selectors, three catalog templates, exchange forms and amount/eligibility tests.

**Interfaces:**
- `ExchangeParameters = ReturnParameters & { replacements: { variantGid: string; quantity: number }[]; direction: 'collect' | 'even' | 'refund'; maximumDifference: Money }`
- `exchangeCashOrder(parameters: ExchangeParameters, context: ScenarioContext): Promise<{ sourceOrderGid: string; affectedIds: Record<string, string[]>; netDue: Money }>`

- [ ] Test all three net directions, zero/negative formatting, currency precision,
  taxes/discounts changing direction, unsupported bundles, no POS Pro, missing
  staff permission and source order with an active return. Expected direction
  mismatch must block before final commitment, not switch scenario automatically.
- [ ] Write each real-device exchange case RED on a separately approved eligible
  fixture. Implement the actual combined return/exchange flow observed in Task 1,
  not a standalone guessed Exchange button. Share existing return/cart helpers
  only where observed UI behavior is truly the same.
- [ ] Compare POS's final balance to the selected case and approved amount;
  authorize only cash collection/refund or verified zero-balance completion.
  Capture all affected records rather than assuming one original-order mutation.
- [ ] Verify return lines, replacement lines, quantities, currency, actual cash
  direction/amount and linked resource IDs through native/API evidence. Test
  cancellation before commit and uncertain-result classification separately.
- [ ] Run the equal/higher/lower real-device matrix and consumed-fixture checks;
  all earlier smoke/order/return tests remain green on separate fixtures. Record
  tested Pro/location/POS versions and commit Slice E.

## Task 10: Local-host team pilot and operator documentation

**Files:** `scripts/dev.ts`, `server/static.ts`, runtime compatibility matrix,
onboarding/troubleshooting docs, `test/browser/local-host.spec.ts`, `test/unit/runtime-resolver.test.ts`;
update README, package scripts and lockfile only as required.

**Interfaces:** `resolveRuntime(): { node: string; appium: string; wdaCache: string }`;
`startLocalHost(mode: 'dev' | 'serve'): Promise<{ url: string; close(): Promise<void> }>`;
the launcher returns only the loopback URL and never exposes credentials or
child-process arguments to the browser.

- [ ] Test runtime checks first: supported Node version, Apple Silicon, checkout
  path with spaces, missing `npm ci`, missing Xcode, unavailable WDA cache,
  expired provisioning, denied native prompt, occupied UI/API/Appium ports and
  stale supervisor lock. A missing prerequisite must produce an actionable setup
  result, not a partially started runner.
- [ ] Implement `npm run build` as a finite browser/server build that writes the
  static assets and compiled sidecar resources without starting a server, Appium
  or WDA. Implement `npm run start` as the one-process local-serve mode on
  `127.0.0.1:8127`, serving the UI, `/api` and SSE routes from the sidecar.
- [ ] Keep editable WDA projects/DerivedData in per-user caches; never modify the
  repository's built assets at run time, load `.env` into the browser bundle,
  reuse another user's profiles, or download executable code on a test run.
- [ ] Run browser/local-host tests and the real test suite on a second clean Mac
  and iPad. The pilot tester follows only the GUI/help: install Node/Xcode,
  clone the approved checkout, run `npm ci`, launch `npm run dev`, complete
  trust/signing/POS setup, create a saved script and inspect a completed run.
  Record where assistance was required and fix those onboarding gaps.
- [ ] Exercise USB disconnect, browser close/reload, sidecar crash/reopen, stale
  run record, occupied ports and unavailable OMS. Prove no auto-replay, no
  attachment to another sidecar and readable recovery after reconnect.
- [ ] Demonstrate preset import/export, retained local evidence, explicit deletion
  of selected local evidence only, redacted summary export and session logout.
  Do not delete/refund created business fixtures as an implicit cleanup operation.
- [ ] Publish an exact Node/Xcode/macOS/iPad/POS support matrix and known limits.
  Run unit/type/component/browser/device checks, request independent whole-change
  review, fix blocking findings and retain evidence. GitHub publication or a
  future signed installer requires Aditya's separate instruction; the local-host
  pilot is not an authorized public release.

## Future-domain extension contract

Transfers, sales fulfillment and BOPIS reuse the catalog, parameter forms,
environment policy, run journal and verification lanes. Each adds its own native
or API driver only after the actual surface and authority are chosen. Do not
assume all three are Shopify POS UI workflows.

Before implementing a domain, specify the source/destination locations or
fulfillment order, item-level quantities, allowed state transitions, stock and
notification effects, irreversible checkpoint and independent expected result.
If a workflow needs an OMS/Shopify mutation rather than a POS tap, introduce an
explicit effect/permission policy in its separate spec; the current read-only
data adapter does not quietly gain write powers.

Optional OMS integration verification likewise requires the actual deployed
read contract and correlation mapping. It must be independently rerunnable and
must not trigger synchronization jobs as a hidden recovery action.

## Validation commands and evidence policy

Current commands to preserve: `npm run test:unit`, `npm run typecheck`,
`npm run doctor`, `npm run test:orders`.

Proposed additions owned by the indicated tasks:

| Command | Added in | Purpose |
| --- | --- | --- |
| `npm run dev` | 2 | Start the loopback sidecar, Vite UI and browser together |
| `npm run build` | 2 | Build finite browser/server assets without starting processes |
| `npm run start` | 10 | Serve built UI/API from the local Node sidecar |
| `./run.sh` | 10 | Idiot-proof teammate bootstrap and one-process local-host launch |
| `npm run test:ui` | 2 | Vitest component/UI contract tests |
| `npm run test:browser` | 2–4 | Playwright localhost shell/API/workflow tests |
| `npm run test:script -- --id <id>` | 3 | Same catalog/coordinator as GUI |
| `npm run test:oms-contract` | 5 | Explicitly configured real-instance read-only validation |
| `npm run check:runtime` | 10 | Validate local Node/Xcode/WDA prerequisites |

These commands do not exist yet. For each implementation task, run the smallest
test first and observe its intended failure, implement the change, then run its
whole affected suite before committing. Do not count setup failure as behavioral
RED or simulator/mock success as actual POS/OMS acceptance.

Every release record includes exact checkout/revision, versions, device profile
reference (not keys), selected test environment, assertions requested, actual
effects/resource IDs and remaining unverified cases. Customer-containing live
evidence stays local and ignored; sanitized summaries can be committed.

## Spec coverage and review handoff

| Spec requirement | Tasks |
| --- | --- |
| Setup for non-specialists | 1, 4, 10 |
| Named JSON catalog / shared GUI and CLI | 2, 3, 4 |
| POS scenario configuration and exact ID selection | 5, 6, 7, 8, 9 |
| OMS auth and real data with credential isolation | 1, 5, 6 |
| Test-store/cash-only policy | 1, 6, 7, 8, 9 |
| Truthful outcomes, cancellation and recovery | 3, 4, 6, 7, 8, 9, 10 |
| Local evidence, reproducibility, trust and privacy | 2, 3, 5, 10 |
| Team onboarding/local-host support | 4, 10 |
| Later transfers/fulfillment/BOPIS | Future-domain contract, separate implementation approval |

Review this package as a proposed architecture and delivery sequence. Approve or
adjust the localhost/sidecar approach, scope and order before product code changes.

Recommended execution after approval: **native/in-session implementation in
small delivery slices, with an independent review at each released slice**.
This keeps tightly coupled contracts in one place without paying for a new agent
on every small task. Subagent-driven per-task implementation/review is an option
if you prefer more frequent independent review at higher coordination cost.
