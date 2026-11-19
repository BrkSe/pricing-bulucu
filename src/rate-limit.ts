// Isolate-local counters only: timestamps, never request bodies.
const hits = new Map<string, number[]>();
const WINDOW_MS = 60_000;
const LIMIT = 12;

export function allowRequest(ip: string, now = Date.now()): boolean {
  const recent = (hits.get(ip) ?? []).filter((stamp) => now - stamp < WINDOW_MS);
  if (recent.length >= LIMIT) {
    hits.set(ip, recent);
    return false;
  }
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 400) {
    for (const [key, stamps] of hits) {
      if (stamps.every((stamp) => now - stamp >= WINDOW_MS)) hits.delete(key);
    }
  }
  return true;
}

export function clientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "local";
}
