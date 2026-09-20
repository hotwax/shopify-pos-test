// Observed through WDA on Shopify POS 11.14.0, iPadOS 27.0 (2026-09-19).
// No customer/order IDs or coordinates. Keep queries scoped as noted below.
export const homeScreen = '~Screen.Home';
export const cartScreen = '~Screen.Cart';
export const checkoutButton = '~Screen.Cart.CheckoutButton';
export const addCartButton = '~Screen.Cart.AddCartButton';
export const searchBar = '~Component.SearchBar';
// Observed only as a native type after opening the Home search button. The
// diagnostic intentionally requires exactly one visible field instead of
// guessing a version-specific accessibility identifier.
export const productSearchField = '-ios predicate string:type == "XCUIElementTypeSearchField"';
// Observed in the order-detail accessibility tree. This is diagnostic-only;
// mutation workflows must still prove the current action surface and all
// post-action readback before they can be registered.
export const returnOrExchangeAction = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Return or exchange"';
export const homeTab = '~Component.AppNavigation.BottomTabs.Home';
export const ordersTab = '~Component.AppNavigation.BottomTabs.Orders';
export const ordersScreen = '~Screen.OrdersScreen';
export const ordersList = '~Screen.OrdersList';
export const orderRows = '-ios predicate string:type == "XCUIElementTypeButton" AND name BEGINSWITH "Component.OrdersList.Order."';
// OrdersList also contains a horizontal filter scroll view. Select the one
// containing actual order buttons, never the filter or sidebar scroll view.
export const orderScroll = '-ios class chain:**/XCUIElementTypeScrollView[$type == "XCUIElementTypeButton" AND name BEGINSWITH "Component.OrdersList.Order."$]';
export const verticalScrollbars = '-ios predicate string:type == "XCUIElementTypeOther" AND name BEGINSWITH "Vertical scroll bar"';
// Row references are not separate elements: read the row's combined label.
export const rowReference = 'label';
export const loading = '~Component.ActivityIndicator';
// Observed safe no-match search. Other empty states fail the bounded row wait.
export const emptySearch = '-ios predicate string:type == "XCUIElementTypeStaticText" AND label BEGINSWITH "No orders found for"';
// Screen.OrderDetailsScreen occurs twice; TopSection.Content is unique.
export const detailContent = '~Screen.OrderDetailsScreen.TopSection.Content';
export const detailReference = '~OrderDetailsHeader.Title';
// Observed on the order-detail modal; this is the native Close button, not a
// coordinate or a business action.
export const detailCloseButton = '~Component.ActionBar.PrimaryActionButton';
