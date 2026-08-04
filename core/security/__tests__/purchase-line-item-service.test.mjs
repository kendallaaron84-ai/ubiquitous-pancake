import assert from "node:assert/strict"; import test from "node:test"; import { deterministicPurchaseLineItemId, validatePurchaseLineItem } from "../services/purchase-line-item-service.ts";
const item = { stripeLineItemId: "li_1", tenantId: "t", assetId: "a", quantity: 1, currency: "usd", amountTotalMinor: 100 };
test("purchase line IDs are deterministic", () => assert.equal(deterministicPurchaseLineItemId("p", item), deterministicPurchaseLineItemId("p", item)));
test("purchase line rejects invalid quantity", () => assert.throws(() => validatePurchaseLineItem({ ...item, quantity: 0 }), /PURCHASE_ITEM_QUANTITY_INVALID/));
