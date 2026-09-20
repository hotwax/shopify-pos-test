# iosTesting

Read-only Shopify POS smoke test for a physical iPad. HotWax owns these scripts;
Shopify POS stays the unmodified App Store app. Only the separate open-source
WebDriverAgent (WDA) helper is built and signed.

**Status: live native navigation verified; automated scenario in progress.**
WDA is built, installed and trusted. After enabling UI Automation and restarting
the WDA test process, Appium navigated Home → Orders → first order and read the
matching detail reference. The repeatable smoke scenario is being implemented.

## Setup

1. Install full Xcode and its iOS support, launch it once, and select it under
   Xcode Settings → Locations → Command Line Tools. Use a Node version matching
   `package.json` (Node 24+ recommended).
2. Connect an unlocked iPad over USB, trust the Mac, enable Developer Mode on
   the iPad, and complete any required restart. Install Shopify POS from the
   App Store and sign into your intended test store yourself.
   Also enable Settings → Developer → Enable UI Automation, as required by
   [Appium's device preparation guide](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/device-setup/).
3. In Xcode Settings → Apple Accounts, add your Apple account. Under Manage
   Certificates create an Apple Development certificate. A free Personal Team
   can be used for the proof; its provisioning must be renewed periodically.
   Your iPad and Mac do not need matching iCloud accounts.
4. Run `npm ci`. Copy `.env.example` to `.env` and fill in the physical iPad
   UDID, Xcode team ID, and your own unique reverse-domain WDA bundle ID.
   `xcrun devicectl list devices` lists the devices. Never use `auto`.
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
   account and trust it. Reopen Shopify POS on Home before testing.

The dependencies and driver are project-local; no global Appium installation is
needed. Each teammate keeps their own `.env` and signing keys outside Git. Do not
export keys, passwords, profiles or Shopify credentials into this project.

## Commands and safety

```sh
npm run test:unit
npm run typecheck
npm run doctor
# Once live selector inspection and the scenario are implemented:
npm run test:orders
```

The intended test begins with POS already on Home, no blocking dialog and at
least one order in the current Orders list. It preserves filters/sort, opens the
first actual order and checks its detail reference. It leaves that detail open;
return POS to Home yourself before each rerun. It must fail for a wrong starting
screen or empty list, not create business data to repair the precondition.

Only one iPad/worker is used. No app reset, reinstall, forced restart, automatic
alert acceptance, whole-test retries, checkout, refunds or order modifications.
Normal Xcode test orchestration is used for WDA, not direct preinstalled-runner
launch. Appium listens only on `127.0.0.1`.

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

Unit tests prove only our configuration checks. A typecheck or successful WDA
build does not prove navigation works. The actual device/app versions and live
test results will be recorded here after verification.

### Verified setup (2026-09-19, America/Chicago)

- Node 26.4.0, npm 11.17.0, Xcode 27.0 (27A266a).
- Appium 3.7.0, XCUITest 12.12.6, WDA 16.12.9; dependencies locked.
- Connected iPad13,4 on iPadOS 27.0; Shopify POS 11.14.0 (505086).
- 19 configuration tests, TypeScript check and read-only doctor passed.
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
