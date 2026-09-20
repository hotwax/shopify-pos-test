# iosTesting

Standalone HotWax Shopify POS testing toolkit for a physical iPad. This is its
own monolithic repository and application; it is **not an AccxUI app**, does not
join the AccxUI workspace, and does not require AccxUI to build or run.

The target application is one Node process started from this repository. It
serves the Ionic/Vue browser interface and its localhost API, then owns the
Appium/WDA test runner, OMS reads, local run history and safety checks. Shopify
POS stays the unmodified App Store app. Only the separate open-source
WebDriverAgent (WDA) helper is built and signed.

**Status: the standalone localhost shell, setup wizard, read-only script catalog
and run-history UI are implemented.** The scripted Home → Orders → first order
test has passed on a real iPad. The native test reads accessibility identifiers
and order text through WDA; it does not need Device Hub, image recognition,
Shopify source code or Shopify POS binaries.

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
   its detail reference. OMS browsing and transaction workflows are added only
   after their separate safety checks are implemented.

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
   For the optional read-only OMS data browser, also set `OMS_ORIGIN` to the
   approved HTTPS origin and restart the local app after changing `.env`.
5. Run `npm run doctor`. It reads host/device/signing state; it does not change
   settings, create certificates or install apps. A pass is a prerequisite
   check, not proof that WDA is provisioned or that POS automation works.
6. Open WDA with `npx --no-install appium driver run xcuitest open-wda`. Select
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
OMS page supports the verified BASIC login mode and read-only shop, variant,
order and location reads. The sidecar keeps the bearer token in memory until
logout or restart; it does not persist the password or token. No arbitrary
GraphQL text, Shopify mutation or transaction workflow is exposed yet.

## Commands and safety

```sh
npm run test:unit
npm run typecheck
npm run build
npm run start
npm run doctor
npm run test:orders
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
