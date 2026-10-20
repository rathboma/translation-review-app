// The app's own Functions.
import type { AnnotatedPage, ManifestInfo, SubmitBody, SubmitResponse } from "../../shared/types.ts";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Body<T> = Partial<T> & { error?: string; code?: string };

async function body<T>(response: Response): Promise<Body<T>> {
  try {
    return (await response.json()) as Body<T>;
  } catch {
    return {};
  }
}

async function get<T>(url: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { headers: { accept: "application/json" } });
  } catch {
    throw new ApiError(0, "Couldn't reach the server. Check your connection and try again.");
  }
  const data = await body<T>(response);
  if (!response.ok) throw new ApiError(response.status, data.error ?? `The server answered ${response.status}.`, data.code);
  return data as T;
}

type Failure = Extract<SubmitResponse, { ok: false }>;

export const getManifest = () => get<ManifestInfo>("/api/manifest");

export const getPage = (lang: string, path: string) => get<AnnotatedPage>(`/api/page?lang=${encodeURIComponent(lang)}&path=${encodeURIComponent(path)}`);

export async function postSubmit(submission: SubmitBody): Promise<{ status: number; data: SubmitResponse }> {
  try {
    const response = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(submission) });
    const data = await body<SubmitResponse>(response);
    if (response.ok) return { status: response.status, data: data as SubmitResponse };
    return { status: response.status, data: { ...(data as Failure), ok: false, error: data.error ?? `The server answered ${response.status}.` } };
  } catch {
    return { status: 0, data: { ok: false, error: "Couldn't reach the server. Your notes are still in your queue: check your connection and try again." } };
  }
}
