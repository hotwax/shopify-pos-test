import type { ScenarioDescriptor } from '../../shared/contracts.ts';

export const registry: ScenarioDescriptor[] = [
  {
    id: 'pos.open-first-order',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/open-first-order.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
];
