export type Billing = "monthly" | "yearly" | "other";

export type Control = {
  text: string;
  checked: boolean;
};

export type Snapshot = {
  billing: Billing;
  label: string;
  text: string;
};

export interface PricingPage {
  goto(url: string): Promise<void>;
  text(): Promise<string>;
  controls(): Promise<Control[]>;
  click(text: string): Promise<boolean>;
}

const BILLING =
  /\b(monthly|annually|annual|yearly|per year|per month|aylık|aylik|yıllık|yillik)\b/i;
const MORE = /\b(compare|show more|see all features|view all|karşılaştır|karsilastir|tümünü gör)\b/i;

export function billingOf(label: string): Billing {
  if (/\b(annual|annually|yearly|per year|yıllık|yillik)\b/i.test(label)) return "yearly";
  if (/\b(monthly|per month|aylık|aylik)\b/i.test(label)) return "monthly";
  return "other";
}

export function periodLabel(billing: Billing): string | null {
  if (billing === "yearly") return "yıllık";
  if (billing === "monthly") return "aylık";
  return null;
}

export function inferBilling(controls: Control[], text: string): Billing {
  const checked = controls.find((control) => control.checked && billingOf(control.text) !== "other");
  if (checked) return billingOf(checked.text);
  if (/billed annually|billed yearly|\/yr\b|yıllık/i.test(text)) return "yearly";
  if (/billed monthly|\/mo\b|aylık/i.test(text)) return "monthly";
  return "other";
}

export function nextClick(
  controls: Control[],
  snapshots: Snapshot[],
  seen: Set<string>,
): string | null {
  const have = new Set(snapshots.map((snapshot) => snapshot.billing));
  const open = controls.filter((control) => !seen.has(norm(control.text)) && !control.checked);
  const yearly = open.find((control) => billingOf(control.text) === "yearly" && control.text.length < 24);
  if (yearly && !have.has("yearly")) return yearly.text;
  const monthly = open.find((control) => billingOf(control.text) === "monthly" && control.text.length < 24);
  if (monthly && !have.has("monthly")) return monthly.text;
  const more = open.find((control) => MORE.test(control.text) && control.text.length < 40);
  if (more) return more.text;
  return null;
}

export function isUsefulControl(text: string): boolean {
  return (BILLING.test(text) || MORE.test(text)) && text.length <= 60;
}

export async function drive(page: PricingPage, url: string, decide: Decider): Promise<Snapshot[]> {
  await page.goto(url);
  let text = await page.text();
  if (/cookie/i.test(text.slice(0, 700))) {
    for (const label of ["Accept all", "Accept", "Kabul et", "OK"]) {
      if (await page.click(label)) break;
    }
    text = await page.text();
  }
  let controls = await page.controls();
  const snapshots: Snapshot[] = [
    { billing: inferBilling(controls, text), label: "açılış", text: text.slice(0, 20_000) },
  ];
  const seen = new Set<string>();
  for (let step = 0; step < 5; step += 1) {
    const choice = await decide({ controls, snapshots, seen });
    if (!choice) break;
    seen.add(norm(choice));
    const clicked = await page.click(choice);
    if (!clicked) continue;
    text = (await page.text()).slice(0, 20_000);
    controls = await page.controls();
    const billing = billingOf(choice);
    snapshots.push({
      billing: billing === "other" ? inferBilling(controls, text) : billing,
      label: choice,
      text,
    });
  }
  return snapshots;
}

export type DecideContext = {
  controls: Control[];
  snapshots: Snapshot[];
  seen: Set<string>;
};

export type Decider = (context: DecideContext) => Promise<string | null>;

export function norm(value: string): string {
  return value.trim().toLocaleLowerCase("tr");
}

type PageEl = {
  textContent: string | null;
  tagName: string;
  href?: string;
  getAttribute(name: string): string | null;
  click(): void;
};

type PageNodes = { length: number; [index: number]: PageEl };

export function readPageText(): string {
  const document = Reflect.get(globalThis, "document") as { body?: { innerText?: string } };
  return document.body?.innerText ?? "";
}

/** Runs inside the page. Must not close over Worker functions. */
export function collectControlsInPage(): Control[] {
  const useful =
    /\b(monthly|annually|annual|yearly|per year|per month|aylık|aylik|yıllık|yillik|compare|show more|see all features|view all|karşılaştır|karsilastir|tümünü gör)\b/i;
  const selectors = 'button, [role="tab"], [role="switch"], [role="radio"], label';
  const seen = new Set<string>();
  const controls: Control[] = [];
  const document = Reflect.get(globalThis, "document") as {
    querySelectorAll(selector: string): PageNodes;
  };
  const here = Reflect.get(globalThis, "location") as {
    href: string;
    origin: string;
    pathname: string;
  };
  const nodes = document.querySelectorAll(selectors);
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const text = (node.textContent || node.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim();
    if (!text || text.length > 60 || !useful.test(text)) continue;
    const key = text.toLocaleLowerCase("tr");
    if (seen.has(key)) continue;
    if (node.tagName === "A" && node.href) {
      const target = new URL(node.href, here.href);
      if (target.origin !== here.origin || target.pathname !== here.pathname) continue;
    }
    seen.add(key);
    controls.push({
      text,
      checked:
        node.getAttribute("aria-checked") === "true" ||
        node.getAttribute("aria-pressed") === "true" ||
        node.getAttribute("aria-selected") === "true",
    });
    if (controls.length >= 24) break;
  }
  return controls;
}

/** Runs inside the page. Must not close over Worker functions. */
export function clickControlInPage(label: string): boolean {
  const wanted = label.trim().toLocaleLowerCase("tr");
  const document = Reflect.get(globalThis, "document") as {
    querySelectorAll(selector: string): PageNodes;
  };
  const nodes = document.querySelectorAll(
    'button, [role="tab"], [role="switch"], [role="radio"], label',
  );
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    if (!node) continue;
    const text = (node.textContent || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("tr");
    if (text !== wanted) continue;
    node.click();
    return true;
  }
  return false;
}
