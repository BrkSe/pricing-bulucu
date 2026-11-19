import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPlansFromText, plansFromModel } from "../src/plans.ts";

const linearLike = `
Free
$0
Free for everyone
Basic
$10 per user/month
All Free features +
Unlimited issues
Business
$16 per user/month
Admin roles
Enterprise
Custom
SAML
`;

test("pairs headings with nearby prices", () => {
  const plans = extractPlansFromText(linearLike);
  const names = plans.map((plan) => plan.name);
  assert.deepEqual(names.slice(0, 4), ["Free", "Basic", "Business", "Enterprise"]);
  const basic = plans.find((plan) => plan.name === "Basic");
  assert.equal(basic?.price, "$10");
  assert.equal(basic?.currency, "USD");
  assert.equal(basic?.period, "kullanıcı / ay");
  assert.ok(basic?.features.includes("Unlimited issues"));
});

test("repairs fenced and trailing-comma JSON", () => {
  const raw = `Here you go:\n\`\`\`json\n{"plans":[{"name":"Plus","price":10,"currency":"USD","period":"ay","features":["SSO",],"notes":"yıllık",}]}\n\`\`\``;
  const plans = plansFromModel(raw);
  assert.equal(plans?.[0]?.name, "Plus");
  assert.equal(plans?.[0]?.price, "10");
  assert.deepEqual(plans?.[0]?.features, ["SSO"]);
});

test("unwraps a Workers AI response object", () => {
  const plans = plansFromModel({
    response: {
      plans: [
        {
          name: "Pro",
          price: "$20",
          currency: "USD",
          period: "aylık",
          features: ["API"],
          notes: "",
        },
      ],
    },
  });
  assert.equal(plans?.[0]?.price, "$20");
  assert.equal(plans?.[0]?.notes, null);
});

test("reads JSON from a chat-completions payload", () => {
  const plans = plansFromModel({
    choices: [
      {
        message: {
          content: '{"plans":[{"name":"Teams","price":"$12","currency":"USD","period":"aylık","features":["SSO"],"notes":""}]}',
        },
      },
    ],
  });
  assert.equal(plans?.[0]?.name, "Teams");
  assert.equal(plans?.[0]?.price, "$12");
});

test("returns null when the model did not produce JSON", () => {
  assert.equal(plansFromModel("I could not find prices."), null);
});
