import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";
import {
  clickControlInPage,
  collectControlsInPage,
  drive,
  readPageText,
  type Decider,
  type PricingPage,
} from "./drive";

export async function browsePricing(
  binding: BrowserWorker,
  url: string,
  decide: Decider,
): Promise<Awaited<ReturnType<typeof drive>>> {
  const browser = await puppeteer.launch(binding);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const session: PricingPage = {
      async goto(target) {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: 25_000 });
        await sleep(1200);
      },
      async text() {
        return page.evaluate(readPageText);
      },
      async controls() {
        return page.evaluate(collectControlsInPage);
      },
      async click(label) {
        const clicked = await page.evaluate(clickControlInPage, label);
        if (clicked) await sleep(900);
        return clicked;
      },
    };
    return await drive(session, url, decide);
  } finally {
    await browser.close();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
