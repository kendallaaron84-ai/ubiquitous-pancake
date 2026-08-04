import assert from "node:assert/strict"; import test from "node:test"; import { classifyLegacyReaderRecord } from "../services/legacy-migration-service.ts";
test("legacy migration accepts complete active evidence", () => assert.deepEqual(classifyLegacyReaderRecord({ tenantKey: "t", assetId: "a", status: "active", phoneNumber: "12105550101" }), { eligible: true, reason: null }));
test("legacy migration rejects incomplete evidence", () => assert.equal(classifyLegacyReaderRecord({ status: "active" }).eligible, false));
