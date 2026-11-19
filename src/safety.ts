import { AppError } from "./errors";

const MULTI_PART_TLDS = new Set([
  "co.uk",
  "com.tr",
  "org.tr",
  "com.au",
  "co.jp",
  "com.br",
  "co.nz",
  "com.mx",
]);

export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return host;
  const lastTwo = parts.slice(-2).join(".");
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

export function sameSite(a: URL, b: URL): boolean {
  return registrableDomain(a.hostname) === registrableDomain(b.hostname);
}

export function normalizeInput(input: string): URL {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new AppError(400, "empty", "Bir site adresi girin.");
  }
  if (trimmed.length > 300) {
    throw new AppError(400, "too_long", "Adres çok uzun.");
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    throw new AppError(
      400,
      "invalid_url",
      "Bu bir site adresi gibi görünmüyor. notion.so veya https://linear.app yazın.",
    );
  }
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
    url.pathname = url.pathname.slice(0, -1);
  }
  return url;
}

export function assertPublicHttpUrl(url: URL): void {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AppError(400, "bad_scheme", "Yalnızca http ve https adresleri kabul edilir.");
  }
  if (url.username || url.password) {
    throw new AppError(400, "userinfo", "Adres içinde kullanıcı adı veya parola olamaz.");
  }
  if (isBlockedHost(url.hostname)) {
    throw new AppError(
      400,
      "blocked_host",
      "Bu adres özel bir ağa veya yerel bir makineye işaret ediyor. Yalnızca herkese açık siteler sorgulanır.",
    );
  }
}

export function isBlockedHost(hostname: string): boolean {
  const host = hostname
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (!host) return true;
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === "metadata.google.internal" ||
    host === "metadata.goog"
  ) {
    return true;
  }
  if (/^\d+$/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  return isPrivateAddress(host);
}

function isPrivateAddress(host: string): boolean {
  if (host.startsWith("::ffff:")) return isPrivateAddress(host.slice("::ffff:".length));
  if (host === "::1" || host === "::" || host === "0:0:0:0:0:0:0:1") return true;

  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const octets = v4.slice(1).map((part) => Number(part));
    if (octets.some((n) => !Number.isInteger(n) || n > 255)) return true;
    if (v4.slice(1).some((part) => part.length > 1 && part.startsWith("0"))) return true;
    const a = octets[0] ?? 0;
    const b = octets[1] ?? 0;
    const c = octets[2] ?? 0;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 192 && b === 0 && c === 0) return true;
    if (a === 192 && b === 0 && c === 2) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a === 198 && b === 51 && c === 100) return true;
    if (a === 203 && b === 0 && c === 113) return true;
    if (a >= 224) return true;
    return false;
  }

  if (host.includes(":")) {
    const head = host.split(":")[0] ?? "";
    if (head === "fe80" || head === "ff00" || head.startsWith("ff")) return true;
    if (head.startsWith("fc") || head.startsWith("fd")) return true;
    return false;
  }
  return false;
}
