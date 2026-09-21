<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/onboarding"></ion-back-button>
        </ion-buttons>
        <ion-title>Mac Host Setup</ion-title>
        <ion-buttons slot="end">
          <ion-button router-link="/onboarding" router-direction="back" fill="clear">
            Summary
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>

    <ion-content class="ion-padding">
      <ion-grid fixed>
        <ion-row>
          <ion-col size="12" size-lg="9">
            <!-- Development Preview Switcher -->
            <ion-item lines="none" class="preview-item">
              <ion-label><ion-note>Preview state:</ion-note></ion-label>
              <ion-select v-model="previewMode" interface="popover" @ionChange="applyPreview">
                <ion-select-option value="live">Live (Actual Mac state)</ion-select-option>
                <ion-select-option value="missing-xcode">Scenario 1: Missing Xcode</ion-select-option>
                <ion-select-option value="clt-only">Scenario 2: Command Line Tools only</ion-select-option>
                <ion-select-option value="missing-cert">Scenario 3: Xcode installed, missing certificate</ion-select-option>
                <ion-select-option value="missing-tunnel">Scenario 4: Missing RemoteXPC tunnel</ion-select-option>
              </ion-select>
            </ion-item>

            <ion-chip color="primary">STEP 1 OF 3: MAC HOST</ion-chip>
            <h1>Set up your Mac for POS Testing</h1>
            <p class="lede">
              Verify that your Mac's development tools, signing certificates, and device transport are ready before connecting an iPad.
            </p>

            <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

            <!-- 1. Runtime & Xcode Tools -->
            <ion-card>
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>1. Runtime &amp; Xcode Tools</ion-card-title>
                    <ion-card-subtitle>Full Xcode and supported Node.js runtime</ion-card-subtitle>
                  </div>
                  <ion-badge :color="toolsReady ? 'success' : 'warning'">
                    {{ toolsReady ? 'Ready' : 'Needs attention' }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <ion-list>
                  <!-- Node.js Check -->
                  <ion-item class="check-item">
                    <ion-icon
                      :key="`node-${nodeCheck?.state}`"
                      :icon="nodeCheck?.state === 'ready' ? checkmarkCircleOutline : alertCircleOutline"
                      :color="nodeCheck?.state === 'ready' ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label class="ion-text-wrap">
                      Node.js runtime
                      <p>{{ nodeCheck?.message || 'Checking Node.js…' }}</p>
                      <div v-if="nodeCheck && nodeCheck.state !== 'ready'">
                        <p><ion-note color="warning">Next: {{ nodeCheck.actions[0] }}</ion-note></p>
                        <p>
                          <ion-note>
                            Install via <code>brew install node</code> or download from <a href="https://nodejs.org/" target="_blank" rel="noopener">nodejs.org</a>.
                          </ion-note>
                        </p>
                      </div>
                    </ion-label>
                    <ion-badge slot="end" :color="badgeColor(nodeCheck?.state)">
                      {{ checkStateLabel(nodeCheck?.state) }}
                    </ion-badge>
                  </ion-item>

                  <!-- Xcode Check -->
                  <ion-item class="check-item">
                    <ion-icon
                      :key="`xcode-${xcodeCheck?.state}`"
                      :icon="xcodeCheck?.state === 'ready' ? checkmarkCircleOutline : alertCircleOutline"
                      :color="xcodeCheck?.state === 'ready' ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label class="ion-text-wrap">
                      Xcode developer tools
                      <p>{{ xcodeCheck?.message || 'Checking Xcode…' }}</p>

                      <div v-if="xcodeCheck && xcodeCheck.state !== 'ready'">
                        <p><ion-note color="warning">Next: {{ xcodeCheck.actions[0] }}</ion-note></p>

                        <!-- Sub-case A: Command Line Tools active instead of full Xcode -->
                        <div v-if="xcodeCheck.message?.includes('Command Line Tools')">
                          <p>Switch your active developer path to full Xcode:</p>
                          <p class="code-line">
                            <code>sudo xcode-select -s /Applications/Xcode.app/Contents/Developer</code>
                            <ion-button
                              fill="clear"
                              size="small"
                              @click="copyText('sudo xcode-select -s /Applications/Xcode.app/Contents/Developer')"
                              title="Copy command"
                            >
                              <ion-icon slot="icon-only" :icon="copyOutline" />
                            </ion-button>
                          </p>
                        </div>

                        <!-- Sub-case B: Full Xcode missing completely -->
                        <div v-else class="step-guide">
                          <p><ion-note>Full Xcode is required for iPad testing (Command Line Tools alone are not sufficient).</ion-note></p>
                          <ol>
                            <li>Download Xcode from the <a href="macappstore://apps.apple.com/app/xcode/id497799835">Mac App Store</a> or <a href="https://developer.apple.com/xcode/" target="_blank" rel="noopener">Apple Developer</a>.</li>
                            <li>Launch Xcode once after installation to let macOS install internal iOS device support packages.</li>
                            <li>Open Xcode Settings → Locations and confirm Command Line Tools points to Xcode.</li>
                            <li>Return here and click Re-run checks.</li>
                          </ol>
                        </div>
                      </div>
                    </ion-label>
                    <ion-badge slot="end" :color="badgeColor(xcodeCheck?.state)">
                      {{ checkStateLabel(xcodeCheck?.state) }}
                    </ion-badge>
                  </ion-item>
                </ion-list>
              </ion-card-content>
            </ion-card>

            <!-- 2. Apple Developer Signing Identity -->
            <ion-card>
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>2. Apple Developer Signing Identity</ion-card-title>
                    <ion-card-subtitle>Codesigning certificate to run WebDriverAgent on physical iPads</ion-card-subtitle>
                  </div>
                  <ion-badge :color="signingCheck?.state === 'ready' ? 'success' : 'warning'">
                    {{ signingCheck?.state === 'ready' ? 'Ready' : 'Needs attention' }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <ion-list>
                  <ion-item class="check-item">
                    <ion-icon
                      :key="`signing-${signingCheck?.state}`"
                      :icon="signingCheck?.state === 'ready' ? checkmarkCircleOutline : alertCircleOutline"
                      :color="signingCheck?.state === 'ready' ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label class="ion-text-wrap">
                      Signing identity
                      <p>{{ signingCheck?.message || 'Checking Keychain…' }}</p>
                      <p v-if="defaults.developmentTeamIds.length">
                        <ion-note>Detected Team ID: {{ defaults.developmentTeamIds.join(', ') }}</ion-note>
                      </p>

                      <!-- Step-by-step guide when signing certificate is missing -->
                      <div v-if="signingCheck && signingCheck.state !== 'ready'" class="step-guide">
                        <p><ion-note color="warning">Next: Sign in to Xcode and create an Apple Development certificate.</ion-note></p>
                        <ol>
                          <li>Open Xcode.</li>
                          <li>Open Settings (<code>⌘,</code>) and select the Apple Accounts tab.</li>
                          <li>Click the + button at the bottom left and sign in with your Apple ID (a free Personal Team works).</li>
                          <li>Select your account in the list, then click Manage Certificates… at the bottom right.</li>
                          <li>Click the + button in the certificates sheet and choose Apple Development.</li>
                          <li>Click Done, then return here and click Re-run checks.</li>
                        </ol>
                      </div>
                    </ion-label>
                    <ion-badge slot="end" :color="badgeColor(signingCheck?.state)">
                      {{ checkStateLabel(signingCheck?.state) }}
                    </ion-badge>
                  </ion-item>
                </ion-list>
              </ion-card-content>
            </ion-card>

            <!-- 3. iOS 18+ Device Transport -->
            <ion-card>
              <ion-card-header>
                <div class="card-heading">
                  <div>
                    <ion-card-title>3. iOS 18+ Device Transport</ion-card-title>
                    <ion-card-subtitle>Host-side RemoteXPC registry required for iPadOS 18 and later</ion-card-subtitle>
                  </div>
                  <ion-badge :color="tunnelCheck?.state === 'ready' ? 'success' : 'warning'">
                    {{ tunnelCheck?.state === 'ready' ? 'Running' : 'Not running' }}
                  </ion-badge>
                </div>
              </ion-card-header>
              <ion-card-content>
                <ion-list>
                  <ion-item class="check-item">
                    <ion-icon
                      :key="`tunnel-${tunnelCheck?.state}`"
                      :icon="tunnelCheck?.state === 'ready' ? checkmarkCircleOutline : alertCircleOutline"
                      :color="tunnelCheck?.state === 'ready' ? 'success' : 'warning'"
                      slot="start"
                    />
                    <ion-label class="ion-text-wrap">
                      RemoteXPC tunnel (port 42314)
                      <p>{{ tunnelCheck?.message || 'Checking port 42314…' }}</p>
                      <div v-if="tunnelCheck?.state !== 'ready'">
                        <p><ion-note color="warning">Next: In a separate Terminal, start the registry:</ion-note></p>
                        <p class="code-line">
                          <code>sudo env "PATH=$PATH" npx --no-install appium driver run xcuitest tunnel-creation</code>
                          <ion-button
                            fill="clear"
                            size="small"
                            @click="copyText('sudo env &quot;PATH=$PATH&quot; npx --no-install appium driver run xcuitest tunnel-creation')"
                            title="Copy command"
                          >
                            <ion-icon slot="icon-only" :icon="copyOutline" />
                          </ion-button>
                        </p>
                      </div>
                    </ion-label>
                    <ion-badge slot="end" :color="badgeColor(tunnelCheck?.state)">
                      {{ checkStateLabel(tunnelCheck?.state) }}
                    </ion-badge>
                  </ion-item>
                </ion-list>
              </ion-card-content>
            </ion-card>

            <!-- Bottom Actions -->
            <div class="button-row">
              <ion-button fill="outline" @click="handleReRun" :disabled="loading">
                <ion-icon slot="start" :icon="refreshOutline" />
                {{ loading ? 'Checking…' : 'Re-run checks' }}
              </ion-button>
              <ion-button router-link="/onboarding/ipad" router-direction="forward">
                Continue to iPad setup
                <ion-icon slot="end" :icon="arrowForwardOutline" />
              </ion-button>
            </div>
          </ion-col>
        </ion-row>
      </ion-grid>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import {
  IonBackButton, IonBadge, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardSubtitle,
  IonCardTitle, IonChip, IonCol, IonContent, IonGrid, IonHeader, IonIcon, IonItem,
  IonLabel, IonList, IonNote, IonPage, IonRow, IonSelect, IonSelectOption, IonText, IonTitle, IonToolbar,
} from '@ionic/vue';
import {
  alertCircleOutline, arrowForwardOutline, checkmarkCircleOutline, copyOutline, refreshOutline,
} from 'ionicons/icons';
import type { SetupCheck, SetupDefaults } from '../../shared/contracts.ts';
import { getHostChecks, getSetupDefaults } from '../api.ts';

const checks = ref<SetupCheck[]>([]);
const defaults = ref<SetupDefaults>({ developmentTeamIds: [], recommendedWdaBundleId: '' });
const loading = ref(true);
const error = ref('');
const previewMode = ref('live');

const nodeCheck = computed(() => checks.value.find(c => c.id === 'host.node'));
const xcodeCheck = computed(() => checks.value.find(c => c.id === 'host.xcode'));
const signingCheck = computed(() => checks.value.find(c => c.id === 'signing.identity'));
const tunnelCheck = computed(() => checks.value.find(c => c.id === 'host.remote-xpc'));

const toolsReady = computed(() => nodeCheck.value?.state === 'ready' && xcodeCheck.value?.state === 'ready');

function badgeColor(state?: SetupCheck['state']): string {
  if (!state) return 'medium';
  if (state === 'ready') return 'success';
  if (state === 'action') return 'warning';
  if (state === 'blocked' || state === 'unsupported') return 'danger';
  return 'medium';
}

function checkStateLabel(state?: SetupCheck['state']): string {
  if (!state) return 'Checking…';
  if (state === 'ready') return 'Ready';
  if (state === 'action') return 'Action needed';
  if (state === 'blocked') return 'Blocked';
  if (state === 'unsupported') return 'Unsupported';
  return state;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard fallback
  }
}

async function loadRealChecks(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const [hostResult, defaultResult] = await Promise.all([
      getHostChecks(),
      getSetupDefaults(),
    ]);
    checks.value = hostResult.checks;
    defaults.value = defaultResult;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not run Mac host checks.';
  } finally {
    loading.value = false;
  }
}

function applyPreview(): void {
  if (previewMode.value === 'live') {
    void loadRealChecks();
    return;
  }

  if (previewMode.value === 'missing-xcode') {
    checks.value = [
      { id: 'host.node', state: 'ready', message: 'Node 26.4.0 is supported.', actions: [] },
      { id: 'host.xcode', state: 'blocked', message: 'Full Xcode is not installed on this Mac.', actions: ['Download and install full Xcode from the Mac App Store or Apple Developer.'] },
      { id: 'signing.identity', state: 'action', message: 'Xcode is required to detect Apple signing identities.', actions: ['Install full Xcode first.'] },
      { id: 'host.remote-xpc', state: 'action', message: 'RemoteXPC tunnel requires Xcode device tools.', actions: ['Install full Xcode first.'] },
    ];
    defaults.value = { developmentTeamIds: [], recommendedWdaBundleId: 'co.hotwax.iosTesting.WDARunner' };
  } else if (previewMode.value === 'clt-only') {
    checks.value = [
      { id: 'host.node', state: 'ready', message: 'Node 26.4.0 is supported.', actions: [] },
      { id: 'host.xcode', state: 'action', message: 'Command Line Tools are selected instead of full Xcode.', actions: ['Open Xcode → Settings → Locations and select full Xcode.'] },
      { id: 'signing.identity', state: 'action', message: 'No valid Apple development identity is available in Keychain.', actions: ['In Xcode → Settings → Apple Accounts → Manage Certificates, create Apple Development.'] },
      { id: 'host.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is running.', actions: [] },
    ];
    defaults.value = { developmentTeamIds: [], recommendedWdaBundleId: 'co.hotwax.iosTesting.WDARunner' };
  } else if (previewMode.value === 'missing-cert') {
    checks.value = [
      { id: 'host.node', state: 'ready', message: 'Node 26.4.0 is supported.', actions: [] },
      { id: 'host.xcode', state: 'ready', message: 'Xcode 27.0 Build version 27A266a', actions: [] },
      { id: 'signing.identity', state: 'action', message: 'No valid Apple development identity was found in Keychain.', actions: ['In Xcode Settings → Apple Accounts → Manage Certificates, create an Apple Development certificate.'] },
      { id: 'host.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is running.', actions: [] },
    ];
    defaults.value = { developmentTeamIds: [], recommendedWdaBundleId: 'co.hotwax.iosTesting.WDARunner' };
  } else if (previewMode.value === 'missing-tunnel') {
    checks.value = [
      { id: 'host.node', state: 'ready', message: 'Node 26.4.0 is supported.', actions: [] },
      { id: 'host.xcode', state: 'ready', message: 'Xcode 27.0 Build version 27A266a', actions: [] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available in Keychain.', actions: [] },
      { id: 'host.remote-xpc', state: 'action', message: 'The Appium RemoteXPC tunnel registry is not running on port 42314.', actions: ['In a separate Terminal, run `sudo env "PATH=$PATH" npx --no-install appium driver run xcuitest tunnel-creation`, complete the Mac authorization if prompted, and leave it running.'] },
    ];
    defaults.value = { developmentTeamIds: ['Z8AD6NZM2N'], recommendedWdaBundleId: 'co.hotwax.iosTesting.WDARunner' };
  }
}

function handleReRun(): void {
  if (previewMode.value === 'live') {
    void loadRealChecks();
  } else {
    applyPreview();
  }
}

onMounted(() => {
  const urlParam = new URLSearchParams(window.location.search).get('preview');
  if (urlParam && ['missing-xcode', 'clt-only', 'missing-cert', 'missing-tunnel'].includes(urlParam)) {
    previewMode.value = urlParam;
    applyPreview();
  } else {
    void loadRealChecks();
  }
});
</script>

<style scoped>.lede { font-size: 1.05rem; color: var(--ion-color-medium-shade); }

.code-line {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  margin: 0.5rem 0;
}

.step-guide {
  margin-top: 0.5rem;
}

.step-guide ol {
  margin: 0.5rem 0 0 1.25rem;
  padding: 0;
}

.step-guide li {
  margin-bottom: 0.35rem;
  line-height: 1.4;
}

code {
  font-family: ui-monospace, Menlo, Monaco, monospace;
  font-size: 0.85rem;
  color: var(--ion-text-color, #000);
  background: var(--ion-color-light);
  padding: 0.2rem 0.4rem;
  border-radius: 4px;
}
</style>
