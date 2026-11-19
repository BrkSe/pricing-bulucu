import assert from "node:assert/strict";
import { test } from "node:test";
import { drive, nextClick, type PricingPage } from "../src/drive.ts";
import { extractPlansFromText } from "../src/plans.ts";

const yearly = `Starter
For teams making their first technical hires.
$79
/mo
$948 billed annually
Pro
For growing teams.
$419
/mo
Enterprise
Custom pricing
`;

const monthly = `Starter
For teams making their first technical hires.
$99
/mo
Billed monthly
Pro
For growing teams.
$529
/mo
Enterprise
Custom pricing
`;

test("clicks the unchecked billing period and keeps both prices", async () => {
  let mode: "yearly" | "monthly" = "yearly";
  const page: PricingPage = {
    async goto() {},
    async text() {
      return mode === "yearly" ? yearly : monthly;
    },
    async controls() {
      return [
        { text: "Monthly", checked: mode === "monthly" },
        { text: "Annually", checked: mode === "yearly" },
      ];
    },
    async click(label) {
      if (/month/i.test(label)) {
        mode = "monthly";
        return true;
      }
      if (/annual|year/i.test(label)) {
        mode = "yearly";
        return true;
      }
      return false;
    },
  };
  const snapshots = await drive(page, "https://example.com/pricing", async (context) =>
    nextClick(context.controls, context.snapshots, context.seen),
  );
  assert.equal(snapshots[0]?.billing, "yearly");
  assert.ok(snapshots.some((snapshot) => snapshot.billing === "monthly"));
  const prices = snapshots.flatMap((snapshot) =>
    extractPlansFromText(snapshot.text).map((plan) => plan.price),
  );
  for (const price of ["$79", "$419", "$99", "$529"]) {
    assert.ok(prices.includes(price), prices.join(","));
  }
});

test("does not click a billing toggle that is already selected", () => {
  const choice = nextClick(
    [
      { text: "Monthly", checked: false },
      { text: "Annually", checked: true },
    ],
    [{ billing: "yearly", label: "açılış", text: "" }],
    new Set(),
  );
  assert.equal(choice, "Monthly");
});
