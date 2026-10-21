// Cloudflare Turnstile: the widget's token is checked once, server side.
import { DEFAULT_TURNSTILE_VERIFY, type Env } from "./env.ts";

export async function verifyTurnstile(env: Env, token: string, ip: string): Promise<boolean> {
  const form = new FormData();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  if (ip !== "unknown") form.set("remoteip", ip);
  try {
    const response = await fetch(env.TURNSTILE_VERIFY_URL || DEFAULT_TURNSTILE_VERIFY, { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return false;
    return (await response.json<{ success?: boolean }>()).success === true;
  } catch {
    return false;
  }
}
