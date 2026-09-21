import { defineStore } from 'pinia';
import {
  forgetTestEnvironment,
  readTestEnvironment,
  rememberTestEnvironment,
  type TestEnvironmentSelection,
} from '../test-environment.ts';

export interface TestEnvState {
  savedEnvironment: TestEnvironmentSelection | null;
  instanceName: string;
  connectorShopId: string;
  locationGid: string;
  locationName: string;
}

export const useTestEnvStore = defineStore('testEnv', {
  state: (): TestEnvState => {
    const initial = readTestEnvironment();
    return {
      savedEnvironment: initial,
      instanceName: initial?.instanceName ?? '',
      connectorShopId: initial?.connectorShopId ?? '',
      locationGid: initial?.locationGid ?? '',
      locationName: '',
    };
  },

  getters: {
    hasSavedEnvironment: (state) => Boolean(state.savedEnvironment),
    activeInstanceName: (state) => state.instanceName || state.savedEnvironment?.instanceName || '',
    activeShopId: (state) => state.connectorShopId || state.savedEnvironment?.connectorShopId || '',
    activeLocationGid: (state) => state.locationGid || state.savedEnvironment?.locationGid || '',
    isSaved: (state) => (instanceName: string, shopId: string, locationGid: string) => {
      return Boolean(
        state.savedEnvironment &&
        state.savedEnvironment.instanceName.toLowerCase().trim() === instanceName.toLowerCase().trim() &&
        state.savedEnvironment.connectorShopId.trim() === shopId.trim() &&
        state.savedEnvironment.locationGid.trim() === locationGid.trim(),
      );
    },
  },

  actions: {
    saveEnvironment(selection: TestEnvironmentSelection, locationName?: string, storage?: Storage): void {
      rememberTestEnvironment(selection, storage);
      this.savedEnvironment = readTestEnvironment(storage) ?? {
        instanceName: selection.instanceName.toLowerCase().trim(),
        connectorShopId: selection.connectorShopId.trim(),
        locationGid: selection.locationGid.trim(),
      };
      this.instanceName = this.savedEnvironment.instanceName;
      this.connectorShopId = this.savedEnvironment.connectorShopId;
      this.locationGid = this.savedEnvironment.locationGid;
      if (locationName !== undefined) {
        this.locationName = locationName;
      }
    },

    setFacility(locationGid: string, locationName?: string): void {
      this.locationGid = locationGid;
      if (locationName !== undefined) {
        this.locationName = locationName;
      }
    },

    setLocationGid(locationGid: string, locationName?: string): void {
      this.setFacility(locationGid, locationName);
    },

    setShop(connectorShopId: string): void {
      this.connectorShopId = connectorShopId;
      if (this.savedEnvironment && this.savedEnvironment.connectorShopId !== connectorShopId) {
        this.locationGid = '';
        this.locationName = '';
      }
    },

    setInstance(instanceName: string): void {
      this.instanceName = instanceName;
    },

    clearEnvironment(storage?: Storage): void {
      forgetTestEnvironment(storage);
      this.savedEnvironment = null;
      this.instanceName = '';
      this.connectorShopId = '';
      this.locationGid = '';
      this.locationName = '';
    },

    loadSavedEnvironment(storage?: Storage): TestEnvironmentSelection | null {
      this.savedEnvironment = readTestEnvironment(storage);
      if (this.savedEnvironment) {
        this.instanceName = this.savedEnvironment.instanceName;
        this.connectorShopId = this.savedEnvironment.connectorShopId;
        this.locationGid = this.savedEnvironment.locationGid;
      }
      return this.savedEnvironment;
    },
  },
});
