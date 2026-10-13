export type ProviderName = "gemini" | "openrouter";
export interface ProviderConfig { name: ProviderName; model: string; endpoint: string; apiKey: string; }
export function getProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig[] {
  if (env.ALLOW_PAID_AI === "true") throw new Error("Paid AI is disabled by Scoialpilot safety policy.");
  const providers: ProviderConfig[] = [];
  if (env.GEMINI_API_KEY) providers.push({ name: "gemini", model: env.GEMINI_MODEL || "gemini-2.5-flash", endpoint: "https://generativelanguage.googleapis.com/v1beta/models", apiKey: env.GEMINI_API_KEY });
  if (env.OPENROUTER_API_KEY && env.OPENROUTER_FREE_MODEL) providers.push({ name: "openrouter", model: env.OPENROUTER_FREE_MODEL, endpoint: "https://openrouter.ai/api/v1/chat/completions", apiKey: env.OPENROUTER_API_KEY });
  if (env.OPENROUTER_API_KEY && !env.OPENROUTER_FREE_MODEL) throw new Error("OPENROUTER_FREE_MODEL must explicitly name a free model. No automatic paid-model fallback is allowed.");
  if (!providers.length) throw new Error("Configure GEMINI_API_KEY and/or OPENROUTER_API_KEY with OPENROUTER_FREE_MODEL.");
  return providers;
}
