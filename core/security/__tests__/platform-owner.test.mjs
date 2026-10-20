import assert from "node:assert/strict";
import test from "node:test";

import { requirePlatformOwner, requireSameOrigin } from "../platform-owner.ts";

const owner = { uid: "owner", email: "owner@example.com", studioKey: "OWNER", accessScope: "full" };

test("configured full-scope owner may use global administration", () => {
  assert.equal(requirePlatformOwner(owner, "owner@example.com").email, owner.email);
});

test("ordinary author and unlisted full-scope identities cannot modify global configuration", () => {
  for (const session of [
    { ...owner, accessScope: "mvp" },
    { ...owner, email: "other@example.com" },
  ]) {
    assert.throws(
      () => requirePlatformOwner(session, "owner@example.com"),
      (error) => error.code === "PLATFORM_OWNER_REQUIRED" && error.status === 403
    );
  }
});

test("state-changing owner routes require exact same-origin requests", () => {
  assert.doesNotThrow(() => requireSameOrigin(new Request("https://dashboard.example/api/admin/test", {
    headers: { Origin: "https://dashboard.example" },
  })));
  for (const origin of [undefined, "https://attacker.example"]) {
    const headers = origin ? { Origin: origin } : undefined;
    assert.throws(
      () => requireSameOrigin(new Request("https://dashboard.example/api/admin/test", { headers })),
      (error) => error.code === "TRUSTED_ORIGIN_REQUIRED"
    );
  }
});
