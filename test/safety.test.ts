import assert from "node:assert/strict";
import { test } from "node:test";
import { AppError } from "../src/errors.ts";
import { fetchPage } from "../src/fetch-page.ts";
import { assertPublicHttpUrl, isBlockedHost, normalizeInput } from "../src/safety.ts";

test("adds https and strips the hash", () => {
  const url = normalizeInput("Notion.so/pricing#team");
  assert.equal(url.toString(), "https://notion.so/pricing");
});

test("rejects private and local hosts", () => {
  const blocked = [
    "http://localhost/pricing",
    "http://127.0.0.1/",
    "http://10.1.2.3/",
    "http://192.168.0.8/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest",
    "http://[::1]/",
    "file:///etc/passwd",
    "https://user:pass@example.com/",
    "http://2130706433/",
  ];
  for (const value of blocked) {
    assert.throws(() => {
      const url = normalizeInput(value);
      assertPublicHttpUrl(url);
    }, AppError);
  }
  assert.equal(isBlockedHost("metadata.google.internal"), true);
});

test("allows a public https url", () => {
  const url = normalizeInput("https://linear.app");
  assert.doesNotThrow(() => assertPublicHttpUrl(url));
});

test("does not follow a redirect onto a private address", async () => {
  let calls = 0;
  const fakeFetch: typeof fetch = async (input) => {
    calls += 1;
    const href = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.equal(href.includes("127.0.0.1"), false);
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/secret" },
    });
  };
  await assert.rejects(
    () => fetchPage("https://example.com/pricing", fakeFetch),
    (error: unknown) => error instanceof AppError && error.code === "blocked_host",
  );
  assert.equal(calls, 1);
});
