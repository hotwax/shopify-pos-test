# iosTesting

Standalone HotWax Shopify POS testing toolkit for a physical iPad. This is its
own monolithic repository and application; it is **not an AccxUI app**, does not
join the AccxUI workspace, and does not require AccxUI to build or run.

The target application is one Node process started from this repository. It
serves the Ionic/Vue browser interface and its localhost API, then owns the
Appium/WDA test runner, OMS reads, local run history and safety checks. Shopify
POS stays the unmodified App Store app. Only the separate open-source
WebDriverAgent (WDA) helper is built and signed.

## Quick Start

### 1. Before you start
* **Xcode 27 or later.** Install or update it from the Mac App Store, then open it once.
* **Node.js 20.19+, 22.12+ or 24+.** Install it from [nodejs.org](https://nodejs.org) or run `brew install node`.
* **An iPad** with Shopify POS installed and signed in to your test store.

### 2. Start the app
Open **Terminal** in the folder where you cloned this repository, then run:

```sh
./run.sh
```

`./run.sh` installs the dependencies, builds the app, starts it on
`http://127.0.0.1:8127` and opens it in your browser. If the app is already
running, it opens the running copy.

### 3. Follow the Onboarding pages
The app checks your Mac, your iPad and your OMS login. Every check that fails
tells you what to do next. Some steps need your Mac password or a tap on the
iPad. The app never changes Apple security settings for you.

This path needs no `.env` file, and you do not need to open Xcode.

### 4. Stop the app
Press `Control + C` in the Terminal window that runs `./run.sh`.

---

## Advanced: command-line setup

Use these steps only to run tests from Terminal with `npm run doctor` or
`npm run test:*`. Those commands read the iPad from a local `.env` file, not
from the profile saved in the app.

1. Install full Xcode 27 or later and its iOS support, launch it once, and select it under
   Xcode Settings → Locations → Command Line Tools. Use a Node version matching
   `package.json` (Node 24+ recommended).
2. Connect an unlocked iPad over USB, trust the Mac, enable Developer Mode on
   the iPad, and complete any required restart. Install Shopify POS from the
   App Store and sign into your intended test store yourself. If Apple's
   **Enable UI Automation** setting is required on your device, enable it
   yourself under Settings → Developer before testing. The toolkit never opens
   Settings, toggles Developer Mode/UI Automation, changes trust, installs
   unrelated apps or dismisses security prompts.
3. In Xcode Settings → Apple Accounts, add your Apple account. Under Manage
   Certificates create an Apple Development certificate. A free Personal Team
   can be used for the proof; its provisioning must be renewed periodically.
   Your iPad and Mac do not need matching iCloud accounts.
4. Run `npm ci`. Copy `.env.example` to `.env` and fill in the physical iPad
   UDID, Xcode team ID, and your own unique reverse-domain WDA bundle ID.
   `xcrun devicectl list devices` lists the devices. Never use `auto`.
   OMS is configured from the **Connections** page in the running app: enter a
   HotWax instance name (for example `test-maarg`) and your credentials. The
   app derives `https://test-maarg.hotwax.io` for you. `OMS_INSTANCE_NAME` in
   `.env` is optional and only preloads one local connection; it is not
   required for teammates. Never enter an OMS URL in `.env` or the UI.
5. Run `npm run doctor`. It reads host/device/signing state; it does not change
   settings, create certificates or install apps. A pass is a prerequisite
   check, not proof that WDA is provisioned or that POS automation works.
6. On iOS/iPadOS 18 and later, open a second Terminal in this repository
   folder and start Appium's host-side RemoteXPC tunnel registry before
   running native tests:

   ```sh
   sudo env "PATH=$PATH" node node_modules/appium-xcuitest-driver/scripts/tunnel-creation.mjs
   ```

   This runs the driver's tunnel script directly. Do not start it with
   `sudo npx appium ...`. That makes Appium's cache folder belong to root, and
   every later test run then fails.
   Complete the Mac authorization if prompted and leave this Terminal running.
   This is a host transport prerequisite, not an iPad setting; the toolkit
   only checks whether the local registry is available and never starts it or
   asks for your password.
7. Open WDA with `npx --no-install appium driver run xcuitest open-wda`. Select
   WebDriverAgentRunner, the connected iPad and your signing team. Use the
   bundle ID from `.env`, automatic signing, then Product → Test. Complete
   signing and developer-trust prompts yourself. Follow the official
   [WDA provisioning guide](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/provisioning-profile/).
   If launch reports “Developer App Certificate is not trusted”, open iPad
   Settings → General → VPN & Device Management → Developer App, choose your
   account and trust it. Reopen Shopify POS on Home before testing. Do not ask
   the toolkit to repair or toggle any of these settings.

The dependencies and driver are project-local; no global Appium installation is
needed. Each teammate keeps their own `.env` and signing keys outside Git. Do not
export keys, passwords, profiles or Shopify credentials into this project. The
OMS page supports the verified BASIC login mode and named, read-only shop,
variant, Shopify order/location, and OMS order/detail reads. The sidecar keeps
the bearer token in memory until logout or restart and never writes the token to
disk. A password is stored only when you explicitly tick **Remember this
connection** on the OMS page: it is encrypted with AES-256-GCM under a key held
in your macOS login Keychain and written to `.runtime/oms-credentials.json`
(mode 0600, gitignored). The file alone is useless without your Keychain, and you
can remember as many instance/user pairs as you like. Remembered connections sign
in automatically when the server starts, so a normal start needs no login; a
locked Keychain, a changed password or an OMS that is down degrades to a manual
login rather than blocking startup. **Forget** deletes a stored password
immediately. Anyone who can unlock your Mac account can use a remembered
connection, so do not remember a production credential.

The iPad setup page can also save a Shopify POS staff PIN for each iPad. Test
runs type it when POS shows its staff PIN screen. It is stored the same way as a
remembered OMS password: encrypted with its own key in your macOS login Keychain,
in `.runtime/pos-pins.json` (mode 0600, gitignored). It never goes into a run's
input file, the environment, or the logs. **Delete PIN** removes it. It does not
sign POS back in when the whole store is signed out.

The page stores only recently used OMS instance names in
browser local storage and reconstructs their HTTPS origins when selected, so a
teammate can return to an instance without retyping its URL. No arbitrary
GraphQL text, Shopify mutation or POS
transaction workflow is exposed yet.

Mutation policy is deliberately separate from OMS login. A maintainer must
create a local `config/test-environments.json` from
`config/test-environments.example.json`, replace every placeholder with a
reviewed test-store/shop/location identity, and keep `testOnly: true`. The
policy contains no passwords or tokens and is not a substitute for proving the
live POS shop/location identity; until that native proof and mutation-screen
inspection are complete, the transaction UI remains blocked.

## Commands and safety

```sh
npm test
npm run test:unit
npm run typecheck
npm run build
npm run start
npm run doctor
npm run test:orders
npm run test:inspect
npm run test:inspect-cart
npm run test:inspect-product-search
npm run test:inspect-order-actions
npm run test:inspect-return-surface
npm run test:return-home
npm run test:inspect-location
npm run test:inspect-store-context
npm run test:script -- --id pos.open-first-order
npm run dev
```

`npm run dev` is for maintainers who want Vite hot reload. It starts the local
Node API sidecar on port 8128 and the browser UI on port 8127. Teammates should
normally use `./run.sh`, which builds stale UI assets and starts the one local
host on port 8127.

The test begins with POS already on Home, no blocking dialog and at
least one order in the current Orders list. It preserves filters/sort, opens the
first actual order and checks its detail reference. It leaves that detail open;
return POS to Home yourself before each rerun. It must fail for a wrong starting
screen or empty list, not create business data to repair the precondition.

`npm run test:inspect` is a read-only diagnostic. It reads the current native
accessibility tree through WDA and saves `current-screen.xml` and
`current-screen.png` under that run's local artifacts. It performs no tap,
navigation, reset, alert dismissal or iPad-settings action, so it is the safe
first command when documenting a new Shopify POS screen or version.

`npm run test:inspect-product-search` is also read-only with respect to store
data. It uses the observed Home search control, opens the product-search
surface, verifies that exactly one native search field is visible, and saves
the accessibility tree and screenshot. It does not type, select, add or price
an item; return Shopify POS to Home yourself before another workflow.

`npm run test:inspect-order-actions` is a read-only returns/exchanges
diagnostic. It uses the existing Home → Orders → first-order smoke, captures the
current order-detail accessibility tree and screenshot, and requires exactly
one visible `Return or exchange` action. It never taps that action or opens a
return/exchange flow; inspect the captured evidence before adding any mutation
selector.

`npm run test:inspect-return-surface` is the next read-only discovery step. It
requires the observed `Return or exchange` action to be visible, enabled and
hittable, opens that surface without selecting a line or tender, and saves its
accessibility tree and screenshot. It never commits a return or exchange. The
diagnostic may leave POS on the opened surface; return POS to Home yourself
before another run and inspect the local artifact before changing selectors.

`npm run test:return-home` is an explicit navigation utility for that case. It
selects the observed native Home tab when POS is on another screen, verifies
or closes the observed read-only Search/order-detail surface first, then
captures a local accessibility snapshot. It does not reset, reinstall or
relaunch POS, dismiss alerts, change filters, or change store data. Business
scripts still fail when started away from Home.

`npm run test:inspect-location` is a read-only target-context diagnostic. It
uses the observed More → Settings navigation, records the current
`Screen.Settings.LocationsItem` label, captures local XML/PNG evidence, and
returns POS to Home. It does not toggle screen lock, change the location,
logout, or modify store data.

### Cash-sale building blocks

`pos.create-cash-order` is assembled from small reusable routines rather than
one long script, so a later place-order-then-exchange flow can chain the same
pieces:

- `test/screens/pos-cart.ts` adds one line by exact Shopify id.
  `addSingleVariantItemToCart` expects the product tap itself to add the cart
  line; `addMultiVariantItemToCart` expects the tap to open
  `Screen.VariantList` and then chooses the exact variant id. `addItemToCart`
  dispatches on the line's planned `variantSelection` and, when the plan is
  `unknown`, watches which surface POS opens and reports it. A plan that
  disagrees with what POS opened fails closed with the operator action named.
- `test/screens/pos-checkout.ts` bounds the cart total from the checkout
  control, opens checkout, selects Cash and takes the exact amount. On POS
  11.14.0 tapping the exact-amount chip completes the sale by itself; Apply is
  only pressed when the surface stays open. `finishReceipt` then closes the
  `Screen.CheckoutComplete` receipt surface (Done, never Email or Text) and
  requires Home with an empty cart, so the next sale or a chained exchange
  starts from the same state. Each run writes `cash-sale.json` with the
  tendered amount and, per line, the planned and observed variant path.
- `test/flows/cash-sale.ts` chains them: `buildCart` → `readBoundedCartTotal`
  → `payExactCash`, or `createCashSale` for all three. `payExactCash` takes a
  `beforeCommit` hook that runs after the amount is verified and right before
  the irreversible tap.
- The spec records the sale in the coordinator's business-effect ledger. It
  records the commit attempt in `beforeCommit`, reads the newest order
  reference from the POS Orders tab (read-only, newest first), correlates it
  to one exact Shopify order through the coordinator's OMS bridge, reads that
  order back, checks the lines and cash tender, then records the order as a
  `shopify-order` resource and confirms the effect. A failure after the
  attempt ends in `needs-reconciliation`, never in a clean "failed". Both
  launchers (`server/index.ts` and `scripts/dev.ts`) wire the bridge handlers;
  without them the run cannot confirm and is reconciled.

Speed of a run rests on four decisions, all measured on the iPad:

- One Appium server per local host (`core/runner/appium-server.ts`), started
  on the first run. With `useNewWDA: false` the XCUITest driver keeps
  WebDriverAgent alive on the iPad after a session ends and reuses it for the
  next one, which only works while the server that launched it is still
  running. Each run copies its own byte range of the shared server log into
  its artifact log, so failure classification and step logs are unchanged.
- One lookup per poll in the screen objects. The device is quick to act; the
  cost was asking it three or four questions per tick. `assertEmptyCart` reads
  five attributes instead of twelve, waits use `waitForDisplayed` or a single
  predicate query, and the after-payment check is Home plus a disabled
  checkout control.
- The sale is correlated through the OMS, not the POS Orders tab: the one POS
  order created since the commit time with the tendered total and line count
  (`resolveRecentPosOrder`). Shopify still verifies it through the OMS
  read-back before the effect is confirmed.
- Screenshots only on the success path; the accessibility XML is captured by
  the failure hook when something goes wrong.

`pos.inspect-walk` is the read-only discovery walker: it captures the current
POS surface, then performs the requested taps or typing one step at a time
(`steps[].selector`, optional `type`, optional `tap: "coordinate"`), capturing
after each. It refuses any control whose label reads like a committing action
unless that exact label is listed in `allowLabels`. It leaves POS where it
stops; run `pos.navigate-home` and `pos.clear-cart` afterwards. The returns
and exchanges plan in `docs/superpowers/plans/2026-09-21-returns-and-exchanges.md`
records what it found.

`appium:waitForIdleTimeout` is in seconds; it is 2. `useFirstMatch` is on so
single-element lookups return their first match. Mutation scenarios run
`posReset.clearCartAndReturnHome()` after the spec, pass or fail, and record
the outcome in `reset.json`. `pos.build-cart-only` rehearses the cart phase
with the standard two-line fixture and clears the cart without paying, so
timing work does not create orders.

The planner decides `variantSelection` while the order is built, from
Shopify's `hasOnlyDefaultVariant` and `variantsCount` (read through the OMS
proxy), shows it on each cart line and freezes it into the run parameters. A
product with only its default variant is `single`; one with several variants
is `multi`; unread facts, or a product with exactly one non-default variant,
are `unknown`. See `shared/variant-selection.ts`.

Only one iPad/worker is used. No app reset, reinstall, forced restart, automatic
alert acceptance, whole-test retries, checkout, refunds or order modifications.
Normal Xcode test orchestration is used for WDA, not direct preinstalled-runner
launch. Appium listens only on `127.0.0.1`.

Run the command from this project's directory. Leave the iPad unlocked and do
not interact with it during a test. Stop any manually started Appium server on
port 4723 first; WebdriverIO starts and stops its own local server.

### Troubleshooting a run

- **Wrong starting screen / blocked Home:** close any detail/modal, tap Home,
  then rerun. The test deliberately does not repair that state for you.
- **No loaded order rows:** check the current filters/search and network in
  POS yourself. The test preserves them, waits up to 20 seconds, then fails.
- **Unrecognized reference / missing native control:** inspect this POS
  version before updating `test/screens/pos.selectors.ts`. Do not substitute
  fixed coordinates or hardcode an order number.
- **Not authorized for performing UI testing actions:** stop the run, complete
  the required Apple setting/trust action yourself, then start a fresh run. The
  toolkit reports this as a blocked prerequisite; it does not toggle the
  setting or attempt to repair access.
- **Xcode says “Unlock iPad to Continue”:** unlock the iPad yourself and leave
  it awake on Shopify POS Home, then start a fresh run. The toolkit does not
  enter a passcode, wake the device, or alter its security/automation state.
  Setup checks use CoreDevice's read-only lock-state query, and the runner
  repeats that check before starting Appium/WDA. The run is recorded as
  **blocked**, with this user-owned action, rather than being treated as a
  generic test failure.
- **Signing/profile expiry:** renew WDA provisioning through Xcode using your
  own account; no Shopify binary or signing certificate is needed.

The row parser currently supports the observed English combined label
`order reference • customer, date, status, amount`. It preserves custom order
prefixes/suffixes, but fails closed for other label formats (including an
unverified no-customer format). Such a failure is a selector-maintenance task,
not a reason to change an order. Native list scrolling is capped at ten upward
gestures; a list farther from its beginning fails rather than looping forever.

## Signing troubleshooting

`security find-identity -v -p codesigning` must list a valid development identity.
If Xcode shows a certificate but the command lists zero, inspect the certificate
chain rather than deleting/recreating keys. Apple Development certificates need
the current WWDR intermediate; get it only from
[Apple's certificate authority page](https://www.apple.com/certificateauthority/).
Use default trust settings, not “Always Trust”. See
[Apple's intermediate certificate guidance](https://developer.apple.com/support/expiration/).

## Privacy and verification

`.env`, dependencies, WDA build caches, logs and `artifacts/` are gitignored.
Screenshots and UI source can contain customer data. Keep evidence local, review
it before sharing, and remove it yourself when no longer needed; there is no
automatic upload or retention cleanup. Low-verbosity automation logs reduce
routine payload logging but should still be treated as potentially sensitive.

Unit tests prove configuration and reference-parser behavior, not POS behavior.
A typecheck or successful WDA build does not prove navigation works. Failure
screenshots and native XML are saved under `artifacts/failure-<timestamp>/`;
capture failure never replaces the original test failure.

### Verified setup (2026-09-19, America/Chicago)

- Node 26.4.0, npm 11.17.0, Xcode 27.0 (27A266a).
- Appium 3.7.0, XCUITest 12.12.6, WDA 16.12.9; dependencies locked.
- Connected iPad13,4 on iPadOS 27.0; Shopify POS 11.14.0 (505086).
- 40 catalog/configuration/reference/runner/HTTP-policy tests and TypeScript
  check passed; the production UI build passed.
- Independent read-only review found no required fixes and independently
  passed all 29 unit tests, typecheck and missing-configuration validation.
- Missing current Apple WWDR intermediate was repaired using Apple's official
  G3 certificate with default trust. A valid development identity now exists.
- WDA build-for-testing and strict code-signature verification passed. After
  the user trusted the developer certificate, Appium established a session and
  read the POS Home accessibility tree. Enabling UI Automation, then starting
  a fresh WDA test process, resolved the authorization failure. Native Orders
  navigation, list-scoped scrolling, first-row selection and matching detail
  reference were verified. No Device Hub or coordinate taps were used.
- POS's deep native tree requires snapshotMaxDepth 62 (the supported maximum);
  the default 50 truncated the actual order rows. A no-match search exposed
  the loading/empty UI; the search was cleared after inspection.
- The underlying direct WDIO smoke passed twice on the physical iPad (20.3s and
  21.8s scenario durations). The selected first row's reference matched the
  independently scoped order detail title; the final direct run left it open.
- After routing the CLI through the durable coordinator, two fresh attempts
  were blocked before the WDA session by the local RemoteXPC/port-8100 device
  transport failure. Both runs were recorded as `failed` with
  `effect: not-started`; neither changed POS or Shopify data. This is an
  environment/WDA readiness issue, not a passing coordinator device run.
- A later coordinator retry was run after the precondition classifier was
  added. The locked iPad was recorded as `blocked` with `effect: not-started`
  in 24 seconds; the run left no owned Appium, WDIO or Xcode build process
  behind. The runner did not unlock the iPad or change any Apple access
  setting.
- A separate live read-only safety check passed: rejected an order-detail
  starting screen, deliberately mismatched detail reference and a no-results
  search. Search was cleared and Home restored before the final normal run.
  Failure capture produced both local PNG and XML during the negative checks.
- Current live dataset: two rows, English UI, landscape iPad layout. Long-list
  scrolling, other languages/layouts and other empty-state variants are not
  live-verified. Unsupported structures fail instead of guessing taps.

### Implementation decisions

- Read the order reference from the row's combined accessibility **label**;
  it is not a separate element. Unexpected formats fail closed.
- Set snapshot depth to 62 to expose the POS rows.
- Keep Appium server logs at INFO because the WDIO service waits for its INFO
  startup line; ERROR-only logs caused readiness detection to time out. WDIO
  command logging remains silent. Treat the local Appium log as sensitive.
