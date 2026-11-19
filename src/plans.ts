export type Plan = {
  name: string;
  price: string | null;
  currency: string | null;
  period: string | null;
  features: string[];
  notes: string | null;
};

const NOISE =
  /^(yearly|monthly|annually|annual|aylık|yıllık|save\s+\d|billed|try for free|use for free|talk to sales|see feature|get started|start |satın al|hemen başla)/i;

const PERIOD_LINE =
  /^(per\b|\/|aylık|yıllık|yearly|monthly|annually|billed)|per\s+(user|month|year|seat)/i;

export function extractPlansFromText(text: string): Plan[] {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length < 180);
  const anchors = lines
    .map((line, index) => ({ line, index }))
    .filter((item) => isPriceAnchor(item.line));

  const drafts: Array<{ plan: Plan; order: number; nameIndex: number }> = [];
  for (const anchor of anchors) {
    const named = findName(lines, anchor.index);
    if (!named) continue;
    const nextName = nextAnchorNameIndex(lines, anchors, anchor.index);
    const stop = nextName ?? lines.length;
    const features: string[] = [];
    let notes: string | null = null;
    for (let index = anchor.index + 1; index < stop && index < anchor.index + 14; index++) {
      const line = lines[index] ?? "";
      if (isPriceAnchor(line) || isPeriodLine(line) || NOISE.test(line)) continue;
      if (line === named.name) continue;
      if (line.length > 90) {
        if (!notes) notes = clip(line, 160);
        continue;
      }
      if (/^(everything in|all .+ features)/i.test(line)) continue;
      if (features.length < 6 && line.length >= 3) features.push(clip(line, 90));
    }
    drafts.push({
      order: named.nameIndex,
      nameIndex: named.nameIndex,
      plan: {
        name: named.name,
        price: priceLabel(anchor.line),
        currency: currencyOf(anchor.line),
        period: periodOf(lines, anchor.index),
        features,
        notes,
      },
    });
  }

  drafts.sort((a, b) => a.order - b.order);
  const merged = new Map<string, Plan>();
  const order: string[] = [];
  for (const draft of drafts) {
    const key = `${draft.plan.name.toLocaleLowerCase("tr")}|${draft.plan.price ?? ""}`;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, draft.plan);
      order.push(key);
      continue;
    }
    if (draft.plan.features.length > existing.features.length) {
      merged.set(key, draft.plan);
    }
  }
  return order
    .map((key) => merged.get(key))
    .filter((plan): plan is Plan => Boolean(plan))
    .slice(0, 8);
}

export function plansFromModel(raw: unknown): Plan[] | null {
  const parsed = unwrapModel(raw);
  if (!parsed || typeof parsed !== "object") return null;
  if (!("plans" in parsed)) return null;
  return sanitizePlans((parsed as { plans: unknown }).plans);
}

export function sanitizePlans(input: unknown): Plan[] {
  if (!Array.isArray(input)) return [];
  const plans: Plan[] = [];
  for (const item of input) {
    const plan = asPlan(item);
    if (plan) plans.push(plan);
    if (plans.length >= 8) break;
  }
  return plans;
}

function asPlan(item: unknown): Plan | null {
  if (!item || typeof item !== "object") return null;
  const record = item as Record<string, unknown>;
  const name = clip(asText(record.name), 60);
  if (!name) return null;
  const features = Array.isArray(record.features)
    ? record.features
        .map((feature) => clip(asText(feature), 90))
        .filter((feature) => feature.length > 0)
        .slice(0, 6)
    : [];
  return {
    name,
    price: asPrice(record.price),
    currency: emptyToNull(clip(asText(record.currency), 12)),
    period: emptyToNull(clip(asText(record.period), 40)),
    features,
    notes: emptyToNull(clip(asText(record.notes), 180)),
  };
}

export function jsonFromModel(raw: unknown): unknown {
  return unwrapModel(raw);
}

function unwrapModel(raw: unknown): unknown {
  if (typeof raw === "string") return parseJsonish(raw);
  if (!raw || typeof raw !== "object") return raw;
  if ("response" in raw) {
    const response = (raw as { response: unknown }).response;
    if (typeof response === "string") return parseJsonish(response);
    if (response && typeof response === "object") return response;
  }
  if ("choices" in raw && Array.isArray((raw as { choices: unknown }).choices)) {
    const choice = (raw as { choices: Array<{ message?: { content?: unknown } }> }).choices[0];
    const content = choice?.message?.content;
    if (typeof content === "string") return parseJsonish(content);
  }
  return raw;
}

function parseJsonish(text: string): unknown {
  let source = text.trim().replace(/^\uFEFF/, "");
  source = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  source = source.slice(start, end + 1).replace(/,\s*([}\]])/g, "$1");
  try {
    const parsed: unknown = JSON.parse(source);
    if (typeof parsed === "string") return parseJsonish(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function isPriceAnchor(line: string): boolean {
  if (line.length > 80) return false;
  if (/[$€£₺]\s?\d/.test(line)) return true;
  if (/^custom pricing$/i.test(line.trim())) return true;
  return /^\*?(free forever|ücretsiz|ucretsiz|custom|özel)$/i.test(line.trim());
}

function findName(
  lines: string[],
  anchorIndex: number,
): { name: string; nameIndex: number } | null {
  for (let index = anchorIndex - 1; index >= Math.max(0, anchorIndex - 6); index--) {
    const line = lines[index] ?? "";
    if (isPriceAnchor(line)) break;
    if (NOISE.test(line) || isPeriodLine(line)) continue;
    if (!isShortHeading(line)) continue;
    return { name: line, nameIndex: index };
  }
  return null;
}

function nextAnchorNameIndex(
  lines: string[],
  anchors: Array<{ index: number }>,
  current: number,
): number | null {
  const next = anchors.find((anchor) => anchor.index > current);
  if (!next) return null;
  return findName(lines, next.index)?.nameIndex ?? next.index;
}

function isShortHeading(line: string): boolean {
  if (line.length < 2 || line.length > 32) return false;
  if (/[$€£₺]|\d/.test(line)) return false;
  if (/[.!?]/.test(line)) return false;
  return line.split(/\s+/).length <= 4;
}

function isPeriodLine(line: string): boolean {
  return PERIOD_LINE.test(line);
}

function priceLabel(line: string): string {
  const symbol = line.match(/([$€£₺])\s?(\d{1,6}(?:[.,]\d{1,2})?)/);
  if (symbol) return `${symbol[1]}${symbol[2]}`;
  const word = line.match(/\b(\d{1,6}(?:[.,]\d{1,2})?)\s?(USD|EUR|GBP|TRY|TL)\b/i);
  if (word?.[1] && word[2]) return `${word[1]} ${word[2].toUpperCase()}`;
  return line.replace(/^\*/, "").trim();
}

function currencyOf(line: string): string | null {
  if (line.includes("₺") || /\b(?:TRY|TL)\b/.test(line)) return "TRY";
  if (line.includes("€") || /\bEUR\b/.test(line)) return "EUR";
  if (line.includes("£") || /\bGBP\b/.test(line)) return "GBP";
  if (line.includes("$") || /\bUSD\b/.test(line)) return "USD";
  return null;
}

function periodOf(lines: string[], index: number): string | null {
  const window = lines.slice(index, index + 3).join(" ");
  if (/per\s+user\s*\/\s*month|\/\s*user\s*\/\s*month|kullanıcı\s*\/\s*ay/i.test(window)) {
    return "kullanıcı / ay";
  }
  if (/\/\s*mo\b|per\s+month|\/\s*month|aylık|\/\s*ay\b/i.test(window)) return "aylık";
  if (/per\s+year|\/\s*(?:yr|year)\b|yıllık|annually/i.test(window)) return "yıllık";
  return null;
}

function asText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function asPrice(value: unknown): string | null {
  const text = asText(value);
  if (!text || text.toLowerCase() === "null" || text === "-") return null;
  return clip(text, 40);
}

function emptyToNull(value: string): string | null {
  return value ? value : null;
}

function clip(value: string, max: number): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}
