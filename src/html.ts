const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

const BLOCK_TAGS = [
  "script",
  "style",
  "noscript",
  "svg",
  "iframe",
  "canvas",
  "template",
  "nav",
  "footer",
];

export type Anchor = { href: string; text: string };

export const PRICING_HINT =
  /pricing|plans|price|fiyatland[ıi]rma|fiyatlar|fiyat|billing|subscribe|tarif/i;

export function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (all, body: string) => {
    if (body.startsWith("#")) {
      const hex = body[1] === "x" || body[1] === "X";
      const code = hex
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return all;
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? all;
  });
}

export function extractAnchors(html: string): Anchor[] {
  const anchors: Anchor[] = [];
  const lower = html.toLowerCase();
  let cursor = 0;
  while (anchors.length < 500) {
    const start = lower.indexOf("<a", cursor);
    if (start < 0) break;
    const boundary = lower[start + 2];
    if (boundary && !/[\s>/]/.test(boundary)) {
      cursor = start + 2;
      continue;
    }
    const openEnd = html.indexOf(">", start);
    if (openEnd < 0) break;
    const href = readAttr(html.slice(start, openEnd + 1), "href");
    const close = lower.indexOf("</a", openEnd);
    const textEnd = close < 0 ? Math.min(html.length, openEnd + 240) : close;
    const text = decodeEntities(html.slice(openEnd + 1, textEnd).replace(/<[^>]+>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (href) anchors.push({ href, text });
    cursor = close < 0 ? openEnd + 1 : close + 3;
  }
  return anchors;
}

export function htmlToText(html: string): string {
  let source = stripComments(html);
  source = stripBlocks(source, BLOCK_TAGS);
  const labels: string[] = [];
  for (const match of source.matchAll(/\baria-label\s*=\s*"([^"]+)"/gi)) {
    const label = match[1] ?? "";
    if (/[$€£₺]|per\s|month|year|\/mo|ücretsiz|fiyat/i.test(label)) {
      labels.push(decodeEntities(label));
    }
  }
  source = source.replace(/<br\s*\/?>/gi, "\n");
  source = source.replace(
    /<\/(p|div|li|h[1-6]|tr|section|article|hgroup|td|th|ul|ol)>/gi,
    "\n",
  );
  source = source.replace(/<[^>]+>/g, " ");
  source = decodeEntities(source);
  if (labels.length) source += `\n${labels.join("\n")}`;
  const lines = source
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && line.length < 400);
  return lines.join("\n");
}

export function countPrices(text: string): number {
  return text.match(/[$€£₺]\s?\d/g)?.length ?? 0;
}

/** Keep the slice of text that contains the most price-like tokens. */
export function selectExcerpt(text: string, maxChars = 12_000): string {
  if (text.length <= maxChars) return text;
  let bestAt = 0;
  let bestScore = -1;
  const step = Math.max(400, Math.floor(maxChars / 2));
  for (let index = 0; index < text.length; index += step) {
    const slice = text.slice(index, index + maxChars);
    const score =
      slice.match(/[$€£₺]\s?\d|\b(?:per|\/)\s?(?:month|mo|year|yr|ay|yıl)\b/gi)?.length ?? 0;
    if (score > bestScore) {
      bestScore = score;
      bestAt = index;
    }
  }
  return text.slice(bestAt, bestAt + maxChars);
}

function readAttr(tag: string, name: string): string | null {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`,
    "i",
  );
  const match = tag.match(pattern);
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value ? decodeEntities(value).trim() : null;
}

function stripComments(html: string): string {
  let out = "";
  let cursor = 0;
  while (cursor < html.length) {
    const start = html.indexOf("<!--", cursor);
    if (start < 0) {
      out += html.slice(cursor);
      break;
    }
    out += html.slice(cursor, start);
    const end = html.indexOf("-->", start + 4);
    cursor = end < 0 ? html.length : end + 3;
  }
  return out;
}

function stripBlocks(html: string, tags: string[]): string {
  let current = html;
  for (const tag of tags) {
    const openToken = `<${tag}`;
    const closeToken = `</${tag}`;
    let result = "";
    let cursor = 0;
    const lower = current.toLowerCase();
    while (cursor < current.length) {
      const start = lower.indexOf(openToken, cursor);
      if (start < 0) {
        result += current.slice(cursor);
        break;
      }
      const boundary = lower[start + openToken.length];
      if (boundary && !/[\s>/]/.test(boundary)) {
        result += current.slice(cursor, start + openToken.length);
        cursor = start + openToken.length;
        continue;
      }
      result += current.slice(cursor, start);
      const end = lower.indexOf(closeToken, start + openToken.length);
      if (end < 0) {
        cursor = current.length;
        break;
      }
      const gt = current.indexOf(">", end);
      cursor = gt < 0 ? current.length : gt + 1;
    }
    current = result;
  }
  return current;
}
