// Who filed which issue. The repository is public, so an issue shows the
// reviewer's name only; the email stays here, keyed by issue number, for the
// owner to get in touch.
import type { Env } from "./env.ts";
import type { Reviewer } from "../shared/types.ts";

export interface ReviewerRecord extends Reviewer {
  // Every issue the same submission became.
  issues: number[];
  at: string;
}

export const reviewerKey = (issue: number) => `issue:${issue}`;

export async function saveReviewer(env: Env, reviewer: Reviewer, issues: number[], at: Date): Promise<void> {
  const record: ReviewerRecord = { name: reviewer.name, email: reviewer.email, issues, at: at.toISOString() };
  await Promise.all(issues.map((n) => env.REVIEWERS.put(reviewerKey(n), JSON.stringify(record))));
}
