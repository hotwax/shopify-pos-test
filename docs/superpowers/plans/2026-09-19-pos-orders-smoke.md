# Shopify POS Orders Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Run a read-only physical-iPad test from POS Home to the first displayed order and verify the matching detail screen.

**Architecture:** A local WebdriverIO runner starts Appium and its XCUITest driver. WebDriverAgent controls the separately installed App Store POS app. Screen helpers contain only verified native selectors; no custom device-control layer or Shopify binary is built.

**Tech Stack:** TypeScript, WebdriverIO/Mocha, Appium/XCUITest, Node test runner for pure helper tests, Xcode/WebDriverAgent.

**Spec:** `../specs/2026-09-19-pos-orders-smoke-design.md`

## Global Constraints

- Use a single physical iPad and one test worker.
- Preserve the installed POS app, app data, and login session.
- No POS order creation, checkout, edits, refunds, fulfillment, or settings changes.
- No Shopify/HotWax API credentials or downstream integration checks in this test.
- No custom device driver, AI runtime dependency, generic framework, or dashboard.
- Supply device and Apple signing configuration locally, outside version control.
- No GitHub publishing, global tool installation, or changes to other repositories.
- First means the first order row at the start of the current Orders list, preserving existing filters/sort.
- Selectors must be inspected through the live Appium session before the UI test can be declared implemented and verified.

## Live preflight evidence

- Repository: `/Users/adityapatel/Documents/GitHub/iosTesting`.
- Branch: `setup/pos-orders-smoke`; starting commit `d3f07d0`; no remote.
- Node 26.4.0, npm 11.17.0, Xcode 27.0 (27A266a).
- iPad is connected; POS bundle `com.jadedpixel.pos`, version 11.14.0 (505086).
- `security find-identity -v -p codesigning` reports zero valid identities.
- No installed app matches WebDriverAgent on the connected iPad.
- Therefore live Appium inspection is gated by Apple signing. Do not substitute a passing mock or the earlier HID prototype for this verification.

## Review Focus

1. Missing/ambiguous device configuration must fail before an automation session starts.
2. Missing Apple signing must produce actionable setup instructions, not an endless retry.
3. Wrong starting screen or a blocking modal must not trigger blind navigation.
4. Empty lists, headers, and stale/ambiguous order rows must not count as a successful order selection.
5. A detail screen for a different order must fail even if a detail panel is visible.

## File map

| File | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json` | Project-local pinned dependencies and npm entry points |
| `tsconfig.json`, `wdio.conf.ts` | Type checking, real-device runner, one worker, bounded waits |
| `config/device.ts` | Validate local environment and produce safe capabilities |
| `scripts/doctor.ts` | Read-only host/device/signing readiness checks |
| `test/unit/device.test.ts` | Configuration and safe-session contract |
| `test/screens/pos.selectors.ts` | Locators recorded from Appium inspection |
| `test/screens/pos.ts` | Home assertion, Orders navigation, first-row selection, detail assertion |
| `test/specs/open-first-order.spec.ts` | One human-readable smoke scenario |
| `.env.example`, `.gitignore`, `README.md` | Onboarding, privacy, commands, verified versions and results |

## Task 1: Reproducible framework and safe configuration

**Files:** create package/configuration files, `config/device.ts`, `scripts/doctor.ts`, `test/unit/device.test.ts`, `.env.example`, `.gitignore`, initial README.

**Interfaces:** `readDeviceConfig(env: NodeJS.ProcessEnv): DeviceConfig`, where `DeviceConfig` contains `udid`, `teamId`, and `wdaBundleId`. `buildCapabilities(config: DeviceConfig)` returns the iOS capabilities used by both the runner and configuration tests. Missing/invalid fields throw before Appium starts.

- [ ] Write pure configuration tests first. They must reject missing/blank UDID, malformed team ID, and missing WDA bundle ID. Test a valid configuration with literal expected capabilities, including preservation flags and absence of an `app` binary path.

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readDeviceConfig, buildCapabilities } from '../../config/device.js';

test('refuses device autodetection when UDID is missing', () => {
  assert.throws(() => readDeviceConfig({}), /IOS_UDID/);
});

test('preserves the installed app and its session', () => {
  const config = readDeviceConfig({
    IOS_UDID: '00008103-0000000000000000',
    APPLE_TEAM_ID: 'ABCDE12345',
    WDA_BUNDLE_ID: 'co.example.iosTesting.WDARunner',
  });
  const caps = buildCapabilities(config);
  assert.equal(caps['appium:bundleId'], 'com.jadedpixel.pos');
  assert.equal(caps['appium:noReset'], true);
  assert.equal(caps['appium:fullReset'], false);
  assert.equal(caps['appium:forceAppLaunch'], false);
  assert.equal(caps['appium:shouldTerminateApp'], false);
  assert.equal(caps['appium:autoAcceptAlerts'], false);
  assert.equal(caps['appium:autoDismissAlerts'], false);
  assert.equal('appium:app' in caps, false);
});
```

- [ ] Run the configuration tests and record the expected failure before implementation. Use Node's built-in TypeScript support for this initial red run if dependencies are not yet installed; resolve imports consistently with the chosen module mode.
- [ ] Add project-local dependencies and install them. Versions inspected from the npm registry: Appium `3.7.0`, XCUITest driver `12.12.6`, WDIO CLI/local-runner/Mocha/Appium service `9.31.9`, spec reporter `9.31.2`, globals `9.31.3`, TypeScript `7.0.2`, tsx `4.23.13`, dotenv `18.0.1`, Node types `26.6.2`, Mocha types `10.0.10`. Use exact versions and commit the generated lockfile; validate compatibility rather than assuming latest equals tested.
- [ ] Implement the tested configuration contract. Validate UDID as nonempty hexadecimal/hyphen text; team ID as ten uppercase alphanumeric characters; WDA bundle ID as a reverse-domain identifier. Read these only from local environment. Never commit this Mac's actual values.
- [ ] Configure WebdriverIO with Mocha, the Appium service bound to `127.0.0.1`, one worker, zero whole-test retries, a 20-second element wait, and a 120-second test timeout. Preserve POS data; do not accept alerts automatically. Use normal WDA build/test startup, not the known problematic direct preinstalled-runner launch path.
- [ ] Add `test:unit`, `typecheck`, `doctor`, and `test:orders` npm scripts using the local toolchain. `test:unit` uses Node test runner with tsx; `typecheck` runs `tsc --noEmit`; `test:orders` runs `wdio run ./wdio.conf.ts`.
- [ ] Implement doctor using bounded `execFile` calls, not shell-interpolated strings. Check Node, Xcode selection, connected target device, installed POS, and valid signing identities. Fail with the name of a missing prerequisite; never create certificates or change device settings automatically.
- [ ] Exclude `node_modules/`, `.env`, `.env.*` except `.env.example`, `artifacts/`, Appium/WDA build caches, logs, and execution scratch from Git. Store failure evidence locally with no automatic upload; document that it remains until the user removes it.
- [ ] Run `npm run test:unit` and `npm run typecheck`; expected: all tests pass. Run `npm run doctor`; expected on the currently observed environment: clear signing failure until Task 2 is resolved, not a claim that the environment is ready.
- [ ] Review exact changed files and commit the framework/configuration work locally.

## Task 2: Provision and inspect the actual POS app

**Files:** README setup instructions, local ignored device/signing configuration, `test/screens/pos.selectors.ts` based exclusively on inspection.

**Interfaces:** a working local Appium session exposes the installed POS UI. The selector module exports `homeTab`, `ordersTab`, `ordersList`, `orderRows`, `rowReference`, and `detailReference`; these are selectors grounded in observed UI structure, not invented identifier names.

- [ ] Ask the user to configure their own Apple account in Xcode if signing is unavailable. Xcode → Settings → Apple Accounts → add/select the account → Manage Certificates → Apple Development. Do not request their password or create/export signing keys on their behalf.
- [ ] Open Appium's WDA project through the installed driver's `open-wda` helper, select the signing team and a valid unique runner bundle ID, and follow Appium's documented signing procedure. Enable/trust developer automation on the iPad through user interaction where required. Stop with the exact blocker if account provisioning cannot complete.
- [ ] Re-run `security find-identity -v -p codesigning` and `npm run doctor`. Expected: a usable identity and all required readiness checks pass. Never replace this with fabricated configuration.
- [ ] Start a local Appium session with the configured UDID and installed POS bundle ID. Confirm POS login/data are preserved. Expected: Home is accessible and its selection state can be asserted.
- [ ] Use Appium Inspector or the live session to inspect Home, navigate to Orders, scroll its actual list to the start, and open the first order without invoking order actions. Capture selector evidence locally; do not commit customer-containing snapshots.
- [ ] Record verified selectors and structural relationships in `pos.selectors.ts`. Prefer accessibility IDs, then scoped iOS predicates/class chains. Resolve any duplicate IDs by container scope. Do not use XPath/coordinates as an unreviewed fallback, and do not treat the earlier accessibility daemon's IDs as already validated through WDA.
- [ ] Record how the UI exposes each row's order reference and the detail reference, how empty/loading states appear, and how the actual list can be scrolled to its beginning with a bounded native gesture. If those cannot be determined reliably, stop and report the UI evidence rather than inventing a selector.

## Task 3: Implement and verify the one smoke scenario

**Files:** `test/screens/pos.ts`, `test/specs/open-first-order.spec.ts`, README validation record; extend focused unit tests only for any custom normalization/selection logic introduced.

**Interfaces:** `pos.assertHome(): Promise<void>`, `pos.openOrders(): Promise<void>`, `pos.openFirstOrder(): Promise<string>`, `pos.assertOrderDetail(reference: string): Promise<void>`. The returned reference is read from the selected row, not a hardcoded order or a timestamp-based guess.

- [ ] Write the E2E test first and run it before implementing the screen helper. Expected: failure due to the missing behavior; a device/setup failure is not a behavioral red test and must be resolved under Task 2.

```ts
import { pos } from '../screens/pos.js';

describe('Shopify POS Orders', () => {
  it('opens the first listed order from Home', async () => {
    await pos.assertHome();
    await pos.openOrders();
    const reference = await pos.openFirstOrder();
    await pos.assertOrderDetail(reference);
  });
});
```

- [ ] Implement `assertHome` with a visible/selected Home assertion and blocker checks, using Task 2's observed semantics. Implement Orders navigation using its verified selector and an explicit loaded-list/empty-state wait.
- [ ] Implement first-row selection inside the verified list container. Scroll only that container to its start using Task 2's verified native operation, with a fixed maximum of ten attempts and a clear failure if the beginning cannot be established. Preserve the existing filters and sort. Reject an empty list and missing/ambiguous reference before tapping.
- [ ] Capture the first row's reference and open it. Assert an independently scoped detail reference equals the captured reference. Leave the detail view open. No hidden order mutation, app reset, login automation, or automatic whole-test retry.
- [ ] Add local failure hooks for screenshot and UI source capture. Artifact capture failures must not mask the original test failure. Use neutral filenames without customer names or order references; do not dump page source into ordinary console logs.
- [ ] Run `npm run test:unit`, `npm run typecheck`, and `npm run test:orders`. Expected: all pass on the real iPad; the final screen displays the selected order. On failure, record which boundary failed and preserve local evidence.
- [ ] Validate wrong-start and empty-list behavior only with an available safe real UI state; if a branch cannot be exercised live, report it as unverified rather than manufacturing business data. Pure helper tests cover any custom reference ambiguity/selection logic without claiming to validate POS.
- [ ] Return POS to Home manually for a second run, then rerun the same command. Expected: it opens the current first order again without hardcoded order data. The final state remains the order detail screen.
- [ ] Document setup, one-time signing, the Home/nonempty-list preconditions, commands, error recovery, artifact retention, actual tested versions, and actual live-run results. Separate local-green checks from real-device proof.
- [ ] Review and commit only project work. No push, GitHub remote, or merge.

## Final review and handoff

- [ ] Review the whole branch against the spec, especially preserved app state, credentials/artifact exclusions, no order writes, bounded waits, exact selected/detail reference comparison, and no invented selectors.
- [ ] Run unit tests and typecheck again after fixes. Run the iPad smoke test again if runtime code changed.
- [ ] Report project path, local commit, runnable command, tested device/app versions, and any remaining blocker. Do not label the test operational if signing or live verification remains incomplete.

## Sources

- [Appium project-local driver installation](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/installation/)
- [WebdriverIO TypeScript configuration](https://webdriver.io/docs/typescript/)
- [WebdriverIO Appium service](https://webdriver.io/docs/appium-service/)
- [WDA provisioning](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/provisioning-profile/)
