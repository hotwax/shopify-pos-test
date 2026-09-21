<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/runs"></ion-back-button>
        </ion-buttons>
        <ion-title>Run detail</ion-title>
        <ion-buttons slot="end">
          <ion-button fill="clear" @click="refresh">Refresh</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

      <template v-if="run">
        <ion-card>
          <ion-card-header>
            <div class="card-heading">
              <div>
                <ion-card-subtitle>Run</ion-card-subtitle>
                <ion-card-title>{{ run.request.scriptId }}</ion-card-title>
              </div>
              <ion-badge :color="stateColor">{{ run.state }}</ion-badge>
            </div>
          </ion-card-header>
          <ion-card-content>
            <div class="fact-grid">
              <div><ion-note>Business effect</ion-note><p>{{ run.effect }}</p></div>
              <div><ion-note>Started</ion-note><p>{{ clockTime(run.createdAt) }}</p></div>
              <div><ion-note>Run ID</ion-note><p>{{ run.id }}</p></div>
            </div>
            <ion-item v-if="run.statusMessage" lines="none" class="ion-no-padding">
              <ion-label class="ion-text-wrap">{{ run.statusMessage }}</ion-label>
            </ion-item>
            <div class="button-row">
              <ion-button @click="cloneAndPlay" :disabled="isLive || cloning">
                <ion-icon slot="start" :icon="playOutline" />
                {{ cloning ? 'Cloning…' : 'Clone and play again' }}
              </ion-button>
              <ion-button v-if="isLive" color="warning" @click="stop">Request stop</ion-button>
              <ion-note v-if="isLive" color="medium">Stopping is cooperative and does not undo a business transaction.</ion-note>
            </div>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <ion-card-subtitle>Submitted by you</ion-card-subtitle>
            <ion-card-title>Test order</ion-card-title>
          </ion-card-header>
          <ion-card-content>
            <ion-list v-if="orderLines.length">
              <ion-item v-for="(line, index) in orderLines" :key="index" :lines="index === orderLines.length - 1 ? 'none' : 'full'">
                <ion-thumbnail slot="start" v-if="line.imageUrl">
                  <img :src="line.imageUrl" :alt="line.search || 'Ordered product'" loading="lazy" />
                </ion-thumbnail>
                <ion-label class="ion-text-wrap">
                  {{ line.search || line.variantGid }}
                  <p>{{ line.variantGid }}</p>
                  <p v-if="isVariantSelection(line.variantSelection)">{{ describeVariantSelection(line.variantSelection) }}</p>
                </ion-label>
                <ion-badge slot="end">x{{ line.quantity }}</ion-badge>
              </ion-item>
            </ion-list>
            <ion-note v-else><p>This script takes no order lines.</p></ion-note>

            <div class="fact-grid">
              <div v-if="currency"><ion-note>Tender</ion-note><p>Cash, {{ currency }}</p></div>
              <div><ion-note>Verified against</ion-note><p>{{ run.request.assertionMode }}</p></div>
              <div v-if="run.request.context"><ion-note>Shopify store</ion-note><p>{{ run.request.context.shopDomain }}</p></div>
              <div v-if="run.request.context"><ion-note>Expected POS location</ion-note><p>{{ run.request.context.locationGid }}</p></div>
              <div v-if="run.request.context"><ion-note>Shopify API version</ion-note><p>{{ run.request.context.apiVersion }}</p></div>
              <div><ion-note>iPad profile</ion-note><p>{{ run.request.deviceProfileId }}</p></div>
              <div v-if="note"><ion-note>Note</ion-note><p>{{ note }}</p></div>
            </div>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <div class="card-heading">
              <div>
                <ion-card-subtitle>Captured from the iPad</ion-card-subtitle>
                <ion-card-title>Screenshots</ion-card-title>
              </div>
            </div>
          </ion-card-header>
          <ion-card-content>
            <div class="screenshot-grid" v-if="screenshots.length">
              <button
                v-for="shot in screenshots"
                :key="shot.name"
                type="button"
                class="screenshot-thumb"
                @click="openScreenshot(shot)"
              >
                <img :src="shot.blobUrl" :alt="shot.name" loading="lazy" />
                <ion-note>{{ shot.name }}</ion-note>
              </button>
            </div>
            <ion-note v-else><p>{{ isLive ? 'Waiting for the run to capture its first screenshot…' : 'No screenshots were captured for this run.' }}</p></ion-note>
          </ion-card-content>
        </ion-card>

        <ion-card>
          <ion-card-header>
            <div class="card-heading">
              <div>
                <ion-card-subtitle>{{ isLive ? 'Live from the iPad' : 'What this run did' }}</ion-card-subtitle>
                <ion-card-title>Activity</ion-card-title>
              </div>
              <ion-spinner v-if="isLive" name="dots" />
            </div>
          </ion-card-header>
          <ion-card-content>
            <ion-accordion-group v-if="progress.length" :multiple="true">
              <ion-accordion v-for="(entry, index) in progress" :key="`${entry.at}-${index}`" :value="String(index)">
                <ion-item slot="header" @click="loadStepLogs(index)">
                  <ion-label class="ion-text-wrap">
                    {{ entry.message }}
                    <p>{{ clockTime(entry.at) }} · {{ stepDurations[index]?.label }}</p>
                  </ion-label>
                  <ion-spinner v-if="isLive && index === progress.length - 1" name="dots" slot="end" />
                </ion-item>
                <div slot="content" class="step-log">
                  <p v-if="stepError[index]">Could not read the driver output: {{ stepError[index] }}. Expand it again to retry.</p>
                  <p v-else-if="stepLogs[index] === undefined">Loading driver output…</p>
                  <p v-else-if="!stepLogs[index]?.length">No driver output was recorded for this step.</p>
                  <template v-else>
                    <pre>{{ stepLogs[index]?.join('\n') }}</pre>
                    <ion-note v-if="stepTruncated[index]"><p>Output was trimmed to the most recent lines.</p></ion-note>
                  </template>
                </div>
              </ion-accordion>
            </ion-accordion-group>
            <ion-note v-else><p>{{ isLive ? 'Waiting for the run to report its first step…' : 'This run recorded no step activity.' }}</p></ion-note>
            <ion-note v-if="progress.length" class="total-elapsed"><p>Total elapsed: {{ totalElapsedLabel || 'unknown' }}</p></ion-note>
          </ion-card-content>
        </ion-card>

        <ion-card v-if="run.assertions.length">
          <ion-card-header><ion-card-title>Checks</ion-card-title></ion-card-header>
          <ion-card-content>
            <ion-list>
              <ion-item v-for="(assertion, index) in run.assertions" :key="`${assertion.lane}-${index}`" :lines="index === run.assertions.length - 1 ? 'none' : 'full'">
                <ion-label class="ion-text-wrap">{{ assertion.lane }}<p>{{ assertion.message }}</p></ion-label>
                <ion-badge slot="end">{{ assertion.status }}</ion-badge>
              </ion-item>
            </ion-list>
          </ion-card-content>
        </ion-card>
      </template>
      <ion-text color="medium" v-else>Loading run…</ion-text>
    </ion-content>
    <div v-if="overlayShot" class="screenshot-overlay" @click="closeScreenshot">
      <ion-button fill="clear" class="screenshot-overlay-close" @click.stop="closeScreenshot">Close</ion-button>
      <img :src="overlayShot.blobUrl" :alt="overlayShot.name" @click.stop />
      <ion-note class="screenshot-overlay-caption">{{ overlayShot.name }}</ion-note>
    </div>
  </ion-page>
</template>
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { IonAccordion, IonAccordionGroup, IonBackButton, IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent, IonHeader, IonIcon, IonItem, IonLabel, IonList, IonNote, IonSpinner, IonPage, IonText, IonThumbnail, IonTitle, IonToolbar } from '@ionic/vue';
import { playOutline } from 'ionicons/icons';
import type { RunRecord } from '../../shared/contracts.ts';
import { describeVariantSelection, isVariantSelection } from '../../shared/variant-selection.ts';
import { getHealth, getRun, getRunArtifactBlob, getRunLogs, getRunProgress, listRunArtifacts, requestStop, startRun, type RunArtifact, type RunProgressEntry } from '../api.ts';

const route = useRoute();
const router = useRouter();
const id = computed(() => String(route.params.id ?? ''));
const run = ref<RunRecord>();
const progress = ref<RunProgressEntry[]>([]);
const stepLogs = ref<Record<number, string[]>>({});
const stepTruncated = ref<Record<number, boolean>>({});
const stepPending = ref<Record<number, boolean>>({});
const stepError = ref<Record<number, string>>({});

interface ScreenshotItem { name: string; modifiedAt: string; blobUrl: string }
const artifacts = ref<RunArtifact[]>([]);
const screenshots = ref<ScreenshotItem[]>([]);
const overlayShot = ref<ScreenshotItem>();
// Screenshot bytes are fetched once per name and reused across polls, since a
// finished step's screenshot never changes; only revoked when the run changes
// or the component unmounts, so the <img> tags backing this run stay valid.
const screenshotBlobUrls = new Map<string, string>();

function releaseScreenshotCache(): void {
  for (const url of screenshotBlobUrls.values()) URL.revokeObjectURL(url);
  screenshotBlobUrls.clear();
  screenshots.value = [];
  overlayShot.value = undefined;
}

async function loadArtifacts(): Promise<void> {
  if (!id.value) return;
  let list: RunArtifact[];
  try { list = (await listRunArtifacts(id.value)).artifacts; }
  catch { return; /* screenshots are observational; a failed read must not mask the run */ }
  artifacts.value = list;
  const pngs = list.filter(entry => entry.kind === 'screenshot').sort((a, b) => a.modifiedAt.localeCompare(b.modifiedAt));
  const items: ScreenshotItem[] = [];
  for (const entry of pngs) {
    let blobUrl = screenshotBlobUrls.get(entry.name);
    if (!blobUrl) {
      try {
        blobUrl = URL.createObjectURL(await getRunArtifactBlob(id.value, entry.name));
        screenshotBlobUrls.set(entry.name, blobUrl);
      } catch { continue; }
    }
    items.push({ name: entry.name, modifiedAt: entry.modifiedAt, blobUrl });
  }
  screenshots.value = items;
}

function openScreenshot(shot: ScreenshotItem): void { overlayShot.value = shot; }
function closeScreenshot(): void { overlayShot.value = undefined; }

// Each step recorded how far the driver log had been written when it started,
// so the next step's offset closes the window. The last step of a finished run
// has no successor and simply reads to the end of the log.
async function loadStepLogs(index: number): Promise<void> {
  // An empty array is a legitimate "this step produced nothing", so the cache
  // is checked against undefined. Checking the array itself would short-circuit
  // for ever, because [] is truthy.
  if (stepLogs.value[index] !== undefined || stepPending.value[index]) return;
  const from = progress.value[index]?.logOffset;
  if (from === undefined) { stepLogs.value = { ...stepLogs.value, [index]: [] }; return; }
  const to = progress.value[index + 1]?.logOffset;
  stepPending.value = { ...stepPending.value, [index]: true };
  stepError.value = { ...stepError.value, [index]: '' };
  try {
    const result = await getRunLogs(id.value, from, to);
    stepLogs.value = { ...stepLogs.value, [index]: result.lines };
    stepTruncated.value = { ...stepTruncated.value, [index]: result.truncated };
  } catch (cause) {
    // Leave the entry uncached so expanding again retries, and keep the reason
    // rather than a bare flag: a silent empty step hides the actual fault.
    stepError.value = { ...stepError.value, [index]: cause instanceof Error ? cause.message : 'Unknown error' };
  } finally {
    stepPending.value = { ...stepPending.value, [index]: false };
  }
}
const error = ref('');
const cloning = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
const liveStates = ['validating', 'preparing', 'running', 'verifying'];
const isLive = computed(() => Boolean(run.value && liveStates.includes(run.value.state)));
function clockTime(at: string): string { const date = new Date(at); return Number.isFinite(date.getTime()) ? date.toLocaleTimeString() : ''; }

interface SubmittedLine { variantGid?: string; productGid?: string; search?: string; quantity?: number; imageUrl?: string; variantSelection?: string }
const orderLines = computed<SubmittedLine[]>(() => {
  const lines = (run.value?.request.parameters as { lines?: unknown })?.lines;
  return Array.isArray(lines) ? lines as SubmittedLine[] : [];
});
const currency = computed(() => String((run.value?.request.parameters as { currency?: unknown })?.currency ?? ''));
const note = computed(() => String((run.value?.request.parameters as { note?: unknown })?.note ?? ''));
const stateColor = computed(() => {
  const state = run.value?.state;
  if (state === 'passed') return 'success';
  if (state && ['failed', 'blocked', 'needs-reconciliation'].includes(state)) return 'danger';
  return isLive.value ? 'primary' : 'medium';
});

// A run's terminal moment has no dedicated field on RunRecord, so it is read
// back from the artifacts the run itself already writes: result.json is
// written once verification concludes, and its mtime is the closest available
// stand-in for "when this run stopped". A run that ended before writing one
// (blocked or cancelled early) falls back to the newest file in the
// directory, which is still the last moment this run touched disk.
const terminalAt = computed<string | undefined>(() => {
  if (isLive.value || !artifacts.value.length) return undefined;
  const result = artifacts.value.find(entry => entry.name === 'result.json');
  if (result) return result.modifiedAt;
  return artifacts.value.reduce<string | undefined>((latest, entry) => (!latest || entry.modifiedAt > latest ? entry.modifiedAt : latest), undefined);
});

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, ms) / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`;
  let minutes = Math.floor(totalSeconds / 60);
  let seconds = Math.round(totalSeconds - minutes * 60);
  if (seconds === 60) { minutes += 1; seconds = 0; }
  return `${minutes} min ${seconds} s`;
}

interface StepDuration { label: string; ms?: number }
const stepDurations = computed<StepDuration[]>(() => progress.value.map((entry, index) => {
  const startMs = Date.parse(entry.at);
  // A successor step's own timestamp closes this one's window; the last step
  // has no successor, so it closes against the run's terminal moment instead.
  const nextAt = progress.value[index + 1]?.at ?? terminalAt.value;
  if (!Number.isFinite(startMs) || !nextAt) return { label: 'in progress' };
  const endMs = Date.parse(nextAt);
  if (!Number.isFinite(endMs)) return { label: 'in progress' };
  const ms = Math.max(0, endMs - startMs);
  return { label: formatDuration(ms), ms };
}));

const totalElapsedLabel = computed(() => {
  if (!progress.value.length) return '';
  const startMs = Date.parse(progress.value[0].at);
  if (!Number.isFinite(startMs)) return '';
  const endAt = terminalAt.value ?? (isLive.value ? undefined : progress.value[progress.value.length - 1].at);
  const endMs = endAt ? Date.parse(endAt) : Date.now();
  if (!Number.isFinite(endMs)) return '';
  return formatDuration(Math.max(0, endMs - startMs));
});

async function refresh() {
  if (!id.value) return;
  try {
    run.value = await getRun(id.value);
    // Progress is observational; a failure to read it must not mask the run.
    try { progress.value = (await getRunProgress(id.value)).entries; } catch { /* keep the last known steps */ }
    await loadArtifacts();
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not load run.'; }
}
async function stop() { try { await requestStop(id.value); await refresh(); } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Stop request failed.'; } }

async function cloneAndPlay() {
  if (!run.value || cloning.value) return;
  cloning.value = true;
  error.value = '';
  try {
    const health = await getHealth();
    const accepted = await startRun({
      scriptId: run.value.request.scriptId,
      deviceProfileId: run.value.request.deviceProfileId,
      parameters: run.value.request.parameters,
      assertionMode: run.value.request.assertionMode,
      expectedRevision: health.revision,
      ...(run.value.request.context ? { context: run.value.request.context } : {}),
    });
    await router.push(`/runs/${accepted.id}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not clone and play run.';
  } finally {
    cloning.value = false;
  }
}

watch(id, async () => {
  run.value = undefined;
  progress.value = [];
  error.value = '';
  artifacts.value = [];
  releaseScreenshotCache();
  await refresh();
});

onMounted(async () => { await refresh(); timer = setInterval(() => { if (run.value && ['passed', 'failed', 'blocked', 'cancelled', 'needs-reconciliation'].includes(run.value.state)) return; void refresh(); }, 1_000); });
onUnmounted(() => { if (timer) clearInterval(timer); releaseScreenshotCache(); });
</script>

<style scoped>
ion-thumbnail img { object-fit: contain; }
.step-log { padding: 0 1rem 1rem; }
.step-log pre { margin: 0; max-height: 18rem; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font-size: .78rem; }
.total-elapsed { display: block; margin-top: .75rem; }

.screenshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
  gap: .75rem;
}
.screenshot-thumb {
  display: flex;
  flex-direction: column;
  gap: .35rem;
  padding: 0 0 .5rem;
  border: 1px solid var(--ion-color-step-150, rgba(0, 0, 0, .12));
  border-radius: 8px;
  background: var(--ion-item-background, transparent);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow: hidden;
}
.screenshot-thumb img {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
}
.screenshot-thumb ion-note {
  padding: 0 .5rem;
  font-size: .72rem;
  overflow-wrap: anywhere;
}

/* The overlay's backdrop is always dark, independent of the light/dark
   palette, so the white caption and close button stay readable in either
   theme without a prefers-color-scheme override. */
.screenshot-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: .5rem;
  padding: 1.5rem;
  background: rgba(0, 0, 0, .85);
}
.screenshot-overlay img { max-width: 100%; max-height: 75vh; object-fit: contain; border-radius: 4px; }
.screenshot-overlay-close { align-self: flex-end; --color: #fff; }
.screenshot-overlay-caption { color: #fff; font-size: .85rem; overflow-wrap: anywhere; }
</style>
