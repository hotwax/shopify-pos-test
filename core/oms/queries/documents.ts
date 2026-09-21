export const searchVariantsQuery = `query SearchVariants($first: Int!, $after: String, $query: String) {
  productVariants(first: $first, after: $after, query: $query) {
    nodes { id title sku product { id title } }
    pageInfo { hasNextPage endCursor }
  }
}`;

// The planner needs the price and the stock the operator will actually see at
// the expected POS location, so it uses this location-scoped document. It also
// reads the product's variant facts (hasOnlyDefaultVariant, variantsCount): POS
// adds a single-variant product directly but opens a variant picker for a
// multi-variant one, and the run is told which path to expect. The
// unscoped SearchVariants above is kept byte-for-byte for the OMS explorer,
// which has no location context.
export const searchVariantsAtLocationQuery = `query SearchVariantsAtLocation($first: Int!, $after: String, $query: String, $locationId: ID!) {
  productVariants(first: $first, after: $after, query: $query) {
    nodes {
      id title sku price compareAtPrice availableForSale inventoryQuantity
      image { url altText }
      product { id title status hasOnlyDefaultVariant variantsCount { count precision } featuredImage { url altText } }
      inventoryItem {
        tracked
        inventoryLevel(locationId: $locationId) {
          quantities(names: ["available"]) { name quantity }
        }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const searchOrdersQuery = `query SearchOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    nodes { id name displayFinancialStatus displayFulfillmentStatus }
    pageInfo { hasNextPage endCursor }
  }
}`;

// One reviewed document serves every order read-back. Returns, refunds and
// fulfillments ride along because a return run has to prove restock type,
// return reason and the refund's own tender, and the planner has to know which
// lines POS will actually offer (only fulfilled ones are returnable).
// `returns` and `returnLineItems` are connections, `refunds` is a plain list,
// and `fulfillmentLineItem` lives only on the concrete ReturnLineItem, so the
// inline fragment is required. All of this was validated against the live OMS
// proxy on 2026-09-21 at apiVersion 2026-01.
export const resolveOrderQuery = `query ResolveOrder($id: ID!, $lineFirst: Int!, $lineAfter: String) {
  order(id: $id) {
    id legacyResourceId name displayFinancialStatus displayFulfillmentStatus paymentGatewayNames
    customer { id firstName lastName email phone }
    transactions { id kind status gateway amountSet { shopMoney { amount currencyCode } } }
    agreements(first: 25) {
      nodes {
        __typename id happenedAt
        ... on ReturnAgreement {
          return { id name }
          sales(first: 50) {
            nodes {
              actionType lineType quantity
              totalAmount { shopMoney { amount currencyCode } }
              ... on ProductSale { lineItem { id variant { id } } }
            }
          }
        }
      }
    }
    totalPriceSet { shopMoney { amount currencyCode } }
    returnStatus
    fulfillments(first: 25) {
      id status
      fulfillmentLineItems(first: 50) { nodes { quantity lineItem { id } } }
    }
    returns(first: 20) {
      nodes {
        id name status totalQuantity
        returnLineItems(first: 50) {
          nodes {
            id quantity returnReason returnReasonNote customerNote
            ... on ReturnLineItem { fulfillmentLineItem { lineItem { id } } }
          }
        }
      }
      pageInfo { hasNextPage }
    }
    refunds(first: 20) {
      id createdAt
      totalRefundedSet { shopMoney { amount currencyCode } }
      refundLineItems(first: 50) { nodes { quantity restockType lineItem { id } } }
      transactions(first: 20) { nodes { id kind status gateway amountSet { shopMoney { amount currencyCode } } } }
    }
    lineItems(first: $lineFirst, after: $lineAfter) {
      nodes {
        id quantity refundableQuantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        variant { id title sku product { id title hasOnlyDefaultVariant variantsCount { count precision } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

// Recent POS-originated orders for the "use an existing order" picker. The
// source filter and sort are baked into the reviewed document so no caller can
// widen it to every order in the store.
export const listPosOrdersQuery = `query ListPosOrders($first: Int!, $after: String) {
  orders(first: $first, after: $after, query: "source_name:pos", sortKey: CREATED_AT, reverse: true) {
    nodes {
      id name createdAt displayFinancialStatus displayFulfillmentStatus
      customer { displayName }
      totalPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 5) {
        nodes { title quantity }
        pageInfo { hasNextPage }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const searchCustomersQuery = `query SearchCustomers($first: Int!, $after: String, $query: String) {
  customers(first: $first, after: $after, query: $query) {
    nodes {
      id displayName firstName lastName email phone numberOfOrders
      defaultAddress { city province country }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const listLocationsQuery = `query ListLocations($first: Int!, $after: String) {
  locations(first: $first, after: $after) {
    nodes { id name }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const namedReadQueries = {
  searchVariants: searchVariantsQuery,
  searchVariantsAtLocation: searchVariantsAtLocationQuery,
  searchOrders: searchOrdersQuery,
  searchCustomers: searchCustomersQuery,
  listPosOrders: listPosOrdersQuery,
  resolveOrder: resolveOrderQuery,
  listLocations: listLocationsQuery,
} as const;

export type NamedReadOperation = keyof typeof namedReadQueries;

export function assertNamedReadQuery(operation: NamedReadOperation, query: string): void {
  if (!query.startsWith('query ')) throw new Error(`The ${operation} operation must be a GraphQL query.`);
  if (query !== namedReadQueries[operation]) throw new Error(`The ${operation} query is not the reviewed document.`);
}
