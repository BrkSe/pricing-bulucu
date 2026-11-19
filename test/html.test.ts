import assert from "node:assert/strict";
import { test } from "node:test";
import { countPrices, extractAnchors, htmlToText, selectExcerpt } from "../src/html.ts";

const sample = `
  <html><head><style>.x{color:red}</style><script>var price = "$999";</script></head>
  <body>
    <nav><a href="/blog">Blog</a><a href="/pricing">Fiyatlar</a></nav>
    <main>
      <h2>Basic</h2>
      <p>$10 per user/month</p>
      <span aria-label="$16 per user/month">Business</span>
    </main>
    <footer>gizli $1</footer>
  </body></html>
`;

test("strips scripts, styles, nav and footer", () => {
  const text = htmlToText(sample);
  assert.equal(text.includes("$999"), false);
  assert.equal(text.includes("gizli"), false);
  assert.equal(text.includes("Blog"), false);
  assert.ok(text.includes("Basic"));
  assert.ok(countPrices(text) >= 2);
});

test("reads pricing links", () => {
  const anchors = extractAnchors(sample);
  assert.ok(anchors.some((anchor) => anchor.href === "/pricing" && /fiyat/i.test(anchor.text)));
});

test("keeps the price-dense window", () => {
  const filler = `${"lorem ipsum dolor sit amet. ".repeat(800)}\n`;
  const text = `${filler}$12 / ay\nPro\n${filler}`;
  const excerpt = selectExcerpt(text, 500);
  assert.ok(excerpt.includes("$12"));
  assert.ok(excerpt.length <= 500);
});
