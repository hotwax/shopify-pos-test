import { defineStore } from 'pinia';
import type { OmsCustomer, OmsShopifyOrderDetail, OmsVariant } from '../../shared/contracts.ts';
import { plannedVariantSelection, type VariantSelection } from '../../shared/variant-selection.ts';

export type CartOrigin = 'new' | 'order';

export interface CartLine {
  variantGid: string;
  /** POS result rows are keyed by product id, so the run needs it to select. */
  productGid: string;
  /** Display only. Frozen with the run so the record still shows what was ordered. */
  imageUrl: string | null;
  productTitle: string;
  variantTitle: string;
  sku: string | null;
  unitPrice: string | null;
  quantity: number;
  availableAtLocation: number | null;
  inventoryTracked: boolean | null;
  /**
   * Which POS add-to-cart routine the run should use for this product. It is
   * decided here, from the product's variant facts, and frozen with the run.
   */
  variantSelection: VariantSelection;
  /** Exact variant count of the parent product when Shopify reported one. */
  productVariantCount: number | null;
}

// Fields the native runner cannot perform yet. They are kept in the cart so a
// tester can describe the order they mean to build, but `executableLines` and
// the frozen run parameters never read them. Everything here is planning notes
// until the transaction contract and the native POS selectors carry it.
// Either a customer that already exists in the test store, or the details a
// tester wants the run to enter in Shopify POS's own "add customer" form. The
// second kind is never created here: this app exposes no Shopify mutation.
export interface PlannedCustomer {
  mode: 'existing' | 'new';
  gid: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  acceptsMarketing: boolean;
  note: string;
}

export interface PlanningOnlyCart {
  deliveryMethod: string;
  discountCodes: string[];
  giftCardCodes: string[];
  customer: PlannedCustomer | null;
}

export function emptyCustomer(): PlannedCustomer {
  return { mode: 'new', gid: '', firstName: '', lastName: '', email: '', phone: '', acceptsMarketing: false, note: '' };
}

export function customerLabel(customer: PlannedCustomer): string {
  const name = [customer.firstName, customer.lastName].map(part => part.trim()).filter(Boolean).join(' ');
  return [name, customer.email.trim(), customer.phone.trim()].filter(Boolean).join(' · ') || 'Unnamed customer';
}

// Shopify needs at least one way to identify a new customer, which is what its
// POS add-customer form enforces too.
export function customerIsUsable(customer: PlannedCustomer): boolean {
  if (customer.mode === 'existing') return Boolean(customer.gid);
  return [customer.firstName, customer.lastName, customer.email, customer.phone].some(value => value.trim());
}


export const deliveryMethods = ['In store', 'Ship to customer', 'Local delivery', 'Pickup in store'] as const;

function lineFromVariant(variant: OmsVariant, quantity: number): CartLine {
  return {
    variantGid: variant.gid,
    productGid: variant.productGid,
    imageUrl: variant.imageUrl ?? null,
    productTitle: variant.productTitle || 'Unnamed product',
    variantTitle: variant.title,
    sku: variant.sku,
    unitPrice: variant.price,
    quantity,
    availableAtLocation: variant.availableAtLocation,
    inventoryTracked: variant.inventoryTracked,
    variantSelection: plannedVariantSelection(variant),
    productVariantCount: variant.productVariantCount,
  };
}

export const useCartStore = defineStore('cart', {
  state: () => ({
    origin: 'new' as CartOrigin,
    sourceOrderGid: '',
    sourceOrderReference: '',
    lines: [] as CartLine[],
    currency: 'USD',
    note: '',
    planning: {
      deliveryMethod: 'In store',
      discountCodes: [] as string[],
      giftCardCodes: [] as string[],
      customer: null as PlannedCustomer | null,
    } as PlanningOnlyCart,
  }),

  getters: {
    itemCount: state => state.lines.reduce((total, line) => total + line.quantity, 0),
    isEmpty: state => state.lines.length === 0,
    hasLine: state => (variantGid: string) => state.lines.some(line => line.variantGid === variantGid),

    // Null when any line has no price, so the UI reports an unknown subtotal
    // rather than a confident number built from missing data.
    subtotal(state): string | null {
      if (!state.lines.length) return null;
      let total = 0;
      for (const line of state.lines) {
        // `Number(null)` is 0, so a missing price must be rejected before parsing
        // or a priceless line would silently count as free.
        if (line.unitPrice === null || line.unitPrice.trim() === '') return null;
        const unit = Number(line.unitPrice);
        if (!Number.isFinite(unit)) return null;
        total += unit * line.quantity;
      }
      return total.toFixed(2);
    },

    // The only part of the cart a run is frozen against.
    // `search` is what the native run types into POS product search before
    // matching the row by exact product id. `variantSelection` tells the run
    // whether to expect the product to drop into the cart or to open the
    // variant picker first.
    executableLines: state => state.lines.map(line => ({
      variantGid: line.variantGid,
      productGid: line.productGid,
      // Product title is the term verified against POS product search; a SKU
      // is not guaranteed to match there.
      search: line.productTitle,
      quantity: line.quantity,
      variantSelection: line.variantSelection,
    })),

    // Lines whose POS add-to-cart path could not be planned, so the UI can say
    // the run will have to watch which surface POS opens for them.
    unplannedSelectionLines: state => state.lines.filter(line => line.variantSelection === 'unknown'),

    // Planning-only entries the tester has filled in, for the "not executed"
    // notice. Empty means the cart is fully executable as described.
    planningOnlyInUse(state): string[] {
      const used: string[] = [];
      if (state.planning.deliveryMethod.trim() && state.planning.deliveryMethod !== 'In store') used.push('Delivery method');
      if (state.planning.discountCodes.length) used.push('Discount codes');
      if (state.planning.giftCardCodes.length) used.push('Gift card codes');
      if (state.planning.customer) used.push('Customer');
      return used;
    },

    overstockedLines: state => state.lines.filter(line => line.inventoryTracked !== false && line.availableAtLocation !== null && line.quantity > line.availableAtLocation),
  },

  actions: {
    addVariant(variant: OmsVariant, quantity = 1): void {
      const existing = this.lines.find(line => line.variantGid === variant.gid);
      if (existing) { existing.quantity += quantity; return; }
      this.lines.push(lineFromVariant(variant, quantity));
    },

    removeLine(variantGid: string): void {
      this.lines = this.lines.filter(line => line.variantGid !== variantGid);
    },

    setQuantity(variantGid: string, quantity: number): void {
      const line = this.lines.find(entry => entry.variantGid === variantGid);
      if (!line) return;
      if (!Number.isSafeInteger(quantity) || quantity < 1) return;
      line.quantity = quantity;
    },

    setExistingCustomer(customer: OmsCustomer): void {
      this.planning.customer = {
        mode: 'existing',
        gid: customer.gid,
        firstName: customer.firstName ?? '',
        lastName: customer.lastName ?? '',
        email: customer.email ?? '',
        phone: customer.phone ?? '',
        acceptsMarketing: false,
        note: '',
      };
    },

    setNewCustomer(customer: PlannedCustomer): void {
      this.planning.customer = { ...customer, mode: 'new', gid: '' };
    },

    clearCustomer(): void { this.planning.customer = null; },

    addCode(kind: 'discountCodes' | 'giftCardCodes', code: string): void {
      const value = code.trim();
      if (!value || this.planning[kind].includes(value)) return;
      this.planning[kind].push(value);
    },

    removeCode(kind: 'discountCodes' | 'giftCardCodes', code: string): void {
      this.planning[kind] = this.planning[kind].filter(entry => entry !== code);
    },

    startNew(currency: string): void {
      this.$reset();
      this.currency = currency || 'USD';
    },

    // Seeds the cart from a real Shopify order so a tester can adjust it into
    // the order they actually want. Lines without an exact variant AND product
    // GID are skipped: the runner re-purchases an exact variant, and it selects
    // the native row by product id.
    startFromOrder(detail: OmsShopifyOrderDetail, currency: string): void {
      this.$reset();
      this.origin = 'order';
      this.sourceOrderGid = detail.gid;
      this.sourceOrderReference = detail.name;
      this.currency = detail.total?.currency || currency || 'USD';
      this.lines = detail.lines
        .filter(line => Boolean(line.variantGid) && Boolean(line.productGid))
        .map(line => ({
          variantGid: line.variantGid as string,
          productGid: line.productGid as string,
          imageUrl: null,
          productTitle: line.productTitle || 'Unnamed product',
          variantTitle: line.variantTitle || 'Default',
          sku: line.sku,
          unitPrice: line.unitPrice?.amount ?? null,
          quantity: line.quantity,
          availableAtLocation: null,
          inventoryTracked: null,
          variantSelection: plannedVariantSelection(line),
          productVariantCount: line.productVariantCount,
        }));
      // A cloned order keeps the customer it was placed for, so the tester does
      // not have to re-enter them. It stays planning metadata like any other
      // customer: the runner does not create or attach it.
      if (detail.customer) {
        this.planning.customer = {
          mode: 'existing',
          gid: detail.customer.gid,
          firstName: detail.customer.firstName,
          lastName: detail.customer.lastName,
          email: detail.customer.email,
          phone: detail.customer.phone,
          acceptsMarketing: false,
          note: '',
        };
      }
    },

    // Lines the source order had that could not be copied, so the tester is
    // told rather than silently given a shorter cart.
    skippedFromOrder(detail: OmsShopifyOrderDetail): number {
      return detail.lines.filter(line => !line.variantGid).length;
    },
  },
});
