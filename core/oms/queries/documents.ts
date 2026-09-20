export const searchVariantsQuery = `query SearchVariants($first: Int!, $after: String, $query: String) {
  productVariants(first: $first, after: $after, query: $query) {
    nodes { id title sku product { id title } }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const searchOrdersQuery = `query SearchOrders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query) {
    nodes { id name displayFinancialStatus displayFulfillmentStatus }
    pageInfo { hasNextPage endCursor }
  }
}`;

export const resolveOrderQuery = `query ResolveOrder($id: ID!, $lineFirst: Int!, $lineAfter: String) {
  order(id: $id) {
    id legacyResourceId name displayFinancialStatus displayFulfillmentStatus
    totalPriceSet { shopMoney { amount currencyCode } }
    lineItems(first: $lineFirst, after: $lineAfter) {
      nodes {
        id quantity refundableQuantity
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        variant { id title sku product { id title } }
      }
      pageInfo { hasNextPage endCursor }
    }
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
  searchOrders: searchOrdersQuery,
  resolveOrder: resolveOrderQuery,
  listLocations: listLocationsQuery,
} as const;

export type NamedReadOperation = keyof typeof namedReadQueries;

export function assertNamedReadQuery(operation: NamedReadOperation, query: string): void {
  if (!query.startsWith('query ')) throw new Error(`The ${operation} operation must be a GraphQL query.`);
  if (query !== namedReadQueries[operation]) throw new Error(`The ${operation} query is not the reviewed document.`);
}
