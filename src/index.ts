import { chooseClick, extractWithModel, DEFAULT_MODEL } from "./ai";
import { browsePricing } from "./cf-browser";
import { discoverPricing, type DiscoveryVia } from "./discover";
import {
  isUsefulControl,
  nextClick,
  norm,
  periodLabel,
  type Billing,
  type Decider,
  type Snapshot,
} from "./drive";
import { AppError } from "./errors";
import { selectExcerpt } from "./html";
import { PAGE_HTML } from "./page";
import { extractPlansFromText, type Plan } from "./plans";
import { allowRequest, clientIp } from "./rate-limit";
import { assertPublicHttpUrl, normalizeInput } from "./safety";

type PricingOk = {
  ok: true;
  input: string;
  site: string;
  pricingUrl: string;
  via: DiscoveryVia;
  renderer: "browser" | "static";
  extractor: "workers-ai" | "heuristic";
  model: string | null;
  cached: boolean;
  plans: Plan[];
  message: string | null;
  note: string | null;
};

type PricingErr = {
  ok: false;
  error: string;
  code: string;
};

const NO_PRICE_MESSAGE =
  "Bu sayfada listelenmiş bir fiyat okunamadı. Tarayıcı kotası dolduysa yalnızca düz HTML okunur; fiyatlar JavaScript ile çiziliyorsa kaynak sayfayı açıp kontrol edin.";

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/api/pricing") {
      if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
        return new Response(PAGE_HTML, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      }
      return jsonBody({ ok: false, error: "Bulunamadı.", code: "not_found" }, 404);
    }
    if (request.method !== "POST") {
      return jsonBody(
        { ok: false, error: "Bu uç yalnızca POST kabul eder.", code: "method" },
        405,
      );
    }
    try {
      return await lookup(request, env, ctx);
    } catch (error) {
      const app = error instanceof AppError ? error : explain(error);
      console.error(
        JSON.stringify({
          message: "pricing.failed",
          code: app.code,
          error: app.message,
        }),
      );
      return jsonBody({ ok: false, error: app.message, code: app.code }, app.status);
    }
  },
} satisfies ExportedHandler<Env>;

async function lookup(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const input = canonicalInput(await readInput(request));
  const mock = mockEnabled(env.MOCK_AI);
  const model = env.AI_MODEL || DEFAULT_MODEL;
  const cacheKey = cacheRequest(input, mock ? `mock:${model}` : model);
  const cached = await readCache(cacheKey);
  if (cached) {
    return jsonBody({ ...cached, cached: true }, 200, "public, max-age=1200");
  }
  if (!allowRequest(clientIp(request))) {
    throw new AppError(
      429,
      "rate_limited",
      "Çok sık deneme yapıldı. Bir dakika sonra yeniden deneyin.",
    );
  }

  const found = await discoverOptional(input);
  const target = found?.page.finalUrl ?? input;
  const browserPlans = await readWithBrowser(env, target, mock, model);
  let plans = browserPlans?.plans ?? [];
  let extractor: PricingOk["extractor"] = browserPlans?.extractor ?? "heuristic";
  let note = browserPlans?.note ?? null;
  let renderer: PricingOk["renderer"] = "browser";

  if (plans.length === 0) {
    renderer = "static";
    const text = found?.page.text ?? "";
    const extracted = await readStatic(env, text, mock, model);
    plans = extracted.plans;
    extractor = extracted.extractor;
    note = browserPlans?.note ? `${browserPlans.note} ${extracted.note ?? ""}`.trim() : extracted.note;
  }

  const payload: PricingOk = {
    ok: true,
    input,
    site: found?.site ?? new URL(target).hostname,
    pricingUrl: target,
    via: found?.via ?? "input",
    renderer,
    extractor,
    model: extractor === "workers-ai" ? model : null,
    cached: false,
    plans,
    message: plans.length === 0 ? NO_PRICE_MESSAGE : null,
    note,
  };
  console.log(
    JSON.stringify({
      message: "pricing.lookup",
      site: payload.site,
      via: payload.via,
      extractor,
      plans: plans.length,
    }),
  );
  const response = jsonBody(payload, 200, "public, max-age=1200");
  ctx.waitUntil(writeCache(cacheKey, response));
  return response;
}

async function discoverOptional(input: string) {
  try {
    return await discoverPricing(input);
  } catch (error) {
    if (error instanceof AppError && error.code === "blocked_host") throw error;
    console.error(
      JSON.stringify({
        message: "discover.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

async function readWithBrowser(
  env: Env,
  target: string,
  mock: boolean,
  model: string,
): Promise<{ plans: Plan[]; extractor: PricingOk["extractor"]; note: string | null } | null> {
  if (!env.BROWSER) return null;
  try {
    const decide: Decider = async ({ controls, snapshots, seen }) => {
      const fallback = nextClick(controls, snapshots, seen);
      if (!mock) {
        try {
          const picked = await chooseClick(
            env.AI,
            model,
            controls,
            snapshots.map((snapshot) => snapshot.billing),
          );
          const match = picked
            ? controls.find((control) => norm(control.text) === norm(picked))
            : undefined;
          if (match && isUsefulControl(match.text) && !seen.has(norm(match.text))) return match.text;
        } catch (error) {
          console.error(
            JSON.stringify({
              message: "ai.click_failed",
              error: error instanceof Error ? error.message : String(error),
            }),
          );
        }
      }
      return fallback;
    };
    const snapshots = await browsePricing(env.BROWSER, target, decide);
    return await plansForSnapshots(env, snapshots, mock, model, true);
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "browser.failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return {
      plans: [],
      extractor: "heuristic",
      note: "Tarayıcı açılamadı; düz HTML yedeği kullanıldı.",
    };
  }
}

async function plansForSnapshots(
  env: Env,
  snapshots: Snapshot[],
  mock: boolean,
  model: string,
  fromBrowser: boolean,
): Promise<{ plans: Plan[]; extractor: PricingOk["extractor"]; note: string | null }> {
  const heuristic = stampPlans(snapshots);
  let plans = heuristic;
  let extractor: PricingOk["extractor"] = "heuristic";
  let note = fromBrowser
    ? mock
      ? "Sayfa tarayıcıda açıldı. Yerel deneme modu: tıklamalar ve planlar kurala göre çıkarıldı."
      : "Sayfa tarayıcıda açıldı, aylık/yıllık anahtarları denendi."
    : mock
      ? "Yerel deneme modu açık: Workers AI çağrılmadı, planlar sayfa metninden çıkarıldı."
      : null;
  if (!mock && heuristic.length > 0) {
    try {
      const excerpt = snapshots
        .map((snapshot) => {
          const title = periodLabel(snapshot.billing) ?? snapshot.label;
          return `## ${title}\n${selectExcerpt(snapshot.text, 4500)}`;
        })
        .join("\n\n")
        .slice(0, 12_000);
      const modeled = await extractWithModel(env.AI, model, excerpt);
      if (modeled && modeled.length > 0) {
        plans = mergePlans(modeled, heuristic);
        extractor = "workers-ai";
      }
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "ai.unavailable",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      note = "Workers AI kullanılamadı; planlar sayfa metninden çıkarıldı.";
    }
  }
  if (!fromBrowser && plans.length === 0 && !mock) {
    note = null;
  }
  return { plans, extractor, note };
}

async function readStatic(env: Env, text: string, mock: boolean, model: string) {
  const snapshots: Snapshot[] = [{ billing: "other" as Billing, label: "html", text }];
  if (!text) return { plans: [] as Plan[], extractor: "heuristic" as const, note: null };
  return plansForSnapshots(env, snapshots, mock, model, false);
}

function stampPlans(snapshots: Snapshot[]): Plan[] {
  const merged = new Map<string, Plan>();
  for (const snapshot of snapshots) {
    const period = periodLabel(snapshot.billing);
    for (const plan of extractPlansFromText(snapshot.text)) {
      const next = { ...plan, period: period ?? plan.period };
      const key = `${next.name.toLocaleLowerCase("tr")}|${next.period ?? ""}|${next.price ?? ""}`;
      const existing = merged.get(key);
      if (!existing || next.features.length > existing.features.length) merged.set(key, next);
    }
  }
  return [...merged.values()].slice(0, 12);
}

function mergePlans(primary: Plan[], extra: Plan[]): Plan[] {
  const merged = new Map<string, Plan>();
  for (const plan of [...primary, ...extra]) {
    const key = `${plan.name.toLocaleLowerCase("tr")}|${plan.period ?? ""}|${plan.price ?? ""}`;
    const existing = merged.get(key);
    if (!existing || plan.features.length > existing.features.length) merged.set(key, plan);
  }
  return [...merged.values()].slice(0, 12);
}

async function readInput(request: Request): Promise<string> {
  const raw = await request.text();
  if (raw.length > 2_000) {
    throw new AppError(400, "too_large", "İstek çok uzun.");
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new AppError(400, "bad_json", "İstek JSON değil.");
  }
  if (!body || typeof body !== "object" || !("url" in body)) {
    throw new AppError(400, "bad_json", "JSON içinde url alanı olmalı.");
  }
  const url = (body as { url: unknown }).url;
  if (typeof url !== "string") {
    throw new AppError(400, "bad_json", "url metin olmalı.");
  }
  return url;
}

function mockEnabled(value: string): boolean {
  return value === "true";
}

function canonicalInput(input: string): string {
  const url = normalizeInput(input);
  assertPublicHttpUrl(url);
  return url.toString();
}

function cacheRequest(input: string, mode: string): Request {
  const key = new URL("https://pricing-bulucu.cache/v1");
  key.searchParams.set("target", input.trim().toLowerCase());
  key.searchParams.set("mode", mode);
  return new Request(key.toString(), { method: "GET" });
}

async function readCache(key: Request): Promise<PricingOk | null> {
  try {
    const hit = await caches.default.match(key);
    if (!hit) return null;
    const data: unknown = await hit.json();
    if (!data || typeof data !== "object" || !("ok" in data)) return null;
    return data as PricingOk;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "cache.match_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}

async function writeCache(key: Request, response: Response): Promise<void> {
  try {
    await caches.default.put(key, response.clone());
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "cache.put_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
}

function explain(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/abort|timed out|timeout/i.test(message)) {
    return new AppError(504, "timeout", "Site zamanında yanıt vermedi.");
  }
  return new AppError(502, "fetch_failed", "Siteye ulaşılamadı.");
}

function jsonBody(
  data: PricingOk | PricingErr,
  status: number,
  cacheControl = "no-store",
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}
