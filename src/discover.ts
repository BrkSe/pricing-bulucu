import { AppError } from "./errors";
import { fetchPage, type FetchedPage } from "./fetch-page";
import { countPrices, extractAnchors, PRICING_HINT } from "./html";
import { assertPublicHttpUrl, normalizeInput, sameSite } from "./safety";

export const COMMON_PATHS = [
  "/pricing",
  "/plans",
  "/price",
  "/fiyatlandirma",
  "/fiyatlar",
  "/tr/pricing",
  "/en/pricing",
  "/pricing.html",
];

export type DiscoveryVia = "input" | "link" | "path";

export type Discovery = {
  page: FetchedPage;
  via: DiscoveryVia;
  site: string;
};

type Candidate = { url: string; via: Exclude<DiscoveryVia, "input"> };

export async function discoverPricing(input: string): Promise<Discovery> {
  const start = normalizeInput(input);
  assertPublicHttpUrl(start);
  const first = await fetchPage(start.toString());
  if (isStrongPricingPage(first) && PRICING_HINT.test(`${start.pathname}${start.search}`)) {
    return result(first, "input");
  }

  const origin = new URL(first.finalUrl).origin;
  const homepage =
    new URL(first.finalUrl).pathname === "/" ? first : await fetchOptional(`${origin}/`);
  const linkBase = homepage ?? first;
  const linked = collectLinks(linkBase).slice(0, 3);
  const linkedPages = await mapPool(linked, 3, (candidate) => fetchOptional(candidate.url));
  const linkedReady = linked
    .map((candidate, index) => ({ candidate, page: linkedPages[index] }))
    .filter((item): item is { candidate: Candidate; page: FetchedPage } => Boolean(item.page));

  const bestLinked = bestPage(linkedReady.map((item) => item.page));
  if (bestLinked && isStrongPricingPage(bestLinked)) {
    return result(bestLinked, "link");
  }

  const seen = new Set<string>([
    canonicalize(first.finalUrl),
    ...linked.map((item) => canonicalize(item.url)),
  ]);
  const paths: Candidate[] = [];
  for (const path of COMMON_PATHS) {
    const url = new URL(path, origin).toString();
    const key = canonicalize(url);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push({ url, via: "path" });
    if (paths.length >= 5) break;
  }
  const pathPages = await mapPool(paths, 3, (candidate) => fetchOptional(candidate.url));
  const pool: FetchedPage[] = [first];
  if (homepage && homepage !== first) pool.push(homepage);
  for (const item of linkedReady) pool.push(item.page);
  for (const page of pathPages) {
    if (page) pool.push(page);
  }

  const winner = bestPage(pool.filter((page) => page.status >= 200 && page.status < 400));
  if (!winner) {
    throw new AppError(
      422,
      "no_page",
      "Sitenin sayfası okunamadı. Adres kapalı olabilir ya da istekleri engelliyor olabilir.",
    );
  }
  const via = viaFor(winner, first, linked, paths);
  return result(winner, via);
}

function result(page: FetchedPage, via: DiscoveryVia): Discovery {
  const site = new URL(page.finalUrl).hostname;
  return { page, via, site };
}

function isStrongPricingPage(page: FetchedPage): boolean {
  if (page.status < 200 || page.status >= 400) return false;
  const path = new URL(page.finalUrl).pathname + new URL(page.finalUrl).search;
  return PRICING_HINT.test(path) && countPrices(page.text) >= 2;
}

function bestPage(pages: FetchedPage[]): FetchedPage | null {
  let best: FetchedPage | null = null;
  let bestScore = -1;
  for (const page of pages) {
    const score = scorePage(page);
    if (score > bestScore) {
      best = page;
      bestScore = score;
    }
  }
  return best;
}

function scorePage(page: FetchedPage): number {
  if (page.status < 200 || page.status >= 400) return -1;
  const url = new URL(page.finalUrl);
  const prices = countPrices(page.text);
  let score = Math.min(prices, 12);
  if (PRICING_HINT.test(url.pathname)) score += 8;
  if (prices === 0) score -= 4;
  if (page.text.length < 80) score -= 2;
  return score;
}

function collectLinks(page: FetchedPage): Candidate[] {
  const base = new URL(page.finalUrl);
  const found: Candidate[] = [];
  const seen = new Set<string>();
  for (const anchor of extractAnchors(page.html)) {
    if (!anchor.href || anchor.href.startsWith("#")) continue;
    if (/^(mailto:|javascript:|tel:|data:)/i.test(anchor.href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(anchor.href, base);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (!sameSite(base, resolved)) continue;
    const hint = `${resolved.pathname} ${resolved.search} ${anchor.text}`;
    if (!PRICING_HINT.test(hint)) continue;
    resolved.hash = "";
    const key = canonicalize(resolved.toString());
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ url: resolved.toString(), via: "link" });
  }
  return found;
}

function viaFor(
  winner: FetchedPage,
  first: FetchedPage,
  linked: Candidate[],
  paths: Candidate[],
): DiscoveryVia {
  const finalKey = canonicalize(winner.finalUrl);
  const requested = canonicalize(winner.requestedUrl);
  if (finalKey === canonicalize(first.finalUrl) || requested === canonicalize(first.requestedUrl)) {
    return "input";
  }
  if (linked.some((item) => canonicalize(item.url) === requested)) return "link";
  if (paths.some((item) => canonicalize(item.url) === requested)) return "path";
  if (PRICING_HINT.test(new URL(winner.finalUrl).pathname)) return "path";
  return "input";
}

async function fetchOptional(url: string): Promise<FetchedPage | null> {
  try {
    const page = await fetchPage(url);
    return page.status >= 200 && page.status < 400 ? page : null;
  } catch (error) {
    if (error instanceof AppError && error.code === "blocked_host") throw error;
    return null;
  }
}

function canonicalize(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url.toString();
}

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) continue;
      out[index] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}
