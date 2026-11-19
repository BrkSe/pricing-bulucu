import { jsonFromModel, plansFromModel, type Plan } from "./plans";

export const DEFAULT_MODEL = "@cf/google/gemma-4-26b-a4b-it";

const SYSTEM = [
  "You extract software pricing plans from pricing-page text.",
  "Return only JSON. Do not invent plans or prices that are not in the text.",
  "Each plan needs name, price (as printed, like \"$10\" or \"Ücretsiz\"), currency (USD, EUR, TRY, GBP, or empty), period (short, such as \"ay\", \"yıl\", \"kullanıcı / ay\"), features (at most 6 short strings), and notes.",
  "If the text has no real prices, return {\"plans\":[]}.",
].join(" ");

const SCHEMA = {
  type: "object",
  properties: {
    plans: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "string" },
          currency: { type: "string" },
          period: { type: "string" },
          features: { type: "array", items: { type: "string" } },
          notes: { type: "string" },
        },
        required: ["name", "price", "currency", "period", "features", "notes"],
      },
    },
  },
  required: ["plans"],
};

export async function extractWithModel(
  ai: Ai,
  model: string,
  excerpt: string,
): Promise<Plan[] | null> {
  const messages = [
    { role: "system" as const, content: SYSTEM },
    { role: "user" as const, content: excerpt },
  ];
  const input = {
    messages,
    temperature: 0,
    max_tokens: 1400,
    response_format: { type: "json_schema", json_schema: SCHEMA },
    // Gemma 4 reasons by default. Structured extraction does not need it,
    // and the extra tokens spend the free daily neuron allowance.
    chat_template_kwargs: { enable_thinking: false },
  };
  try {
    const structured = await ai.run(model, input);
    const plans = plansFromModel(structured);
    if (plans) return plans;
  } catch (error) {
    console.error(
      JSON.stringify({
        message: "ai.json_mode_failed",
        model,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }

  const plain = await ai.run(model, {
    ...input,
    messages: [
      { role: "system" as const, content: SYSTEM },
      {
        role: "user" as const,
        content: `${excerpt}\n\nRespond with one JSON object and no markdown.`,
      },
    ],
    response_format: undefined,
  });
  return plansFromModel(plain);
}

export async function chooseClick(
  ai: Ai,
  model: string,
  controls: Array<{ text: string; checked: boolean }>,
  captured: string[],
): Promise<string | null> {
  const listed = controls
    .map((control, index) => `${index}. ${control.text}${control.checked ? " (selected)" : ""}`)
    .join("\n");
  const result = await ai.run(model, {
    messages: [
      {
        role: "system",
        content:
          'Pick the next pricing control to click so both monthly and yearly prices are visible. Reply with JSON {"click":"exact control text"} or {"click":null} when both periods are already captured. Only choose monthly, yearly, compare, or show-more controls.',
      },
      {
        role: "user",
        content: `Already captured: ${captured.join(", ") || "none"}\nControls:\n${listed}`,
      },
    ],
    temperature: 0,
    max_tokens: 80,
    chat_template_kwargs: { enable_thinking: false },
  });
  const parsed = jsonFromModel(result);
  if (!parsed || typeof parsed !== "object" || !("click" in parsed)) return null;
  const click = (parsed as { click: unknown }).click;
  return typeof click === "string" && click.trim() ? click.trim() : null;
}
