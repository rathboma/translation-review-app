// JSON responses. Nothing the Functions return is cached or indexed.
export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", ...headers },
  });
}

export const fail = (status: number, error: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  json({ ok: false, error, ...extra }, status, headers);

// The request's body as text, refusing more than `max` bytes.
export async function readText(request: Request, max: number): Promise<string | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > max) return null;
  const text = await request.text();
  return new TextEncoder().encode(text).length > max ? null : text;
}

// Runs `fn` over `items`, `limit` at a time, keeping their order.
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
