import { AppError } from "./errors";
import { assertPublicHttpUrl } from "./safety";
import { htmlToText } from "./html";

const MAX_BYTES = 400_000;
const MAX_REDIRECTS = 4;
const TIMEOUT_MS = 8_000;

export type FetchedPage = {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  html: string;
  text: string;
};

export async function fetchPage(
  url: string,
  doFetch: typeof fetch = fetch,
): Promise<FetchedPage> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    assertPublicHttpUrl(parsed);
    const response = await doFetch(current, workerInit());
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) {
        throw new AppError(502, "bad_redirect", "Site yönlendirmesi eksik.");
      }
      current = new URL(location, current).toString();
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const readable =
      !contentType || /html|xml|text|json/i.test(contentType);
    const html = readable ? await readLimited(response, MAX_BYTES) : "";
    if (!readable) await response.body?.cancel();
    const text = html ? htmlToText(html) : "";
    return {
      requestedUrl: url,
      finalUrl: current,
      status: response.status,
      html,
      text,
    };
  }
  throw new AppError(502, "too_many_redirects", "Site çok fazla yönlendirme yaptı.");
}

function workerInit(): RequestInit {
  const init: RequestInit = {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      accept: "text/html,application/xhtml+xml;q=0.9,text/plain;q=0.8",
      "accept-language": "tr,en;q=0.8",
      "user-agent": "Mozilla/5.0 (compatible; PricingBulucu/1.0)",
    },
  };
  if (typeof caches !== "undefined" && "default" in caches) {
    return { ...init, cf: { cacheTtl: 0 } };
  }
  return init;
}

async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const room = maxBytes - total;
      const slice = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(slice);
      total += slice.byteLength;
      if (value.byteLength > room) break;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The body is already closed.
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}
