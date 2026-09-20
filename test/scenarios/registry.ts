import type { ScenarioDescriptor } from '../../shared/contracts.ts';

const gid = (pattern: string) => ({ type: 'string', pattern });
const quantity = { type: 'integer', minimum: 1, maximum: 100_000 };
const money = {
  type: 'object',
  additionalProperties: false,
  required: ['amount', 'currency'],
  properties: {
    amount: { type: 'string', pattern: '^[0-9]+(?:\\.[0-9]{1,2})?$' },
    currency: { type: 'string', pattern: '^[A-Z]{3}$' },
  },
};
const createLines = {
  type: 'array', minItems: 1, maxItems: 100,
  items: { type: 'object', additionalProperties: false, required: ['variantGid', 'quantity'], properties: { variantGid: gid('^gid://shopify/ProductVariant/[A-Za-z0-9_-]+$'), quantity } },
};
const returnLines = {
  type: 'array', minItems: 1, maxItems: 100,
  items: { type: 'object', additionalProperties: false, required: ['lineGid', 'quantity', 'restock'], properties: { lineGid: gid('^gid://shopify/LineItem/[A-Za-z0-9_-]+$'), quantity, restock: { type: 'boolean' } } },
};
const replacements = {
  type: 'array', minItems: 1, maxItems: 100,
  items: { type: 'object', additionalProperties: false, required: ['variantGid', 'quantity'], properties: { variantGid: gid('^gid://shopify/ProductVariant/[A-Za-z0-9_-]+$'), quantity } },
};

export const registry: ScenarioDescriptor[] = [
  {
    id: 'pos.inspect-cart',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-cart.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-screen',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-screen.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-product-search',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-product-search.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-order-actions',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-order-actions.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-return-surface',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-return-surface.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.navigate-home',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/navigate-home.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-location',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-location.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-store-context',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-store-context.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {},
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
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
  {
    id: 'pos.create-cash-order',
    version: 1,
    effect: 'create-order',
    entry: 'test/specs/mutation-not-ready.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { lines: createLines, maximumTotal: money, note: { type: 'string', maxLength: 200 } },
    },
    requiredCapabilities: ['pos-native-mutation', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms'],
  },
  {
    id: 'pos.return-cash-order',
    version: 1,
    effect: 'return',
    entry: 'test/specs/mutation-not-ready.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { orderGid: gid('^gid://shopify/Order/[A-Za-z0-9_-]+$'), lines: returnLines, maximumRefund: money, reason: { type: 'string', maxLength: 200 } },
    },
    requiredCapabilities: ['pos-native-mutation', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms'],
  },
  {
    id: 'pos.exchange-cash-order',
    version: 1,
    effect: 'exchange',
    entry: 'test/specs/mutation-not-ready.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        orderGid: gid('^gid://shopify/Order/[A-Za-z0-9_-]+$'),
        lines: returnLines,
        maximumRefund: money,
        reason: { type: 'string', maxLength: 200 },
        replacements,
        direction: { enum: ['collect', 'even', 'refund'] },
        maximumDifference: money,
      },
    },
    requiredCapabilities: ['pos-native-mutation', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms'],
  },
];
