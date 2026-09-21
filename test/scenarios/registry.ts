import type { ScenarioDescriptor } from '../../shared/contracts.ts';
import { returnReasons } from '../../shared/return-reason.ts';
import { refundMethods } from '../../core/safety/transaction-inputs.ts';

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
  items: {
    type: 'object', additionalProperties: false,
    required: ['variantGid', 'productGid', 'search', 'quantity'],
    properties: {
      variantGid: gid('^gid://shopify/ProductVariant/[A-Za-z0-9_-]+$'),
      // POS search rows are identified by product id, so the product GID is
      // required alongside the variant that read-back verifies.
      productGid: gid('^gid://shopify/Product/[A-Za-z0-9_-]+$'),
      search: { type: 'string', minLength: 1, maxLength: 60 },
      imageUrl: { type: 'string', pattern: '^https://', maxLength: 500 },
      quantity,
      // Planned POS add-to-cart path: a single-variant product is added on the
      // product tap, a multi-variant product needs its exact variant chosen
      // from the picker. Optional so older requests still validate as unknown.
      variantSelection: { type: 'string', enum: ['single', 'multi', 'unknown'] },
    },
  },
};
/**
 * Per line, because Shopify POS asks per line: one restock switch, one reason
 * picker and one note field inside each selected item's own panel. A plan that
 * carried one reason for the whole return could not express "this one was
 * damaged, that one was the wrong size", which is the case the suite has to
 * cover.
 */
const returnLines = {
  type: 'array', minItems: 1, maxItems: 100,
  items: {
    type: 'object', additionalProperties: false,
    required: ['lineGid', 'quantity', 'restock'],
    properties: {
      lineGid: gid('^gid://shopify/LineItem/[A-Za-z0-9_-]+$'),
      quantity,
      restock: { type: 'boolean' },
      // The exact Shopify ReturnReason values POS offers. Optional: an
      // unconfigured line is returned as UNKNOWN, which is what POS records
      // when the operator skips the picker.
      reason: { type: 'string', enum: [...returnReasons] },
      note: { type: 'string', maxLength: 200, pattern: '^[^\\u0000\\r\\n]*$' },
    },
  },
};
/**
 * A replacement is added through the same POS product search a sale uses, so
 * it carries the same identifiers: the variant is the business identity read
 * back from Shopify, the product is what the native row is matched on, and
 * the selection says whether a variant picker is expected.
 */
const replacements = {
  type: 'array', minItems: 1, maxItems: 100,
  items: {
    type: 'object', additionalProperties: false,
    required: ['variantGid', 'productGid', 'search', 'quantity'],
    properties: {
      variantGid: gid('^gid://shopify/ProductVariant/[A-Za-z0-9_-]+$'),
      productGid: gid('^gid://shopify/Product/[A-Za-z0-9_-]+$'),
      search: { type: 'string', minLength: 1, maxLength: 60 },
      imageUrl: { type: 'string', pattern: '^https://', maxLength: 500 },
      quantity,
      variantSelection: { type: 'string', enum: ['single', 'multi', 'unknown'] },
    },
  },
};
/** How the money goes back. POS offers both on its refund-method chooser. */
const refundMethod = { type: 'string', enum: [...refundMethods] };
/**
 * What the exchange does with the source order's customer. Replacing one
 * needs the exact customer; keeping or removing must not carry a GID, which
 * the input validator enforces beyond what the schema can express.
 */
const exchangeCustomer = {
  type: 'object', additionalProperties: false,
  required: ['action'],
  properties: { action: { type: 'string', enum: ['keep', 'remove', 'replace'] }, gid: gid('^gid://shopify/Customer/[A-Za-z0-9_-]+$') },
};
const orderReference = { type: 'string', minLength: 1, maxLength: 120, pattern: '^[^\\u0000\\r\\n]+$' };

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
    id: 'pos.inspect-product-selection',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-product-selection.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        search: { type: 'string', minLength: 1, maxLength: 60 },
        productId: { type: 'string', pattern: '^[0-9]{5,20}$' },
      },
      required: ['productId'],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-walk',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-walk.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        steps: {
          type: 'array', maxItems: 12,
          items: {
            type: 'object', additionalProperties: false, required: ['selector', 'capture'],
            properties: {
              selector: { type: 'string', minLength: 1, maxLength: 300 },
              capture: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,60}$' },
              type: { type: 'string', maxLength: 60 },
              tap: { enum: ['element', 'coordinate'] },
            },
          },
        },
        allowLabels: { type: 'array', maxItems: 6, items: { type: 'string', minLength: 1, maxLength: 60 } },
      },
      required: ['steps'],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-product-results',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-product-results.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { search: { type: 'string', minLength: 1, maxLength: 60 } },
      required: [],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.clear-cart',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/clear-cart.spec.ts',
    parameterSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-cart-actions',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-cart-actions.spec.ts',
    parameterSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-cash-tender',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-cash-tender.spec.ts',
    parameterSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-checkout-surface',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-checkout-surface.spec.ts',
    parameterSchema: { type: 'object', additionalProperties: false, properties: {}, required: [] },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    id: 'pos.inspect-custom-sale',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/inspect-custom-sale.spec.ts',
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
      properties: { orderReference },
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
    id: 'pos.build-cart-only',
    version: 1,
    effect: 'read-only',
    entry: 'test/specs/build-cart-only.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { lines: createLines, currency: { type: 'string', pattern: '^[A-Z]{3}$' } },
      required: ['lines', 'currency'],
    },
    requiredCapabilities: ['pos-native-read'],
    supportedAssertionModes: ['pos'],
  },
  {
    // Everything a return does except the last tap. It exists because the
    // fragile part of a return is the device work, not the commit, and a
    // rehearsal that reaches the refund-method chooser has proven every step
    // the real run makes before it records a commit attempt. It tenders
    // nothing and clears its own cart, so it creates no business data.
    id: 'pos.rehearse-return',
    version: 2,
    effect: 'read-only',
    entry: 'test/specs/rehearse-return.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['orderGid', 'lines'],
      properties: {
        orderGid: gid('^gid://shopify/Order/[A-Za-z0-9_-]+$'),
        orderReference,
        lines: returnLines,
        refundMethod,
        // Replacements turn the rehearsal into an exchange rehearsal: the
        // same return work plus the replacement side, still stopping before
        // any tender. The direction is then checked against what the cart
        // actually reads, which is how a lesser or greater exchange is
        // proven without spending one.
        replacements,
        direction: { enum: ['collect', 'even', 'refund'] },
        maximumDifference: money,
        collectMethod: { type: 'string', enum: ['cash'] },
        customer: exchangeCustomer,
      },
    },
    requiredCapabilities: ['pos-native-read', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms', 'pos'],
  },
  {
    // The exchange shape of the rehearsal: the same spec, but the planner
    // treats it as an exchange so replacements, direction and the maximum
    // difference are part of the plan. Separate from pos.rehearse-return
    // because the planner switches on the scenario id, not on whether the
    // operator happened to add a replacement.
    // Everything a return does except the last tap. It exists because the
    // fragile part of a return is the device work, not the commit, and a
    // rehearsal that reaches the refund-method chooser has proven every step
    // the real run makes before it records a commit attempt. It tenders
    // nothing and clears its own cart, so it creates no business data.
    id: 'pos.rehearse-exchange',
    version: 2,
    effect: 'read-only',
    entry: 'test/specs/rehearse-return.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['orderGid', 'lines', 'replacements', 'direction', 'maximumDifference'],
      properties: {
        orderGid: gid('^gid://shopify/Order/[A-Za-z0-9_-]+$'),
        orderReference,
        lines: returnLines,
        refundMethod,
        // Replacements turn the rehearsal into an exchange rehearsal: the
        // same return work plus the replacement side, still stopping before
        // any tender. The direction is then checked against what the cart
        // actually reads, which is how a lesser or greater exchange is
        // proven without spending one.
        replacements,
        direction: { enum: ['collect', 'even', 'refund'] },
        maximumDifference: money,
        collectMethod: { type: 'string', enum: ['cash'] },
        customer: exchangeCustomer,
      },
    },
    requiredCapabilities: ['pos-native-read', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms', 'pos'],
  },
  {
    id: 'pos.create-cash-order',
    version: 1,
    effect: 'create-order',
    entry: 'test/specs/create-cash-order.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      properties: { lines: createLines, currency: { type: 'string', pattern: '^[A-Z]{3}$' }, note: { type: 'string', maxLength: 200 } },
    },
    requiredCapabilities: ['pos-native-mutation', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms'],
  },
  {
    id: 'pos.return-cash-order',
    version: 2,
    effect: 'return',
    entry: 'test/specs/return-cash-order.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['orderGid', 'lines'],
      properties: { orderGid: gid('^gid://shopify/Order/[A-Za-z0-9_-]+$'), orderReference, lines: returnLines, refundMethod },
    },
    requiredCapabilities: ['pos-native-mutation', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms'],
  },
  {
    id: 'pos.exchange-cash-order',
    version: 2,
    effect: 'exchange',
    entry: 'test/specs/exchange-cash-order.spec.ts',
    parameterSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['orderGid', 'lines', 'replacements', 'direction', 'maximumDifference'],
      properties: {
        orderGid: gid('^gid://shopify/Order/[A-Za-z0-9_-]+$'),
        orderReference,
        lines: returnLines,
        refundMethod,
        replacements,
        direction: { enum: ['collect', 'even', 'refund'] },
        maximumDifference: money,
        // Only cash is automatable for collecting a difference; POS's other
        // tenders need a reader, a card number, or a gift-card code Shopify
        // will not disclose.
        collectMethod: { type: 'string', enum: ['cash'] },
        customer: exchangeCustomer,
      },
    },
    requiredCapabilities: ['pos-native-mutation', 'shopify-oms-read'],
    supportedAssertionModes: ['pos-shopify-oms'],
  },
];
