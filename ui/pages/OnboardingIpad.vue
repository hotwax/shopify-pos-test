<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start">
          <ion-back-button default-href="/onboarding"></ion-back-button>
        </ion-buttons>
        <ion-title>iPad Setup</ion-title>
        <ion-buttons slot="end">
          <ion-button router-link="/onboarding" router-direction="back" fill="clear">Summary</ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-grid fixed>
        <ion-row><ion-col size="12" size-lg="9">
          <ion-item lines="none" class="preview-item">
            <ion-label><ion-note>Preview state:</ion-note></ion-label>
            <ion-select v-model="previewMode" interface="popover" @ionChange="applyPreview">
              <ion-select-option value="live">Live (Actual iPad state)</ion-select-option>
              <ion-select-option value="no-device">Scenario 1: No iPad connected</ion-select-option>
              <ion-select-option value="unsaved-profile">Scenario 2: iPad discovered, not saved</ion-select-option>
              <ion-select-option value="locked-or-untrusted">Scenario 3: iPad locked or untrusted</ion-select-option>
              <ion-select-option value="dev-mode-disabled">Scenario 4: Developer Mode disabled</ion-select-option>
              <ion-select-option value="pos-missing">Scenario 5: Shopify POS missing</ion-select-option>
              <ion-select-option value="ready">Scenario 6: Prerequisites ready (first run pending)</ion-select-option>
              <ion-select-option value="trust-required">Scenario 7: Developer profile untrusted on iPad (trust steps needed)</ion-select-option>
              <ion-select-option value="all-verified">Scenario 8: All verified (first run passed)</ion-select-option>
            </ion-select>
          </ion-item>

          <ion-chip color="primary">STEP 2 OF 3: CONNECT IPAD</ion-chip>
          <h1>Connect your test iPad</h1>
          <p class="lede">We’ll find the iPad connected to this Mac, save a reusable profile, and walk you through the few Apple-owned steps that must be completed on the device.</p>

          <ol class="path-steps">
            <li>Connect the iPad by USB-C, unlock it, and trust this Mac if Apple asks.</li>
            <li>On the iPad, set Settings → Display &amp; Brightness → Auto-Lock to Never, so it cannot re-lock part way through a test.</li>
            <li>Sign in to Shopify POS on your test store. You do not need to leave it open — the test brings it to the front — but it must be signed in.</li>
            <li>Select the discovered iPad below and save its profile.</li>
            <li>Run the read-only checks. If Apple asks for a setting or password, complete it in Apple’s prompt.</li>
          </ol>
          <p class="path-note">This app does not change Developer Mode, UI Automation, trust, signing, passwords, or any other Apple security setting.</p>

          <ion-card>
            <ion-card-header>
              <div class="card-heading">
                <div><ion-card-title>1. Find and name your iPad</ion-card-title><ion-card-subtitle>Saved profiles stay on this Mac for the next run.</ion-card-subtitle></div>
                <ion-badge :color="profileSaved ? 'success' : 'medium'">{{ profileSaved ? 'Saved' : 'Not saved yet' }}</ion-badge>
              </div>
            </ion-card-header>
            <ion-card-content>
              <ion-item>
                <ion-label position="stacked">Profile name</ion-label>
                <ion-input v-model="profile.name" aria-label="Profile name" placeholder="Team iPad" />
              </ion-item>
              <ion-note color="medium"><p>Use a name your teammates will recognize, such as “Aditya’s POS iPad” or “Brooklyn store iPad”.</p></ion-note>

              <ion-item>
                <ion-label position="stacked">Connected iPad</ion-label>
                <ion-select v-model="profile.udid" aria-label="Connected iPad" interface="popover" placeholder="Choose an iPad" @ionChange="deviceChanged">
                  <ion-select-option v-for="device in devices" :key="device.udid" :value="device.udid">{{ device.name }} · {{ device.model }} · iPadOS {{ device.os }}</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-note v-if="!devices.length && !error" color="warning"><p>No iPad is listed yet. Connect it by USB-C, unlock it, trust this Mac, then select Find connected iPads.</p></ion-note>

              <div class="button-row">
                <ion-button fill="outline" @click="handleDiscover" :disabled="discovering">{{ discovering ? 'Looking for iPads…' : 'Find connected iPads' }}</ion-button>
                <ion-button @click="handleSave" :disabled="saving || !profileReady">{{ saving ? 'Saving…' : profileSaved ? 'Save changes' : 'Save iPad profile' }}</ion-button>
              </div>
              <ion-text color="success" v-if="savedMessage"><p role="status">{{ savedMessage }}</p></ion-text>
              <ion-text color="danger" v-if="error"><p role="alert">{{ error }}</p></ion-text>

              <ion-accordion-group class="advanced-accordion">
                <ion-accordion value="advanced">
                  <ion-item slot="header">
                    <ion-label>Advanced device details</ion-label>
                  </ion-item>
                  <div slot="content" class="ion-padding">
                    <p>These values are discovered or generated for the automation helper. Most users should never need to edit them.</p>
                    <ion-item><ion-label position="stacked">Apple development team (auto-detected)</ion-label><ion-input v-model="profile.teamId" aria-label="Apple development team" placeholder="Create Apple Development in Xcode if blank" /></ion-item>
                    <ion-item><ion-label position="stacked">Automation helper identifier (generated)</ion-label><ion-input v-model="profile.wdaBundleId" aria-label="Automation helper identifier" /></ion-item>
                    <ion-note v-if="profile.udid"><p>Device identifier: <code>{{ profile.udid }}</code></p></ion-note>
                  </div>
                </ion-accordion>
              </ion-accordion-group>
            </ion-card-content>
          </ion-card>

          <ion-card v-if="profiles.length">
            <ion-card-header><ion-card-title>Saved iPad profiles</ion-card-title><ion-card-subtitle>Choose a profile to use or update. Nothing is uploaded.</ion-card-subtitle></ion-card-header>
            <ion-card-content>
              <ion-radio-group :value="profile.id" @ionChange="useProfileById($event.detail.value)">
                <ion-item v-for="saved in profiles" :key="saved.id">
                  <ion-radio :value="saved.id" label-placement="end" justify="start">
                    <div class="choice-label">
                      <h2>{{ profileLabel(saved) }}</h2>
                      <p>{{ saved.model || 'iPad' }}<template v-if="saved.os"> · iPadOS {{ saved.os }}</template></p>
                    </div>
                  </ion-radio>
                </ion-item>
              </ion-radio-group>
              <ion-button fill="outline" @click="newProfile">Add another iPad</ion-button>
            </ion-card-content>
          </ion-card>

          <ion-card v-if="profileSaved">
            <ion-card-header>
              <div class="card-heading">
                <div><ion-card-title>Shopify POS staff PIN</ion-card-title><ion-card-subtitle>Optional. Lets test runs unlock Shopify POS by themselves.</ion-card-subtitle></div>
                <ion-badge :color="posPin ? 'success' : 'medium'">{{ posPin ? 'Saved' : 'Not saved' }}</ion-badge>
              </div>
            </ion-card-header>
            <ion-card-content>
              <p>When Shopify POS asks for a staff PIN during a test run, the run types this PIN and carries on. It does not sign POS back in if the whole store is signed out.</p>
              <p v-if="posPin">A PIN is saved for this iPad. It was saved on {{ new Date(posPin.updatedAt).toLocaleString() }}.</p>
              <ion-item>
                <ion-label position="stacked">{{ posPin ? 'New PIN' : 'PIN' }}</ion-label>
                <ion-input v-model="posPinInput" type="password" inputmode="numeric" maxlength="6" autocomplete="off" aria-label="Shopify POS staff PIN" placeholder="4 to 6 digits" />
              </ion-item>
              <div class="button-row">
                <ion-button @click="handleSavePosPin" :disabled="posPinBusy || !posPinInput">{{ posPin ? 'Replace PIN' : 'Save PIN' }}</ion-button>
                <ion-button v-if="posPin" fill="outline" color="danger" @click="handleForgetPosPin" :disabled="posPinBusy">Delete PIN</ion-button>
              </div>
              <ion-note color="medium"><p>The PIN is encrypted on this Mac with a key in your macOS Keychain. The app never shows it again, and it is never put in Git or in run logs.</p></ion-note>
              <ion-text color="success" v-if="posPinMessage"><p role="status">{{ posPinMessage }}</p></ion-text>
              <ion-text color="danger" v-if="posPinError"><p role="alert">{{ posPinError }}</p></ion-text>
            </ion-card-content>
          </ion-card>

          <ion-card>
            <ion-card-header>
              <div class="card-heading">
                <div><ion-card-title>2. Check the Mac and iPad</ion-card-title><ion-card-subtitle>All checks are read-only.</ion-card-subtitle></div>
                <ion-badge :color="allChecksPassed ? 'success' : checksReady ? 'primary' : checks.length ? 'warning' : 'medium'">
                  {{ allChecksPassed ? 'All checks verified' : checksReady ? 'Prerequisites ready' : checks.length ? 'Needs attention' : 'Not checked' }}
                </ion-badge>
              </div>
            </ion-card-header>
            <ion-card-content>
              <p v-if="!profile.udid">Save an iPad profile first. We’ll then verify pairing, Developer Mode, iPadOS, unlock state, Shopify POS, signing, and the native session prerequisites.</p>
              <p v-else-if="!profileSaved">Save this profile before running checks so the exact device can be reused.</p>
              <div v-else class="button-row">
                <ion-button @click="handleCheck" :disabled="checking">
                  <ion-icon slot="start" :icon="refreshOutline" />
                  {{ checking ? 'Running read-only checks…' : 'Run read-only checks' }}
                </ion-button>
              </div>
              <ion-list v-if="checks.length" class="checks-list">
                <ion-item v-for="item in checks" :key="item.id" class="check-item">
                  <ion-icon
                    :key="`icon-${item.id}-${item.state}`"
                    :icon="checkIcon(item)"
                    :color="checkIconColor(item)"
                    slot="start"
                  />
                  <ion-label class="ion-text-wrap">
                    {{ checkTitle(item.id) }}
                    <p>{{ item.message }}</p>
                    <p v-if="item.actions.length && item.state !== 'ready'">
                      <span v-if="isFirstRunCheck(item.id)">
                        <ion-note :color="checksReady ? 'primary' : 'warning'">
                          {{ checksReady ? 'Verified automatically when you run the first-time test below.' : item.actions[0] }}
                        </ion-note>
                      </span>
                      <span v-else>Next: {{ item.actions[0] }}</span>
                    </p>
                    <p v-if="item.command && item.state !== 'ready'"><code>{{ item.command }}</code></p>
                    <p v-if="item.link && item.state !== 'ready'"><a :href="item.link" target="_blank" rel="noopener">Download Apple's intermediate certificate</a></p>
                  </ion-label>
                  <ion-badge slot="end" :color="badgeColor(item)">{{ checkStateLabel(item) }}</ion-badge>
                </ion-item>
              </ion-list>
            </ion-card-content>
          </ion-card>

          <ion-card class="first-run-card" v-if="checksReady">
            <ion-card-header>
              <div class="card-heading">
                <div>
                  <ion-card-title>3. First-run test (Verify permissions &amp; live session)</ion-card-title>
                  <ion-card-subtitle>Launches WebDriverAgent and Shopify POS to clear Apple trust prompts.</ion-card-subtitle>
                </div>
                <ion-badge :color="firstRunStatus === 'passed' ? 'success' : firstRunStatus === 'running' || firstRunStatus === 'starting' ? 'primary' : firstRunStatus === 'failed' ? 'danger' : 'medium'">
                  {{ firstRunStatus === 'passed' ? 'Verified' : firstRunStatus === 'running' ? 'Running…' : firstRunStatus === 'starting' ? 'Preparing…' : firstRunStatus === 'failed' ? 'Attention needed' : 'Ready to test' }}
                </ion-badge>
              </div>
            </ion-card-header>
            <ion-card-content>
              <div v-if="firstRunStatus === 'idle'">
                <p>
                  Keep the iPad unlocked with Auto-Lock off, and leave Shopify POS on its Home screen. When you start this read-only test, Apple may prompt for permissions:
                </p>

                <ion-list :inset="true" class="ion-no-margin ion-margin-top ion-margin-bottom">
                  <ion-item>
                    <ion-icon slot="start" :icon="keyOutline" color="warning" />
                    <ion-label class="ion-text-wrap">
                      Keychain password on Mac
                      <p>Allows <code>codesign</code> to sign WebDriverAgent</p>
                    </ion-label>
                  </ion-item>
                  <ion-item>
                    <ion-icon slot="start" :icon="shieldCheckmarkOutline" color="primary" />
                    <ion-label class="ion-text-wrap">
                      Developer certificate trust on iPad
                      <p>Settings &rarr; General &rarr; VPN &amp; Device Management</p>
                    </ion-label>
                  </ion-item>
                  <ion-item lines="none">
                    <ion-icon slot="start" :icon="phonePortraitOutline" color="medium" />
                    <ion-label class="ion-text-wrap">
                      UI Automation &amp; Local Network
                      <p>Confirm the permission prompt on the iPad screen</p>
                    </ion-label>
                  </ion-item>
                </ion-list>

                <ion-note color="medium">
                  <p>This test is 100% read-only (captures an accessibility snapshot and screenshot). It makes zero taps and changes no store data.</p>
                </ion-note>
              </div>

              <div v-if="['starting', 'running'].includes(firstRunStatus)">
                <ion-list :inset="true" class="ion-no-margin ion-margin-bottom">
                  <ion-item lines="none">
                    <ion-spinner slot="start" name="crescent" color="primary" />
                    <ion-label class="ion-text-wrap">
                      {{ firstRunStatus === 'starting' ? 'Starting first-run test…' : 'Running native inspection…' }}
                      <p>If Apple prompts on your Mac or iPad, complete the prompt now.</p>
                      <ion-note v-if="firstRunMessage" color="warning" class="ion-margin-top">
                        {{ firstRunMessage }}
                      </ion-note>
                    </ion-label>
                    <ion-badge slot="end" color="primary">In progress</ion-badge>
                  </ion-item>
                </ion-list>
                <ion-progress-bar type="indeterminate" color="primary" />
              </div>

              <ion-list v-if="firstRunStatus === 'passed'" class="checks-list ion-margin-bottom">
                <ion-item class="check-item" lines="none">
                  <ion-icon slot="start" :icon="checkmarkCircleOutline" color="success" />
                  <ion-label class="ion-text-wrap">
                    Live session verified
                    <p>WebDriverAgent is trusted, permissions are granted, and Shopify POS accessibility is responsive.</p>
                  </ion-label>
                  <ion-badge slot="end" color="success">Ready</ion-badge>
                </ion-item>
              </ion-list>

              <div v-if="firstRunStatus === 'failed'">
                <ion-list class="checks-list ion-margin-bottom">
                  <ion-item class="check-item" lines="none">
                    <ion-icon slot="start" :icon="alertCircleOutline" color="danger" />
                    <ion-label class="ion-text-wrap">
                      {{ isTrustFailure ? 'Action required on iPad: Trust Developer Profile' : 'First-run test did not complete' }}
                      <p>{{ firstRunMessage || 'Check Apple trust and lock state, then try again.' }}</p>
                    </ion-label>
                    <ion-badge slot="end" color="danger">Action needed</ion-badge>
                  </ion-item>
                </ion-list>

                <ion-list :inset="true" v-if="isTrustFailure" class="ion-no-margin ion-margin-bottom">
                  <ion-list-header>
                    <ion-icon :icon="shieldCheckmarkOutline" color="primary" class="ion-margin-end" />
                    <ion-label>How to finish trust steps on your iPad</ion-label>
                  </ion-list-header>

                  <ion-item>
                    <ion-badge slot="start" color="primary">1</ion-badge>
                    <ion-label class="ion-text-wrap">
                      Open Settings
                      <p>Launch the Settings app on your iPad.</p>
                    </ion-label>
                    <ion-icon slot="end" :icon="settingsOutline" color="medium" />
                  </ion-item>

                  <ion-item>
                    <ion-badge slot="start" color="primary">2</ion-badge>
                    <ion-label class="ion-text-wrap">
                      VPN &amp; Device Management
                      <p>Tap General &rarr; VPN &amp; Device Management</p>
                      <ion-note color="medium"><p>Older iPadOS: <em>Profiles &amp; Device Management</em> or <em>Device Management</em></p></ion-note>
                    </ion-label>
                  </ion-item>

                  <ion-item>
                    <ion-badge slot="start" color="primary">3</ion-badge>
                    <ion-label class="ion-text-wrap">
                      Select Developer Profile
                      <p>Under DEVELOPER APP, tap your developer profile:</p>
                      <ion-chip outline color="dark" class="ion-margin-top">
                        <ion-icon :icon="personOutline" />
                        <ion-label>{{ profile.teamId ? `Developer App (${profile.teamId})` : 'Apple Development Profile' }}</ion-label>
                      </ion-chip>
                    </ion-label>
                  </ion-item>

                  <ion-item>
                    <ion-badge slot="start" color="primary">4</ion-badge>
                    <ion-label class="ion-text-wrap">
                      Trust Developer Certificate
                      <p>Tap Trust "{{ profile.teamId || 'your account' }}", then tap Trust in the confirmation popup.</p>
                    </ion-label>
                    <ion-icon slot="end" :icon="checkmarkDoneOutline" color="success" />
                  </ion-item>

                  <ion-item>
                    <ion-badge slot="start" color="warning">5</ion-badge>
                    <ion-label class="ion-text-wrap">
                      Developer Mode Note
                      <p>If prompted, go to Settings &rarr; Privacy &amp; Security &rarr; Developer Mode, turn it On, and restart the iPad.</p>
                    </ion-label>
                  </ion-item>

                  <ion-item lines="none">
                    <ion-badge slot="start" color="success">6</ion-badge>
                    <ion-label class="ion-text-wrap">
                      Retry Verification
                      <p>Keep the iPad unlocked with Shopify POS on Home, and tap Retry verification test below.</p>
                    </ion-label>
                    <ion-icon slot="end" :icon="refreshOutline" color="primary" />
                  </ion-item>
                </ion-list>
              </div>

              <div class="button-row ion-margin-top">
                <ion-button
                  @click="runFirstTimeVerification"
                  :disabled="['starting', 'running'].includes(firstRunStatus)"
                  :color="firstRunStatus === 'passed' ? 'medium' : 'primary'"
                  :fill="firstRunStatus === 'passed' ? 'outline' : 'solid'"
                >
                  <ion-icon slot="start" :icon="firstRunStatus === 'passed' ? refreshOutline : playCircleOutline" />
                  {{ firstRunStatus === 'passed' ? 'Re-test live session' : firstRunStatus === 'failed' ? 'Retry verification test' : 'Run first-time verification' }}
                </ion-button>
                <ion-button v-if="firstRunId" :router-link="`/runs/${firstRunId}`" fill="clear">
                  View run log
                  <ion-icon slot="end" :icon="arrowForwardOutline" />
                </ion-button>
              </div>
            </ion-card-content>
          </ion-card>

          <div class="navigation-row ion-margin-top">
            <ion-button router-link="/onboarding" router-direction="back" fill="outline">
              Back to summary
            </ion-button>
            <ion-button
              :router-link="allChecksPassed ? '/onboarding/oms' : undefined"
              router-direction="forward"
              :disabled="!allChecksPassed"
            >
              Continue to OMS connection
              <ion-icon slot="end" :icon="arrowForwardOutline" />
            </ion-button>
          </div>
          <p v-if="!allChecksPassed" class="path-note ion-margin-bottom">{{ continueBlockedReason }}</p>
        </ion-col></ion-row>
      </ion-grid>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  IonAccordion, IonAccordionGroup, IonBackButton, IonBadge, IonButton, IonButtons,
  IonCard, IonCardContent, IonCardHeader, IonCardSubtitle, IonCardTitle, IonChip,
  IonCol, IonContent, IonGrid, IonHeader, IonIcon, IonInput, IonItem, IonLabel,
  IonList, IonListHeader, IonNote, IonPage, IonProgressBar, IonRadio, IonRadioGroup,
  IonRow, IonSelect, IonSelectOption, IonSpinner, IonText, IonTitle, IonToolbar,
} from '@ionic/vue';
import {
  alertCircleOutline, arrowForwardOutline,
  checkmarkCircleOutline, checkmarkDoneOutline, keyOutline, personOutline,
  phonePortraitOutline, playCircleOutline, refreshOutline, settingsOutline,
  shieldCheckmarkOutline,
} from 'ionicons/icons';
import type { DeviceProfile, SavedPosPin, SetupCheck, SetupDefaults } from '../../shared/contracts.ts';
import {
  checkSetup, forgetPosPin, getHealth, getPosPin, getProfiles, getRun, getSetupDefaults, getSetupDevices,
  savePosPin, saveProfile, startRun,
} from '../api.ts';

type SetupDevice = { udid: string; name: string; model: string; os: string };

const defaultProfile = (): DeviceProfile => ({ id: 'team-ipad', name: 'Team iPad', udid: '', teamId: '', wdaBundleId: '' });
const profile = ref<DeviceProfile>(defaultProfile());
const profiles = ref<DeviceProfile[]>([]);
const devices = ref<SetupDevice[]>([]);
const checks = ref<SetupCheck[]>([]);
const defaults = ref<SetupDefaults>({ developmentTeamIds: [], recommendedWdaBundleId: 'co.hotwax.iosTesting.WDARunner' });
const discovering = ref(false);
const checking = ref(false);
const saving = ref(false);
const error = ref('');
const savedMessage = ref('');
const editingExisting = ref(false);
const previewMode = ref('live');
const posPin = ref<SavedPosPin | null>(null);
const posPinInput = ref('');
const posPinBusy = ref(false);
const posPinMessage = ref('');
const posPinError = ref('');

const firstRunStatus = ref<'idle' | 'starting' | 'running' | 'passed' | 'failed'>('idle');
const firstRunId = ref('');
const firstRunMessage = ref('');
let firstRunTimer: ReturnType<typeof setInterval> | undefined;

const selectedDevice = computed(() => devices.value.find(device => device.udid === profile.value.udid));
const profileSaved = computed(() => Boolean(profile.value.udid && profiles.value.some(item => item.id === profile.value.id && item.udid === profile.value.udid)));
const profileReady = computed(() => Boolean(profile.value.name?.trim() && profile.value.udid && profile.value.teamId && profile.value.wdaBundleId));

function isFirstRunCheck(id: string): boolean {
  return id === 'wda.session' || id === 'pos.home';
}

const prerequisiteChecks = computed(() => checks.value.filter(c => !isFirstRunCheck(c.id)));
const checksReady = computed(() => prerequisiteChecks.value.length > 0 && prerequisiteChecks.value.every(item => item.state === 'ready'));
const allChecksPassed = computed(() => checks.value.length > 0 && checks.value.every(item => item.state === 'ready'));
const continueBlockedReason = computed(() => {
  if (!checks.value.length) return 'Run the checks above before continuing. Shopify POS testing needs a verified Mac, iPad and live session.';
  if (!checksReady.value) return 'Resolve the checks that still need attention above, then run them again before continuing.';
  if (firstRunStatus.value === 'failed') return 'The first-run test did not pass. Complete the action it reports, then retry it before continuing.';
  if (['starting', 'running'].includes(firstRunStatus.value)) return 'The first-run test is still running. Continue becomes available when every check is verified.';
  return 'Run the first-run test above. Continue becomes available when every check is verified.';
});
const isTrustFailure = computed(() => {
  if (firstRunStatus.value !== 'failed') return false;
  const msg = (firstRunMessage.value || '').toLowerCase();
  return msg.includes('trust') || msg.includes('vpn') || msg.includes('certificate') || msg.includes('profile') || msg.includes('security');
});

function checkIcon(item: SetupCheck): string {
  if (isFirstRunCheck(item.id)) {
    if (item.state === 'ready') return checkmarkCircleOutline;
    return checksReady.value ? playCircleOutline : alertCircleOutline;
  }
  return item.state === 'ready' ? checkmarkCircleOutline : alertCircleOutline;
}

function checkIconColor(item: SetupCheck): string {
  if (isFirstRunCheck(item.id)) {
    if (item.state === 'ready') return 'success';
    return checksReady.value ? 'primary' : 'warning';
  }
  return item.state === 'ready' ? 'success' : item.state === 'unsupported' || item.state === 'blocked' ? 'danger' : 'warning';
}

function badgeColor(item: SetupCheck): string {
  if (isFirstRunCheck(item.id)) {
    if (item.state === 'ready') return 'success';
    return checksReady.value ? 'primary' : 'warning';
  }
  return item.state === 'ready' ? 'success' : item.state === 'unsupported' || item.state === 'blocked' ? 'danger' : item.state === 'action' ? 'warning' : 'medium';
}

function checkStateLabel(item: SetupCheck): string {
  if (isFirstRunCheck(item.id)) {
    if (item.state === 'ready') return 'Ready';
    if (checksReady.value) return 'First run';
  }
  return item.state === 'ready' ? 'Ready' : item.state === 'action' ? 'Action needed' : item.state === 'blocked' ? 'Blocked' : item.state === 'unsupported' ? 'Unsupported' : item.state;
}

function profileLabel(value: DeviceProfile): string { return value.name?.trim() || value.id; }
function checkTitle(id: string): string { return id.split('.').map(part => part.replaceAll('-', ' ')).join(' · ').replace(/\b\w/g, letter => letter.toUpperCase()); }
function internalProfileId(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, sixtyFourCharacters);
  const root = base || 'ipad';
  let candidate = root; let suffix = 2;
  while (profiles.value.some(item => item.id === candidate && item.udid !== profile.value.udid)) candidate = `${root.slice(0, 75 - String(suffix).length)}-${suffix++}`;
  return candidate;
}

const sixtyFourCharacters = 64;

function applyDefaults(): void {
  if (!profile.value.teamId && defaults.value.developmentTeamIds[0]) profile.value.teamId = defaults.value.developmentTeamIds[0];
  if (!profile.value.wdaBundleId) profile.value.wdaBundleId = defaults.value.recommendedWdaBundleId;
}

function deviceChanged(): void {
  const device = selectedDevice.value;
  if (!device) return;
  profile.value.model = device.model;
  profile.value.os = device.os;
  if (!profile.value.name || profile.value.name === 'Team iPad') profile.value.name = device.name;
  applyDefaults();
  savedMessage.value = '';
}

async function discover(): Promise<void> {
  discovering.value = true; error.value = ''; savedMessage.value = '';
  try {
    const [deviceResult, setupDefaults] = await Promise.all([getSetupDevices(), getSetupDefaults()]);
    devices.value = deviceResult.devices;
    defaults.value = setupDefaults;
    if (!profile.value.udid && devices.value[0]) profile.value.udid = devices.value[0].udid;
    if (deviceResult.error) error.value = deviceResult.error;
    deviceChanged();
    if (!devices.value.length && !error.value) error.value = 'No iPad was found. Connect it by USB-C, unlock it and trust this Mac, then try again.';
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Could not discover the iPad setup.'; }
  finally { discovering.value = false; }
}

function useProfile(saved: DeviceProfile): void {
  profile.value = { ...saved, name: profileLabel(saved) };
  editingExisting.value = true;
  if (previewMode.value === 'live') {
    localStorage.setItem('iosTesting.profileId', saved.id);
  }
  checks.value = [];
  firstRunStatus.value = 'idle';
  savedMessage.value = `Using “${profileLabel(saved)}”. Run checks when the iPad is connected and awake.`;
  error.value = '';
}
function useProfileById(id: string): void {
  const match = profiles.value.find(p => p.id === id);
  if (match) useProfile(match);
}

function newProfile(): void {
  profile.value = { ...defaultProfile(), id: 'new-ipad', name: '' };
  editingExisting.value = false;
  checks.value = [];
  firstRunStatus.value = 'idle';
  savedMessage.value = 'Set up a second iPad profile, then save it with a name your team will recognize.';
  error.value = '';
  if (devices.value[0]) { profile.value.udid = devices.value[0].udid; deviceChanged(); }
}

async function save(): Promise<void> {
  if (!profileReady.value) { error.value = 'Choose an iPad and complete the auto-filled Apple values before saving.'; return; }
  saving.value = true; error.value = ''; savedMessage.value = '';
  try {
    const selected = selectedDevice.value;
    const payload: DeviceProfile = { ...profile.value, id: editingExisting.value ? profile.value.id : internalProfileId(profile.value.name!), name: profile.value.name!.trim(), ...(selected ? { model: selected.model, os: selected.os } : {}) };
    const result = await saveProfile(payload);
    profiles.value = result.profiles;
    profile.value = { ...payload };
    editingExisting.value = true;
    localStorage.setItem('iosTesting.profileId', payload.id);
    if (!profiles.value.some(item => item.id === payload.id)) throw new Error('Profile was not returned after saving.');
    savedMessage.value = `Saved “${profileLabel(payload)}” on this Mac. You can reuse it from Shopify POS and future runs.`;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : 'Profile could not be saved.'; }
  finally { saving.value = false; }
}

async function check(): Promise<void> {
  checking.value = true; error.value = ''; savedMessage.value = '';
  try { checks.value = (await checkSetup(profile.value)).checks; }
  catch (cause) { error.value = cause instanceof Error ? cause.message : 'Setup checks failed.'; }
  finally { checking.value = false; }
}

async function handleCheck(): Promise<void> {
  if (previewMode.value === 'live') {
    await check();
  } else {
    applyPreview();
  }
}

async function loadPosPin(udid: string): Promise<void> {
  posPin.value = null; posPinMessage.value = ''; posPinError.value = '';
  if (!udid) return;
  try { posPin.value = (await getPosPin(udid)).saved; }
  catch (cause) { posPinError.value = cause instanceof Error ? cause.message : 'The saved PIN could not be read.'; }
}

watch(() => (profileSaved.value && previewMode.value === 'live' ? profile.value.udid : ''), udid => { void loadPosPin(udid); }, { immediate: true });

async function handleSavePosPin(): Promise<void> {
  posPinBusy.value = true; posPinMessage.value = ''; posPinError.value = '';
  try {
    posPin.value = (await savePosPin(profile.value.udid, posPinInput.value.trim())).saved;
    posPinInput.value = '';
    posPinMessage.value = 'PIN saved for this iPad.';
  } catch (cause) { posPinError.value = cause instanceof Error ? cause.message : 'The PIN could not be saved.'; }
  finally { posPinBusy.value = false; }
}

async function handleForgetPosPin(): Promise<void> {
  posPinBusy.value = true; posPinMessage.value = ''; posPinError.value = '';
  try {
    await forgetPosPin(profile.value.udid);
    posPin.value = null;
    posPinMessage.value = 'PIN deleted.';
  } catch (cause) { posPinError.value = cause instanceof Error ? cause.message : 'The PIN could not be deleted.'; }
  finally { posPinBusy.value = false; }
}

async function handleDiscover(): Promise<void> {
  if (previewMode.value === 'live') {
    await discover();
  } else {
    applyPreview();
  }
}

async function handleSave(): Promise<void> {
  if (previewMode.value === 'live') {
    await save();
  } else {
    const selected = selectedDevice.value;
    const payload: DeviceProfile = {
      ...profile.value,
      id: editingExisting.value ? profile.value.id : internalProfileId(profile.value.name!),
      name: profile.value.name!.trim(),
      ...(selected ? { model: selected.model, os: selected.os } : {}),
    };
    if (!profiles.value.some(p => p.id === payload.id)) {
      profiles.value.push(payload);
    }
    profile.value = { ...payload };
    editingExisting.value = true;
    savedMessage.value = `Saved “${profileLabel(payload)}” on this Mac (Simulated). You can reuse it from Shopify POS and future runs.`;
  }
}

async function runFirstTimeVerification(): Promise<void> {
  if (firstRunTimer) {
    clearInterval(firstRunTimer);
    firstRunTimer = undefined;
  }
  firstRunStatus.value = 'starting';
  firstRunMessage.value = '';

  if (previewMode.value !== 'live') {
    firstRunId.value = 'simulated-run-001';
    firstRunMessage.value = 'Building WebDriverAgent with development certificate…';
    setTimeout(() => {
      if (firstRunStatus.value === 'starting') {
        firstRunStatus.value = 'running';
        firstRunMessage.value = 'Connected to iPad. Capturing POS accessibility tree…';
      }
    }, 1200);
    setTimeout(() => {
      if (firstRunStatus.value === 'running' || firstRunStatus.value === 'starting') {
        firstRunStatus.value = 'passed';
        firstRunMessage.value = '';
        for (const c of checks.value) {
          if (c.id === 'wda.session') {
            c.state = 'ready';
            c.message = 'Live WDA/Appium session verified.';
          }
          if (c.id === 'pos.home') {
            c.state = 'ready';
            c.message = 'Shopify POS accessibility query verified.';
          }
        }
      }
    }, 2800);
    return;
  }

  try {
    const health = await getHealth();
    const accepted = await startRun({
      scriptId: 'pos.inspect-screen',
      deviceProfileId: profile.value.id,
      parameters: {},
      assertionMode: 'pos',
      expectedRevision: health.revision,
    });
    firstRunId.value = accepted.id;
    firstRunStatus.value = 'running';

    firstRunTimer = setInterval(async () => {
      try {
        const record = await getRun(accepted.id);
        if (record.statusMessage) {
          firstRunMessage.value = record.statusMessage;
        }
        if (record.state === 'passed') {
          firstRunStatus.value = 'passed';
          firstRunMessage.value = '';
          if (firstRunTimer) {
            clearInterval(firstRunTimer);
            firstRunTimer = undefined;
          }
          for (const c of checks.value) {
            if (c.id === 'wda.session') {
              c.state = 'ready';
              c.message = 'Live WDA/Appium session verified.';
            }
            if (c.id === 'pos.home') {
              c.state = 'ready';
              c.message = 'Shopify POS accessibility query verified.';
            }
          }
        } else if (['failed', 'blocked', 'cancelled', 'needs-reconciliation'].includes(record.state)) {
          firstRunStatus.value = 'failed';
          firstRunMessage.value = record.statusMessage || 'The verification test failed or was blocked by an Apple prompt.';
          if (firstRunTimer) {
            clearInterval(firstRunTimer);
            firstRunTimer = undefined;
          }
        }
      } catch (cause) {
        firstRunMessage.value = cause instanceof Error ? cause.message : 'Could not check run status.';
      }
    }, 1500);
  } catch (cause) {
    firstRunStatus.value = 'failed';
    firstRunMessage.value = cause instanceof Error ? cause.message : 'Could not start verification test.';
  }
}

async function loadRealData(): Promise<void> {
  error.value = '';
  savedMessage.value = '';
  try {
    const [savedResult, setupDefaults] = await Promise.all([getProfiles(), getSetupDefaults()]);
    profiles.value = savedResult.profiles;
    defaults.value = setupDefaults;
    const remembered = localStorage.getItem('iosTesting.profileId');
    const saved = profiles.value.find(item => item.id === remembered) ?? profiles.value[0];
    if (saved) {
      useProfile(saved);
    } else {
      applyDefaults();
    }
    await discover();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not load first-time setup.';
  }
}

function applyPreview(): void {
  if (previewMode.value === 'live') {
    void loadRealData();
    return;
  }

  const simulatedDevice: SetupDevice = {
    udid: '00008103-001234567890001E',
    name: "Aditya's iPad Air",
    model: 'iPad Air (5th generation)',
    os: '18.2',
  };

  const simulatedProfile: DeviceProfile = {
    id: 'adityas-ipad-air',
    name: "Aditya's iPad Air",
    udid: simulatedDevice.udid,
    teamId: 'Z8AD6NZM2N',
    wdaBundleId: 'co.hotwax.iosTesting.WDARunner',
    model: simulatedDevice.model,
    os: simulatedDevice.os,
  };

  if (previewMode.value === 'no-device') {
    devices.value = [];
    profile.value = defaultProfile();
    profiles.value = [];
    checks.value = [];
    firstRunStatus.value = 'idle';
    savedMessage.value = '';
    error.value = '';
    editingExisting.value = false;
  } else if (previewMode.value === 'unsaved-profile') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [];
    checks.value = [];
    firstRunStatus.value = 'idle';
    savedMessage.value = '';
    error.value = '';
    editingExisting.value = false;
  } else if (previewMode.value === 'locked-or-untrusted') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [{ ...simulatedProfile }];
    editingExisting.value = true;
    firstRunStatus.value = 'idle';
    savedMessage.value = '';
    error.value = '';
    checks.value = [
      { id: 'device.pairing', state: 'action', message: 'The iPad is not paired and trusted with this Mac.', actions: ['Unlock the iPad and trust this Mac.'] },
      { id: 'device.developer', state: 'ready', message: 'Developer Mode is enabled.', actions: [] },
      { id: 'device.os', state: 'ready', message: 'iPadOS 18.2 is in the supported baseline.', actions: [] },
      { id: 'device.unlocked', state: 'action', message: 'CoreDevice reports that the iPad is locked and requires its passcode.', actions: ['Unlock the iPad yourself and leave it awake before starting a native test.'] },
      { id: 'pos.installed', state: 'ready', message: 'Shopify POS 9.28.0 (92800) is installed.', actions: [] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available.', actions: [] },
      { id: 'device.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is available.', actions: [] },
      { id: 'wda.session', state: 'action', message: 'WDA is blocked until host and device prerequisites pass.', actions: ['If Apple asks for a password, trust or UI Automation action, complete it yourself. The toolkit will not change those settings.'] },
      { id: 'pos.home', state: 'action', message: 'Shopify POS Home has not been verified by a live native accessibility query.', actions: ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.'] },
    ];
  } else if (previewMode.value === 'dev-mode-disabled') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [{ ...simulatedProfile }];
    editingExisting.value = true;
    firstRunStatus.value = 'idle';
    savedMessage.value = '';
    error.value = '';
    checks.value = [
      { id: 'device.pairing', state: 'ready', message: 'The iPad is paired with this Mac.', actions: [] },
      { id: 'device.developer', state: 'action', message: 'Developer Mode is not enabled.', actions: ['Enable Developer Mode in Settings → Privacy & Security on the iPad, then restart it if Apple requests.'] },
      { id: 'device.os', state: 'ready', message: 'iPadOS 18.2 is in the supported baseline.', actions: [] },
      { id: 'device.unlocked', state: 'ready', message: 'CoreDevice reports that the iPad is unlocked for automation.', actions: [] },
      { id: 'pos.installed', state: 'ready', message: 'Shopify POS 9.28.0 (92800) is installed.', actions: [] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available.', actions: [] },
      { id: 'device.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is available.', actions: [] },
      { id: 'wda.session', state: 'action', message: 'WDA is blocked until host and device prerequisites pass.', actions: ['If Apple asks for a password, trust or UI Automation action, complete it yourself. The toolkit will not change those settings.'] },
      { id: 'pos.home', state: 'action', message: 'Shopify POS Home has not been verified by a live native accessibility query.', actions: ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.'] },
    ];
  } else if (previewMode.value === 'pos-missing') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [{ ...simulatedProfile }];
    editingExisting.value = true;
    firstRunStatus.value = 'idle';
    savedMessage.value = '';
    error.value = '';
    checks.value = [
      { id: 'device.pairing', state: 'ready', message: 'The iPad is paired with this Mac.', actions: [] },
      { id: 'device.developer', state: 'ready', message: 'Developer Mode is enabled.', actions: [] },
      { id: 'device.os', state: 'ready', message: 'iPadOS 18.2 is in the supported baseline.', actions: [] },
      { id: 'device.unlocked', state: 'ready', message: 'CoreDevice reports that the iPad is unlocked for automation.', actions: [] },
      { id: 'pos.installed', state: 'action', message: 'Shopify POS is not installed on the selected iPad.', actions: ['Install Shopify POS from the App Store and sign in to a test store yourself.'] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available.', actions: [] },
      { id: 'device.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is available.', actions: [] },
      { id: 'wda.session', state: 'action', message: 'WDA is blocked until host and device prerequisites pass.', actions: ['If Apple asks for a password, trust or UI Automation action, complete it yourself. The toolkit will not change those settings.'] },
      { id: 'pos.home', state: 'action', message: 'Shopify POS Home has not been verified by a live native accessibility query.', actions: ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.'] },
    ];
  } else if (previewMode.value === 'ready') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [{ ...simulatedProfile }];
    editingExisting.value = true;
    firstRunStatus.value = 'idle';
    savedMessage.value = '';
    error.value = '';
    checks.value = [
      { id: 'device.pairing', state: 'ready', message: 'The iPad is paired with this Mac.', actions: [] },
      { id: 'device.developer', state: 'ready', message: 'Developer Mode is enabled.', actions: [] },
      { id: 'device.os', state: 'ready', message: 'iPadOS 18.2 is in the supported baseline.', actions: [] },
      { id: 'device.unlocked', state: 'ready', message: 'CoreDevice reports that the iPad is unlocked for automation.', actions: [] },
      { id: 'pos.installed', state: 'ready', message: 'Shopify POS 9.28.0 (92800) is installed.', actions: [] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available.', actions: [] },
      { id: 'device.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is available.', actions: [] },
      { id: 'wda.session', state: 'action', message: 'A live WDA/Appium session has not been verified in this setup run.', actions: ['If Apple asks for a password, trust or UI Automation action, complete it yourself. The toolkit will not change those settings.'] },
      { id: 'pos.home', state: 'action', message: 'Shopify POS Home has not been verified by a live native accessibility query.', actions: ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.'] },
    ];
  } else if (previewMode.value === 'trust-required') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [{ ...simulatedProfile }];
    editingExisting.value = true;
    firstRunStatus.value = 'failed';
    firstRunId.value = 'simulated-run-trust';
    firstRunMessage.value = 'The WDA developer certificate is not trusted on the iPad. On the iPad, open Settings → General → VPN & Device Management, trust your development profile, then retry this test.';
    savedMessage.value = '';
    error.value = '';
    checks.value = [
      { id: 'device.pairing', state: 'ready', message: 'The iPad is paired with this Mac.', actions: [] },
      { id: 'device.developer', state: 'ready', message: 'Developer Mode is enabled.', actions: [] },
      { id: 'device.os', state: 'ready', message: 'iPadOS 18.2 is in the supported baseline.', actions: [] },
      { id: 'device.unlocked', state: 'ready', message: 'CoreDevice reports that the iPad is unlocked for automation.', actions: [] },
      { id: 'pos.installed', state: 'ready', message: 'Shopify POS 9.28.0 (92800) is installed.', actions: [] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available.', actions: [] },
      { id: 'device.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is available.', actions: [] },
      { id: 'wda.session', state: 'action', message: 'A live WDA/Appium session has not been verified in this setup run.', actions: ['Complete Apple’s trust step yourself under Settings → General → VPN & Device Management.'] },
      { id: 'pos.home', state: 'action', message: 'Shopify POS Home has not been verified by a live native accessibility query.', actions: ['Open Shopify POS yourself on Home, dismiss dialogs and keep the iPad unlocked before running.'] },
    ];
  } else if (previewMode.value === 'all-verified') {
    devices.value = [simulatedDevice];
    profile.value = { ...simulatedProfile };
    profiles.value = [{ ...simulatedProfile }];
    editingExisting.value = true;
    firstRunStatus.value = 'passed';
    firstRunId.value = 'simulated-run-001';
    savedMessage.value = '';
    error.value = '';
    checks.value = [
      { id: 'device.pairing', state: 'ready', message: 'The iPad is paired with this Mac.', actions: [] },
      { id: 'device.developer', state: 'ready', message: 'Developer Mode is enabled.', actions: [] },
      { id: 'device.os', state: 'ready', message: 'iPadOS 18.2 is in the supported baseline.', actions: [] },
      { id: 'device.unlocked', state: 'ready', message: 'CoreDevice reports that the iPad is unlocked for automation.', actions: [] },
      { id: 'pos.installed', state: 'ready', message: 'Shopify POS 9.28.0 (92800) is installed.', actions: [] },
      { id: 'signing.identity', state: 'ready', message: 'A valid Apple development identity is available.', actions: [] },
      { id: 'device.remote-xpc', state: 'ready', message: 'The Appium RemoteXPC tunnel registry is available.', actions: [] },
      { id: 'wda.session', state: 'ready', message: 'Live WDA/Appium session verified.', actions: [] },
      { id: 'pos.home', state: 'ready', message: 'Shopify POS accessibility query verified.', actions: [] },
    ];
  }
}

onMounted(() => {
  const urlParam = new URLSearchParams(window.location.search).get('preview');
  if (urlParam && ['no-device', 'unsaved-profile', 'locked-or-untrusted', 'dev-mode-disabled', 'pos-missing', 'ready', 'trust-required', 'all-verified'].includes(urlParam)) {
    previewMode.value = urlParam;
    applyPreview();
  } else {
    void loadRealData();
  }
});

onUnmounted(() => {
  if (firstRunTimer) {
    clearInterval(firstRunTimer);
    firstRunTimer = undefined;
  }
});
</script>

<style scoped>
.path-steps { max-width: 760px; margin: 0 0 1rem; padding-left: 1.35rem; }
.path-steps li { margin-bottom: .55rem; }
.path-note { max-width: 760px; }
.advanced-accordion { margin-top: 1rem; }
.advanced-accordion code { overflow-wrap: anywhere; }
.navigation-row { display: flex; gap: 0.75rem; flex-wrap: wrap; }

.first-run-card {
  margin-top: 1.5rem;
}

.checks-list {
  margin-top: 1rem;
}
</style>
