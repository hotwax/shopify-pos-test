# Receiving on the physical Demo POS

The Receiving tile opens the classic embedded App Bridge app at
`admin.shopify.com/store/hotwax-demo/apps/receiving-hotwax-demo`. Its released
frame loads `https://receiving-dev.hotwax.io/shopify-login`. These URLs were
read from the actual iPad webview on October 2, 2026. The authorized development
preview now points the same tile at the Mac's primary Receiving checkout
through Shopify CLI's HTTPS tunnel; no new POS extension was created.

## Local development preview

Use Shopify CLI's store-specific development preview and HTTPS tunnel. The
iPad's `localhost` is the iPad itself, so `--use-localhost` cannot serve the
Mac's frontend to POS.

The prepared, ignored `.runtime/receiving-pos/` directory contains a frontend
process that serves the active Receiving checkout on port 8130. It reuses that
checkout's Vite configuration and dependencies. It blanks all four saved dev
login variables before environment loading and asserts they remain blank in
Vite's client environment. The ordinary Receiving process on port 8100 is
independent of this process.

The deployed app's public shop mapping confirmed
`hotwax-demo.myshopify.com` and `https://demo-maarg.hotwax.io`. The downloaded
configuration matches that app: its application URL ends in `/shopify-login`,
both embedded flags are true, and its Shopify API scope list is empty.
The frontend redirects Shopify launch requests from the tunnel root to that
login entry while preserving launch parameters, and uses WSS for tunnel HMR.

Before running Shopify CLI:

1. Confirm the existing Receiving Demo app and read its current Shopify
   configuration. Download the configuration with `app config link`; do not
   reconstruct its scopes, callbacks, webhooks, or app identity from guesses.
2. Verify the store's canonical domain and OMS. Save those non-secret values
   in `.runtime/receiving-pos/target.local.json` as `shop` and `oms`.
3. Keep the downloaded config's app identity and permissions. Review its URL
   handling so the tunnel retains the `/shopify-login` entry path.
4. Validate the resulting config, then run `app dev` for that specific Demo
   store. This creates a development preview, not a released app version.
5. Read the iPad's frame URL back and prove it uses the tunnel, then repeat the
   native Receiving test. Verify a source change reaches the physical device
   and the list returns after restoring that change.

The existing app configuration was downloaded and the local store preview
started with authorization. The Receiving build passed; configuration
validation returned `valid: true` with no issues. The physical iPad's frame
URL matched the CLI tunnel in completed native navigation runs.

From `.runtime/receiving-pos/`, the prepared commands are:

```sh
shopify app config validate --config pos-local --json
shopify app dev --config pos-local --store hotwax-demo.myshopify.com --skip-dependencies-installation
```

Restore the hosted app after stopping the preview with:

```sh
shopify app dev clean --config pos-local --store hotwax-demo.myshopify.com
```

Shopify documents [store-specific development previews](https://shopify.dev/docs/apps/build/cli-for-apps/test-apps-locally),
[app configuration](https://shopify.dev/docs/apps/build/cli-for-apps/app-configuration),
and [frontend process variables](https://shopify.dev/docs/apps/build/cli-for-apps/app-structure).
Stopping `app dev` does not by itself remove the development preview; restore
the released app using the documented preview cleanup after testing.

To run the native check from the repository root, put the current tunnel's
HTTPS origin in the ignored `.runtime/receiving-pos/performance-parameters.json`:

```json
{
  "shopName": "hotwax-demo",
  "expectedFrameOrigin": "https://<current-tunnel-host>",
  "verifySourceUpdate": true,
  "verifyScannerKeyboard": true
}
```

```sh
npm run test:script -- --id pos.receiving-performance --parameters-file .runtime/receiving-pos/performance-parameters.json
```

`verifySourceUpdate` temporarily changes the list title in the primary
Receiving checkout, waits for that title on the iPad, restores the original
file, and waits for a visible transfer row. It also requires the active
tracking search to survive both edits, rejecting a full reload that resets
page state. It refuses to overwrite a file changed concurrently. Omit this
option for a navigation-only run. `verifyScannerKeyboard` checks that detail
opens without the software keyboard and that tapping the scan field still
opens it for manual entry.

## Local preview observations

Read-only local runs `run-1790956732928-5887d3a8` and
`run-1790957062934-da6fadd5` verified tracking search, Enter-to-detail, shipment
selection, identifiers, and Completed/Open navigation against the actual
tunnel. In the first run, initial loading was still visible in the sample
taken about 8.6 seconds after opening; the list was visible in the sample
taken about 24.7 seconds after opening. These sparse samples do not determine
the exact loading duration.

The second run showed the temporary source title on the physical iPad about
5.6 seconds after writing it. Its original restore check only waited for the
marker to disappear and captured a blank frame; that result does not prove
the restored page was ready. The check now also waits for a transfer row.

The stronger check passed in `run-1790957798094-44d47e25`. The changed title
appeared after about 5.9 seconds, and `source-restored.png` shows the original
title and transfer rows after restoration. The primary Receiving checkout
has no tracked changes from this test. Its video is `receiving-pos.mp4` in
that run's artifacts directory.

The original Vite tunnel browser console reported that `TransferOrders.vue`
was in a circular import and fell back to a full reload. The local source
changes below address this. The cross-origin debugger limit remains.

## Current local source changes

Receiving now obtains the router through Vue injection in the transfer
views and list row. Its login action reads the router already registered
with AccxUI instead of statically importing the route table. The route table
loads app pages on navigation, and transfer detail loads the desktop camera
decoder only when desktop camera scanning is requested. Embedded POS retains
its existing Shopify scanner path.

The production entry JavaScript fell from 3,436.39 kB to
2,827.49 kB, about 18%. Gzip size fell from 845.07 kB to
707.76 kB. The 358.53 kB desktop camera decoder is now a deferred chunk.
These are payload measurements, not a claim that startup is 18% faster.

Embedded detail focuses its scan input with `inputmode="none"` so automatic
focus does not raise the software keyboard. Tapping the field enables text
input. Background focus calls preserve a keyboard the user opened manually.
The focused caret was visible in the native capture; a physical HID scanner
has not been exercised.

Native run `run-1790960241273-fc011dc7` passed login, tracking search,
Enter-to-detail, manual keyboard opening, and Completed/Open navigation.
The source title update appeared in about 2.2 seconds and preserved the
tracking search through the change and restoration. Its opening captures
still showed Shopify loading at about 8.4 seconds and the first transfer at
about 17.7 seconds. WDA operations and capture overhead are included; no
controlled cache reset or production-bundle timing comparison was performed.
Those development observations did not establish production startup speed. The compiled measurements below now cover that gap.

Final run `run-1790960709312-81e0dd8d` passed after the background-focus
guard was added. Detail opened without the keyboard, tapping the scan field
opened it, and the tracking search survived the temporary title and its
restoration. The title update was observed after about 1.2 seconds. The final
Receiving build and all 54 Receiving unit tests passed. Changes are local;
they have not been pushed or deployed.

During implementation, the retest caught an incorrect `.value` access on
AccxUI's already-unwrapped route, causing embedded login to fail. The final
code matches the registry's existing route access, and the native login
retest passed. No backend or API contracts changed, and no receipt was submitted.

Toolkit unit validation passed all 279 tests. Type checking still fails at
`test/specs/open-hotwax-reject-preview.spec.ts:228` with its pre-existing
incompatible literal comparison; it reported no errors in the Receiving
scenario or runner changes. Receiving's build and Git whitespace checks passed.

## Saved POS access

Shop PINs live only in `.runtime/shop-pins.local.json`, which is ignored by
Git and must have permissions `0600`. Each shop has its own string value:

```json
{
  "schemaVersion": 1,
  "shops": {
    "your-demo-shop": { "posPin": "<enter locally>" }
  }
}
```

The Receiving scenario checks the visible POS shop before reading its PIN.
Its runner suppresses Appium/Xcode input logs, and video recording starts
after login. Never put actual PINs in catalogs, scenario parameters, reports,
or Git.

## Physical hosted baseline

Read-only run `run-1790954350263-08c739ed` passed on an iPad Pro running
iPadOS 27.0 and Shopify POS 11.15.0, at hotwax-demo / Broadway. Its evidence
is under `.runtime/runs/<run-id>/artifacts/`, including XML, screenshots,
action timings, and `receiving-pos.mp4`.

Verified: tracking search narrowed the list to one order; Enter opened that
order with its shipment selected; product primary and secondary identifiers
were visible; Completed used the narrower search hint; Completed/Open and
detail/list navigation worked. No units were staged or received.

| Native action | Observation time |
| --- | ---: |
| Focus, type tracking code, and observe match | 3.075 s |
| Enter to detail | 1.606 s |
| Detail back to list | 1.236 s |
| Completed first page | 9.873 s |
| Back to cached Open | 1.153 s |

These include WDA round trips and typing, not JavaScript event-to-paint
measurements. The recording shows an empty Completed list for several
seconds before its rows appear. The detail page also opens its software
keyboard, obscuring the lower card until it is dismissed.

Safari's remote debugger blocks JavaScript access to the cross-origin
Receiving child frame inside Shopify Admin. Moving the frontend to a tunnel
does not remove this restriction; local instrumentation and native evidence
are still needed. Camera/HID scanning, actual receipt submission, large
orders and offline behavior remain untested on this iPad. Compiled cold-cache
measurements are recorded in the later sections.

## Compiled iPad startup measurements (October 2, 2026)

The same installed Receiving app and Demo OMS were tested with compiled Vite
assets served through the authorized Shopify preview. An ignored local timing
plugin recorded navigation-relative DOM milestones, OMS request durations,
and cache-read milestones. It recorded no request headers, query strings,
bodies, credentials, or receipt payloads. The worker still used the real OMS.
The temporary instrumentation is absent from the normal production build and
live-edit frontend after this benchmark.

| Run | Assets / Receiving cache | First visible transfer | Login/setup calls | Saved corpus read |
| --- | --- | ---: | ---: | ---: |
| `run-1790963543398-3b066b83` | First visit / empty | 5.073 s | 12 | 6 ms, empty |
| `run-1790963821982-281f13b6` | Warm / 87 transfers | 2.551 s | 12 | 34 ms |
| `run-1790964464228-09eaea19` | Updated assets / 87 transfers | 5.209 s | 10 | 35 ms |
| `run-1790964672127-6e8dc8a8` | Updated assets warm / 87 transfers | 2.208 s | 10 | 61 ms |

These timings start at the Receiving document's navigation start, not at the
POS tile tap. Recording begins on POS Home; native observation timings also
include WDA overhead and are stored separately. A single run per condition
is not a statistical benchmark or a guarantee for other stores/networks.
DOM observation and timing capture themselves add some overhead. Detailed
metadata and summarized phases are in each run's `startup-timings.json` and
`startup-summary.json` artifacts.

Before the first OMS call, the initial visit spent 2.271 seconds on frontend
loading and App Bridge initialization; login/setup finished at 4.448 seconds.
The initial cached reopen spent 1.081 seconds before its first OMS call,
and login/setup finished at 2.386 seconds. With the setup changes, the warm
reopen spent 0.975 seconds before its first OMS call; login/setup finished
at 2.024 seconds. Cache reads are a small fraction of this startup path.

The local Receiving changes start independent profile and permission reads
together and wait for both before fetching user facilities. POS facility
discovery already restricts facilities to its current location, so login
avoids the second location lookup. Product-store fetching now awaits the
selected store's settings, eliminating the second settings request in login.
Regression coverage verifies the permission failure gate, the non-POS
facility preference, and settings readiness. Receiving's 59 unit tests and
production build pass. The toolkit's 282 unit tests pass; its unrelated
existing TypeScript error remains in `open-hotwax-reject-preview.spec.ts`.

The first compiled navigation test exposed that changing input mode on an
already focused scanner field did not reliably open the iOS keyboard. The
handler now updates the native input and refocuses it synchronously in the
user's pointer gesture. `run-1790964464228-09eaea19` passed the complete native
flow, including keyboard hidden on detail entry, manual keyboard opening,
tracking search/Enter, shipment selection, and Completed/Open navigation.
No item quantity was entered and no inventory receipt was submitted.

An earlier proxy-only run returned corrupted compressed HTML. That harness
error was corrected and the failed run was excluded from timing results.
The original first-visit benchmark completed its startup measurements but
failed the later manual-keyboard check; the updated compiled flow passes.


## Final live-edit preview and PIN verification

The normal frontend is restored on port 8130. `dev.mjs` serves Vite directly;
the compiled benchmark proxy is retained separately in the ignored
`benchmark.mjs` for reproducibility. The normal production build was regenerated
and verified to contain no benchmark timing hooks. The existing frontend on
port 8100 was left running.

`run-1790965230719-cb7e85d3` passed on the physical iPad. Its actual frame
matched the current authorized preview origin. The source title change reached
POS in 1.295 seconds; the tracking search survived the change and restoration.
The flow also passed tracking Enter-to-detail, shipment selection,
Completed/Open navigation, and both scanner keyboard checks.

PIN entry uses one native keypad snapshot to map all ten digit buttons to their
centers. The same mapper handles numeric or string four-to-six-digit PINs;
strings preserve leading zeroes. The verified static keypad temporarily skips
XCTest's per-action idle and animation waits, uses ordered mapped taps, then
restores both settings in `finally`. It never changes Apple security settings.
The final native test explicitly locked and unlocked POS, proving this path.
Mapped entry took 3.267 seconds, excluding keypad discovery, unfinished-entry
cleanup, settings changes, and Home verification. No PIN or touch coordinates
were saved in the timing artifact. Batched W3C gestures dropped digits on this
iPad, so they were removed from the implementation.

No inventory changes were submitted. Receiving's changes remain local in the
primary checkout; this validation does not mean they are pushed or deployed.

## Fresh cold-cache optimization follow-up (October 2, 2026)

Both compiled runs used a new Shopify preview HTTPS origin, ensuring empty
Receiving IndexedDB and uncached frontend assets without deleting the prior
origin's cache or receipt drafts. Store and OMS remained Demo / Broadway.

| Milestone from Receiving navigation | Before | Optimized |
| --- | ---: | ---: |
| First visible transfer | 6.150 s | 5.830 s |
| First visible tracking badge | 12.083 s | 6.856 s |
| Worker ready to initial order hydration | 5.209 s | 1.004 s |
| Initial 87-order hydration pass ends | 31.686 s | 18.279 s |

The optimized run separately confirms 87/87 transfers ready through the real
cache coverage query at 18.301 s. These are single instrumented samples,
not statistical guarantees. Network download varied: the 2.825 MB entry
JavaScript took 2.956 s before and 1.752 s after. Native test interactions
also overlap background hydration. The scheduling gap and parallel request
starts are directly visible in the captured timings.

Receiving now sets the existing shared harness's scheduling tick to one
second; its 30-second and 120-second domain sync intervals and freshness
checks remain intact. Independent shipments, detail and discrepancy reads
run concurrently within the existing three-order limit. All reads settle
before the order lock releases on failure. Notification initialization runs
alongside facility/store initialization after account authorization; login
still waits for both. AccxUI and the backend were not modified.

Regression tests cover overlapping setup, facility failure, independent
order reads, order-lock failure settlement, optional shipment failure and
avoiding extra network reads for fresh cached orders. All 65 Receiving unit
tests pass, as does the ordinary production build, with no timing hooks in
its entry bundle. Work remains local and unpushed.

Evidence is in runs `run-1790967226289-31daa481` and
`run-1790967779876-7fe8f17b`, including startup timing and summary JSON,
native screenshots and video. The baseline native flow passed. Optimized
cold startup and tracking Enter-to-detail passed, but the later manual
keyboard check failed once. A compiled warm repeat,
`run-1790968017380-32afc196`, passed the entire native flow including the
keyboard. The source handler was subsequently broadened to cover touch and
label/container taps; final live-edit validation is recorded below.

The next substantial cold-load opportunity is the entry bundle. Shared
`commonUtil` eagerly imports CSV, encoding and cron utilities. Splitting
those dependencies requires a separate shared-code change with validation
of affected apps; it was not included in this Receiving-only optimization.
No receipt was submitted or inventory changed during these tests.

Final normal live-edit verification `run-1790968479264-0d09e885` passed on
the physical iPad. The actual embedded frame matched the restored preview
origin. Tracking search and Enter-to-detail, shipment filtering, keyboard
hidden on entry/manual keyboard opening, Completed/Open navigation, and HMR
source change/restoration passed. The original title and search state were
restored. This is a point-in-time pass, not proof that every intermittent
keyboard interaction is eliminated. The source change and response videos
are retained in that run's artifacts. Ordinary build, 65 unit tests, UI diff
constraints and Git whitespace checks pass. The user's port-8100 frontend
was left running; normal live editing remains on port 8130.
