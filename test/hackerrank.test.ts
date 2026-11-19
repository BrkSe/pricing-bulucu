import assert from "node:assert/strict";
import { test } from "node:test";
import { drive, nextClick, periodLabel, type PricingPage } from "../src/drive.ts";
import { clickControlInPage, collectControlsInPage } from "../src/drive.ts";
import { extractPlansFromText } from "../src/plans.ts";

test("hackerrank pricing includes monthly and yearly amounts", { timeout: 60_000 }, async () => {
  const puppeteer = await import("puppeteer-core");
  const browser = await puppeteer.default.launch({
    executablePath: "/usr/local/bin/google-chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const session: PricingPage = {
      async goto(url) {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 40_000 });
        await new Promise((resolve) => setTimeout(resolve, 1500));
      },
      async text() {
        return page.evaluate(() => document.body?.innerText ?? "");
      },
      async controls() {
        return page.evaluate(collectControlsInPage);
      },
      async click(label) {
        const clicked = await page.evaluate(clickControlInPage, label);
        if (clicked) await new Promise((resolve) => setTimeout(resolve, 800));
        return clicked;
      },
    };
    const snapshots = await drive(
      session,
      "https://www.hackerrank.com/work/pricing",
      async (context) => nextClick(context.controls, context.snapshots, context.seen),
    );
    const plans = snapshots.flatMap((snapshot) => {
      const period = periodLabel(snapshot.billing);
      return extractPlansFromText(snapshot.text).map((plan) => ({
        ...plan,
        period: period ?? plan.period,
      }));
    });
    const summary = plans.map((plan) => `${plan.name} ${plan.price} ${plan.period}`).join(" | ");
    assert.ok(plans.some((plan) => plan.name === "Starter" && plan.price === "$79" && plan.period === "yıllık"), summary);
    assert.ok(plans.some((plan) => plan.name === "Pro" && plan.price === "$419" && plan.period === "yıllık"), summary);
    assert.ok(plans.some((plan) => plan.name === "Starter" && plan.price === "$99" && plan.period === "aylık"), summary);
    assert.ok(plans.some((plan) => plan.name === "Pro" && plan.price === "$529" && plan.period === "aylık"), summary);
  } finally {
    await browser.close();
  }
});
