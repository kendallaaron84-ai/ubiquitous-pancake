import assert from "node:assert/strict";
import test from "node:test";

import {
  exactReaderOrigin,
  exactReaderUrl,
} from "../reader-origin-policy.ts";

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(
    Object.keys(values).map((key) => [key, process.env[key]])
  );
  Object.assign(process.env, values);
  try {
    callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("production accepts only HTTPS reader destinations", () => {
  withEnvironment(
    { NODE_ENV: "production", KOBA_LOCAL_ACCEPTANCE: "true" },
    () => {
      assert.equal(exactReaderOrigin("https://author.example/book"), "https://author.example");
      assert.equal(exactReaderUrl("https://author.example/book"), "https://author.example/book");
      assert.equal(exactReaderOrigin("http://koba-dev.local/book"), null);
      assert.equal(exactReaderUrl("http://127.0.0.1:9400/book"), null);
    }
  );
});

test("explicit non-production acceptance permits only exact local HTTP hosts", () => {
  withEnvironment(
    { NODE_ENV: "development", KOBA_LOCAL_ACCEPTANCE: "true" },
    () => {
      assert.equal(exactReaderOrigin("http://koba-dev.local/book"), "http://koba-dev.local");
      assert.equal(exactReaderUrl("http://127.0.0.1:9400/book"), "http://127.0.0.1:9400/book");
      assert.equal(exactReaderUrl("http://attacker.example/book"), null);
      assert.equal(exactReaderUrl("file:///tmp/book"), null);
    }
  );
});

test("local HTTP remains rejected without the explicit acceptance flag", () => {
  withEnvironment(
    { NODE_ENV: "development", KOBA_LOCAL_ACCEPTANCE: "false" },
    () => assert.equal(exactReaderOrigin("http://koba-dev.local"), null)
  );
});
