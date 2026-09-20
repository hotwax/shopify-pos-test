# iosTesting

Standalone HotWax Shopify POS testing toolkit for a physical iPad. This is its
own monolithic repository and application; it is **not an AccxUI app**, does not
join the AccxUI workspace, and does not require AccxUI to build or run.

The target application is one Node process started from this repository. It
serves the Ionic/Vue browser interface and its localhost API, then owns the
Appium/WDA test runner, OMS reads, local run history and safety checks. Shopify
POS stays the unmodified App Store app. Only the separate open-source
WebDriverAgent (WDA) helper is built and signed.

**Status: the standalone localhost shell, setup wizard, script catalog,
read-only run history, OMS browser and Shopify POS planning page are
implemented.** The scripted Home → Orders → first order test has passed on a
real iPad. The native test reads accessibility identifiers and order text
through WDA; it does not need Device Hub, image recognition, Shopify source
code or Shopify POS binaries. Create/return/exchange cards currently collect
reviewable inputs and explain their safety gates; they remain blocked until
native POS context and transaction selectors are verified on the target build.

## Start the application

The normal teammate workflow is `./run.sh` from this repository's root:

1. Open **Finder**.
2. Press **Command+Shift+G**.
3. Enter `~/Documents/GitHub/iosTesting` and press **Return**.
4. Right-click the `iosTesting` folder, choose **Services → New Terminal at
   Folder**. If that menu is unavailable, open **Terminal** with Command+Space
   and run:

   ```sh
   cd ~/Documents/GitHub/iosTesting
   ```

5. Run:

   ```sh
   ./run.sh
   ```

6. Keep that Terminal window open. The launcher checks prerequisites, builds the
   local app when needed, starts the single localhost process and opens the
   browser. Press **Control+C** in that same Terminal window to stop it.

7. In the browser, use **Get setup** to save an iPad/signing profile and run
   read-only readiness checks, **Scripts** to browse and launch checked-in
   scripts, and **Run history** to review accepted runs. The first GUI script
   is deliberately read-only: it opens the first existing POS order and checks
   its detail reference. The **Connections** page also supports read-only OMS
   browsing: Shopify shops, variants, Shopify orders/locations, and OMS order
   records with item-level returnability. The Shopify POS page lets a tester
   choose create/return/exchange, select the real shop/location and source
   data, and review why each mutation is blocked. POS transaction execution
   remains disabled until its separate native-context and safety checks are
   complete.

Do not start AccxUI, a separate frontend, a separate backend, or a manually
started Appium server for the finished toolkit. Xcode, iPad trust/signing,
Developer Mode, POS sign-in and any OMS login remain explicit setup steps inside
the supported workflow.

## Setup

1. Install full Xcode and its iOS support, launch it once, and select it under
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
   app derives `https://test-maarg.hotwax.io` for you. `OMS_ORIGIN` in `.env`
   is optional and only preloads one backwards-compatible local connection;
   it is not required for teammates.
5. Run `npm run doctor`. It reads host/device/signing state; it does not change
   settings, create certificates or install apps. A pass is a prerequisite
   check, not proof that WDA is provisioned or that POS automation works.
6. On iOS/iPadOS 18 and later, open a second Terminal and start Appium's
   host-side RemoteXPC tunnel registry before running native tests:

   ```sh
   sudo appium driver run xcuitest tunnel-creation
   ```

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
the bearer token in memory until logout or restart; it does not persist the
password or token. The page stores only recently used OMS names and HTTPS
origins in browser local storage so a teammate can return to an instance
without retyping its URL. No arbitrary GraphQL text, Shopify mutation or POS
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
