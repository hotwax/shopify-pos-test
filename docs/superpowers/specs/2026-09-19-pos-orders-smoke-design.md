# iosTesting: Shopify POS orders smoke test

Status: design proposed for review; framework and test not installed yet.

## Goal

Give HotWax teammates a repeatable, committed test against the unmodified App
Store Shopify POS app on a physical iPad connected to a Mac. This first test
starts with POS already open on Home, goes to Orders, and opens the first order
in the displayed list. It must verify that the detail view belongs to that order.

HotWax owns the test scripts, not Shopify POS. No Shopify app source, binary,
re-signing, extension deployment, or Shopify build pipeline is involved.

## Scope

- Create this standalone project locally; no GitHub repository or remote yet.
- Use Appium, its XCUITest driver, WebDriverAgent, WebdriverIO, and TypeScript.
- Use a single physical iPad and one test worker.
- Supply device and Apple signing configuration locally, outside version control.
- Build/sign/install only the separate WebDriverAgent runner when required.
- Preserve the installed POS app, app data, and login session.
- No POS order creation, checkout, edits, refunds, fulfillment, or settings changes.
- No Shopify/HotWax API credentials or downstream integration checks in this test.
- No custom device driver, AI runtime dependency, generic framework, or dashboard.

## Test contract

Preconditions: the selected iPad is paired, unlocked, and ready for developer
automation; Shopify POS is signed in and on Home with no blocking dialog; the
current Orders view has at least one order. The user prepares the desired store.

1. Establish an Appium session targeting installed bundle `com.jadedpixel.pos`.
2. Assert the Home screen is selected; do not automate login or silently recover
   from a different starting screen.
3. Tap the Orders navigation control and wait for its list to load.
4. Ensure the order list is at its start, preserving its existing sort/filter
   selection. Select the first actual order row, excluding headers and controls.
5. Capture that row's order reference, open it, and assert that the detail view
   displays the same reference. Do not assume the first row is newest or hardcode
   any store-specific order number.
6. Leave the order detail screen open, without invoking any order action.

Fail clearly for wrong starting screen, empty orders, ambiguous order reference,
blocking dialog, missing control, or timeout. An empty list is not a passing test.
Select controls from live Appium inspection; do not invent Orders/detail selectors
or use screen-coordinate guesses. Prefer accessibility IDs and scoped native
predicates. Use state-based waits, not fixed sleep sequences or whole-test retries.

## Project structure and commands

- `package.json`, lockfile, and `tsconfig.json`: pinned toolchain and scripts.
- `wdio.conf.ts`: local Appium service, real-device capabilities, one worker,
  bounded waits, no POS reinstall/reset, and local failure-artifact hooks.
- `test/screens/`: minimal shared selectors and navigation helpers.
- `test/specs/open-first-order.spec.ts`: the single smoke scenario.
- `.env.example`, `.gitignore`, and `README.md`: teammate configuration, excluded
  secrets/build output/artifacts, setup, preconditions, and rerun instructions.
- `scripts/doctor.ts`: report readiness without modifying device/store settings.

Intended entry points are `npm ci`, `npm run doctor`, `npm run typecheck`, and
`npm run test:orders`. They are deliverables of implementation, not existing tools.
The README will record the actual tested Node/Appium/XCUITest/WDA/Xcode/iPadOS/POS
versions. GitHub publishing and CI are separate later work.

## Failure evidence and privacy

Capture local screenshots, UI source, and sanitized automation logs when useful
for a failure. Order screens may contain customer information: artifacts are
gitignored, are not uploaded automatically, and remain local until the user removes
them. Document this retention behavior. Never commit account credentials, signing
keys, tokens, or device-specific
configuration. Do not blindly accept unexpected permission dialogs.

## Verification and completion

- Validate configuration and typecheck the project.
- Unit-test any custom configuration/selection logic; mocks do not prove POS works.
- Run the real iPad test and verify that the displayed order matches the selected
  list row. Report the exact tested environment and result.
- If signing, trust, compatibility, or device access prevents the live run, report
  it as blocked/unverified rather than calling the project operational.
- Document that each rerun starts with the user returning POS to Home.

## Known setup risks

The Mac currently reports Node 26.4.0, npm 11.17.0, and Xcode 27.0 (27A266a).
Dependency compatibility and Apple signing availability must be checked during
setup. Appium documents an Xcode 27 problem with a directly launched preinstalled
WDA runner; begin with normal Xcode test orchestration, then validate on this iPad.
The prior accessibility-reader prototype is not proof of Appium compatibility.

## References

- [Appium installed-app and session capabilities](https://appium.github.io/appium-xcuitest-driver/latest/reference/capabilities/)
- [WebDriverAgent signing](https://appium.github.io/appium-xcuitest-driver/latest/getting-started/provisioning-profile/)
- [WebdriverIO Appium service](https://webdriver.io/docs/appium-service/)
- [Xcode 27 preinstalled-runner issue](https://github.com/appium/appium/issues/22636)
