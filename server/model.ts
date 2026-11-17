import Anthropic from "@anthropic-ai/sdk";

/** An error safe to show in the browser: never includes the key. */
export class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function modelConfig() {
  return {
    hasKey: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    model: process.env.JUDGE_MODEL?.trim() || "",
  };
}

let client: Anthropic | null = null;

/** Send one prompt to JUDGE_MODEL and return the text. Server-only. */
export async function complete(prompt: string): Promise<string> {
  const { hasKey, model } = modelConfig();
  if (!hasKey) throw new ModelError("ANTHROPIC_API_KEY is not set on the server. Add it to .env and restart.", 503);
  if (!model) throw new ModelError("JUDGE_MODEL is not set on the server. Add it to .env and restart.", 503);
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let res: Anthropic.Message;
  try {
    res = await client.messages.create({
      model,
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new ModelError("The API key was rejected (401). Check ANTHROPIC_API_KEY.", 502);
    if (e instanceof Anthropic.PermissionDeniedError) throw new ModelError(`This key may not use ${model} (403).`, 502);
    if (e instanceof Anthropic.NotFoundError) throw new ModelError(`Model "${model}" was not found (404). Check JUDGE_MODEL.`, 502);
    if (e instanceof Anthropic.RateLimitError) throw new ModelError("Rate limited by the API (429). Wait a minute and run again.", 429);
    if (e instanceof Anthropic.BadRequestError) throw new ModelError(`The API rejected the request (400): ${e.message}`, 502);
    if (e instanceof Anthropic.APIConnectionError) throw new ModelError("Could not reach the Anthropic API. Check your connection.", 502);
    if (e instanceof Anthropic.APIError) throw new ModelError(`Anthropic API error ${e.status ?? ""}: ${e.message}`, 502);
    throw e;
  }

  if (res.stop_reason === "refusal") throw new ModelError("The model declined to answer this prompt (refusal).", 502);
  const text = res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) throw new ModelError(`The model returned no text (stop reason: ${res.stop_reason}).`, 502);
  return text;
}
