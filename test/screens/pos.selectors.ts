// Observed through WDA on Shopify POS 11.14.0, iPadOS 27.0 (2026-09-19).
// No customer/order IDs or coordinates. Keep queries scoped as noted below.
export const homeScreen = '~Screen.Home';
export const cartScreen = '~Screen.Cart';
export const checkoutButton = '~Screen.Cart.CheckoutButton';
export const addCartButton = '~Screen.Cart.AddCartButton';
export const searchBar = '~Component.SearchBar';
// Observed on Home (POS 11.14.0). The custom-sale tile is the shortest path to
// a priced cart line; it does not itself commit anything.
export const addCustomSaleTile = '~Screen.Home.Tile.AddCustomSale';
// Custom sale surface (POS 11.14.0). Note the action bar naming: the PRIMARY
// button is "Cancel" and the SECONDARY button is "Save", which stays disabled
// until a price is entered. Never tap these by position.
export const customSaleScreen = '~Screen.CustomSale';
export const customSalePriceField = '~Screen.CustomSale.PriceField';
export const customSaleCancelButton = '~Component.ActionBar.PrimaryActionButton';
export const customSaleSaveButton = '~Component.ActionBar.SecondaryActionButton';
export const numericKey = (digit: string) => `~NumericKeyboard/Number/${digit}`;
// Payment selection (POS 11.14.0). Tapping a tender opens its entry surface; it
// does not by itself complete a sale.
export const checkoutSelectPayment = '~Screen.CheckoutSelectPayment';
export const cashTenderButton = '~Screen.CheckoutSelectPayment.Cash';
// Cash tender surface (POS 11.14.0). The first amount chip is the exact cart
// total. Tapping that chip completes the sale by itself: two runs on
// 2026-09-21 created Shopify orders HCDEV#5853 and HCDEV#5854 the moment the
// chip was tapped, while still waiting for Apply. Apply stays disabled until an
// amount is entered by hand and is only a fallback when the surface stays open.
export const acceptCashScreen = '~Screen.AcceptCash';
export const acceptCashExactAmount = '~Screen.AcceptCash.AmountReceivedOption1';
export const acceptCashApplyButton = '~Screen.AcceptCash.ApplyButton';
export const acceptCashCancelButton = '~Screen.AcceptCash.CancelButton';
// Receipt surface shown once cash is taken (POS 11.14.0, run-1789951771464).
// Done returns POS to Home with an empty cart; Email/Text send receipts and
// are never touched.
export const checkoutCompleteScreen = '~Screen.CheckoutComplete';
export const checkoutCompleteDoneButton = '~Screen.CheckoutComplete.DoneButton';
export const cartMoreActionsButton = '~Screen.Cart.MoreActionsButton';
export const moreActionsSaveCart = '~Screen.MoreActions.SaveCart';
// Product search (POS 11.14.0). Result rows carry the numeric Shopify product
// id in their identifier, so a product is selected by exact id, never by name
// or position. `~` is an accessibility-id match, so the id must be exact.
export const searchScreenResults = '~Screen.Search.ResultList';
export const searchTextInput = '~Component.SearchBar.TextInput';
export const searchCancelButton = '~Component.SearchBar.ClearText';
export const productRow = (productId: string) => `~Component.ProductBaseRow.Product.${productId}`;
// A multi-variant product does NOT drop straight into the cart: tapping its
// search row opens this picker and waits for an exact variant. Observed on POS
// 11.14.0 in runs run-1789941033628 and run-1789944068317. A product with only
// its default variant skips the picker and adds on the product tap (run
// run-1789948939621). The planner records which shape to expect in each
// line's `variantSelection`; see shared/variant-selection.ts. Rows carry the
// numeric Shopify VARIANT id, so a variant is chosen by exact id, never by
// position or option name.
export const variantListScreen = '~Screen.VariantList';
export const variantRow = (variantId: string) => `~Screen.VariantList.ProductVariantListItem.${variantId}`;
export const variantRows = '-ios predicate string:name BEGINSWITH "Screen.VariantList.ProductVariantListItem."';
// The picker row is a non-accessible container holding two buttons: the
// add-to-cart label, and a "View product details" chevron at the right edge.
// Tapping the chevron opens details instead of adding, so it is excluded.
export const variantDetailsButton = 'View product details';

// Cart lines are indexed in add order and their label carries name and price.
export const cartLineItem = (index: number) => `~Screen.Cart.cartLineItem-${index}`;
// Any cart line at all: the direct "cart is not empty" signal. The dual-purpose
// Add/Clear cart control keeps the label "Clear cart" (disabled) after a sale,
// so its label alone cannot say whether the cart is empty.
export const anyCartLineItem = '-ios predicate string:name BEGINSWITH "Screen.Cart.cartLineItem-"';
// Observed only as a native type after opening the Home search button. The
// diagnostic intentionally requires exactly one visible field instead of
// guessing a version-specific accessibility identifier.
export const productSearchField = '-ios predicate string:type == "XCUIElementTypeSearchField"';
// Observed in the order-detail accessibility tree. This is diagnostic-only;
// mutation workflows must still prove the current action surface and all
// post-action readback before they can be registered.
// The action is an accessible container wrapping a non-accessible button. A
// tap on the inner button returns success and does nothing (run-1789959781552);
// the accessible wrapper is the element POS actually responds to.
export const returnOrExchangeAction = '-ios predicate string:name == "Return or exchange" AND accessible == 1';
export const homeTab = '~Component.AppNavigation.BottomTabs.Home';
export const ordersTab = '~Component.AppNavigation.BottomTabs.Orders';
export const moreTab = '~Component.AppNavigation.BottomTabs.More';
export const moreScreen = '~Screen.More.IndexScreen';
export const moreHeader = '~Component.AppNavigation.MoreMenu.Header';
export const settingsMenu = '-ios predicate string:type == "XCUIElementTypeOther" AND name == "Screen.More.IndexScreen.NavListContent.Item.Component.AppNavigation.MoreMenu.Settings"';
export const settingsScreen = '~Screen.Settings';
export const settingsLocationItem = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Screen.Settings.LocationsItem"';
export const ordersScreen = '~Screen.OrdersScreen';
export const ordersList = '~Screen.OrdersList';
// Observed in the POS Orders accessibility tree as the exact order-search
// field. Scope this selector to Screen.OrdersScreen; the same component name
// is also used by product search on Home.
export const orderSearchField = '~Component.SearchBar.TextInput';
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
export const detailScreen = '~Screen.OrderDetailsScreen';
// Observed on the order-detail modal; this is the native Close button, not a
// coordinate or a business action.
export const detailCloseButton = '~Component.ActionBar.PrimaryActionButton';
export const searchScreen = '~Screen.Search';
export const searchBackButton = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Component.SearchBar.Text.CancelSearchIconLeft" AND label == "Back" AND visible == 1';
// The variant picker's Back is the action bar's primary button while the
// picker is open; matching the label and visibility keeps it exact.
export const variantListBackButton = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Component.ActionBar.PrimaryActionButton" AND label == "Back" AND visible == 1';

// --- Return and exchange surface (POS 11.14.0, observed 2026-09-21) ------------
// The order-detail action is TWO nested elements that disagree, and both matter:
// the accessible wrapper is what a coordinate tap must hit (element taps on
// either do nothing), while the inner button is the only one whose `enabled`
// reflects whether the order can be returned at all. On an unfulfilled order
// the wrapper still reads enabled=true and the inner button reads false
// (HCDEV#5697, run-1789963996362).
export const returnActionWrapper = '-ios predicate string:name == "Return or exchange" AND accessible == 1';
export const returnActionButton = '-ios predicate string:name == "Return or exchange" AND accessible == 0';

// Opening "Return or exchange" does NOT push a new screen: POS turns the Home
// cart into a return cart and lays the picker over it, so Screen.Home and
// Screen.Cart stay in the tree. The action bar title is the only reliable
// "sheet is open" signal.
export const returnSheetTitle = '-ios predicate string:name == "Component.ActionBar.Title" AND label == "Select items to return"';
export const returnSheetBack = '-ios predicate string:name == "Component.ActionBar.PrimaryActionButton" AND label == "Back"';
export const returnSheetDone = '-ios predicate string:name == "Component.ActionBar.SecondaryActionButton" AND label == "Done"';
export const addExchangeItemsButton = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Add exchange items"';

// An item in the picker is a Button while unselected and becomes an Other once
// its panel is expanded, so the type distinguishes the two states.
export const returnItemButton = (label: string) => `-ios predicate string:type == "XCUIElementTypeButton" AND name == "${posLiteral(label)}"`;
export const returnItemHeader = (label: string) => `-ios predicate string:type == "XCUIElementTypeOther" AND name == "${posLiteral(label)}"`;

// Selecting a second item does NOT collapse the first: every expanded panel
// contributes one of each control below, all with IDENTICAL names. Only the
// restock switch carries the item label, so it is the anchor that gives each
// panel its ordinal position; the other controls are read positionally from
// these find-alls. See posReturn.panelIndexFor.
export const restockSwitches = '-ios predicate string:type == "XCUIElementTypeSwitch" AND name BEGINSWITH "Restock at this location: "';
export const restockSwitchPrefix = 'Restock at this location: ';
export const quantityInputs = '-ios predicate string:name == "Screen.ManageItem.quantityStepper.TextInput"';
export const quantityIncrementButtons = '-ios predicate string:name == "Screen.ManageItem.quantityStepper.IncrementButton"';
export const quantityDecrementButtons = '-ios predicate string:name == "Screen.ManageItem.quantityStepper.DecrementButton"';
export const returnNoteFields = '-ios predicate string:type == "XCUIElementTypeTextField" AND name == "Note"';
// The reason control is named "Return reason" until a reason is chosen, after
// which its name BECOMES the chosen label. Matching both keeps one element per
// panel in the find-all, so positional indexing stays aligned.
export const reasonButtons = (labels: readonly string[]) =>
  `-ios predicate string:type == "XCUIElementTypeButton" AND name IN {${['Return reason', ...labels].map(label => `"${posLiteral(label)}"`).join(', ')}}`;
export const reasonPickerOption = (label: string) => `-ios predicate string:type == "XCUIElementTypeButton" AND name == "${posLiteral(label)}"`;

// Cart lines during a return/exchange are NOT Screen.Cart.cartLineItem-N.
export const returnCartLines = '-ios predicate string:type == "XCUIElementTypeButton" AND name BEGINSWITH "SharedCart.ReturnLineItem."';
export const exchangeCartLines = '-ios predicate string:type == "XCUIElementTypeButton" AND name BEGINSWITH "SharedCart.LineItem."';
export const anySharedCartLine = '-ios predicate string:name BEGINSWITH "SharedCart.ReturnLineItem." OR name BEGINSWITH "SharedCart.LineItem."';

// Refund method surface, reached from the cart control when the net is a refund.
export const refundMethodTitle = '-ios predicate string:type == "XCUIElementTypeStaticText" AND label == "Select refund method"';
export const refundMethodCash = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Cash, Original payment"';
export const refundMethodGiftCard = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Gift card"';
export const refundMethodSplit = '-ios predicate string:type == "XCUIElementTypeButton" AND name == "Split refund"';

/**
 * Escapes a POS label for embedding in an iOS predicate string literal. A label
 * carrying a double quote or a backslash would otherwise end the literal and
 * silently change which element is matched, so those are rejected outright
 * rather than guessed at.
 */
export function posLiteral(label: string): string {
  if (/["\\]/.test(label)) throw new Error(`A POS label containing a quote or backslash cannot be matched safely: ${label}`);
  return label;
}
