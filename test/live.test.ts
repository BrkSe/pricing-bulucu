import assert from "node:assert/strict";
import { test } from "node:test";
import { discoverPricing } from "../src/discover.ts";
import { countPrices } from "../src/html.ts";
import { extractPlansFromText } from "../src/plans.ts";

const cases = [
  {
    input: "linear.app",
    host: /linear\.app$/,
    prices: ["$10", "$16"],
    names: [/free/i, /basic/i, /business/i],
  },
  {
    input: "notion.so",
    host: /notion\.com$/,
    prices: ["$10", "$20"],
    names: [/free/i, /plus/i, /business/i],
  },
  {
    input: "https://cal.com",
    host: /cal\.com$/,
    prices: ["$12", "$28"],
    names: [/teams/i, /organizations/i],
  },
];

for (const item of cases) {
  test(`discovers pricing text for ${item.input}`, { timeout: 30_000 }, async () => {
    const found = await discoverPricing(item.input);
    const finalUrl = new URL(found.page.finalUrl);
    assert.match(finalUrl.hostname, item.host);
    assert.match(finalUrl.pathname, /pricing/i);
    assert.ok(countPrices(found.page.text) >= 2, found.page.text.slice(0, 400));
    const plans = extractPlansFromText(found.page.text);
    const prices = plans.map((plan) => plan.price).join(" ");
    for (const price of item.prices) {
      assert.ok(prices.includes(price), `${item.input} prices: ${prices}`);
    }
    const names = plans.map((plan) => plan.name).join(" | ");
    for (const name of item.names) {
      assert.match(names, name, names);
    }
  });
}
