// Files an issue on the translations repository.
import { DEFAULT_GITHUB_API, DEFAULT_GITHUB_REPO, type Env } from "./env.ts";

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface CreatedIssue {
  number: number;
  url: string;
}

export async function createIssue(env: Env, issue: { title: string; body: string; labels: string[] }): Promise<CreatedIssue> {
  const repo = env.GITHUB_REPO || DEFAULT_GITHUB_REPO;
  const api = (env.GITHUB_API_URL || DEFAULT_GITHUB_API).replace(/\/+$/, "");
  let response: Response;
  try {
    response = await fetch(`${api}/repos/${repo}/issues`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "translation-review",
        "content-type": "application/json",
      },
      body: JSON.stringify(issue),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    throw new GitHubError(502, `GitHub did not answer (${error instanceof Error ? error.name : "error"})`);
  }
  if (!response.ok) {
    const body = await response.json<{ message?: string }>().catch(() => ({}) as { message?: string });
    throw new GitHubError(response.status, `GitHub refused the issue (${response.status}${body.message ? `: ${body.message}` : ""})`);
  }
  const created = await response.json<{ number?: unknown; html_url?: unknown }>().catch(() => ({}) as { number?: unknown; html_url?: unknown });
  // A redirect (a renamed repository) can turn the POST into a GET: not an issue.
  if (typeof created.number !== "number" || typeof created.html_url !== "string") throw new GitHubError(502, "GitHub's answer was not an issue");
  return { number: created.number, url: created.html_url };
}
