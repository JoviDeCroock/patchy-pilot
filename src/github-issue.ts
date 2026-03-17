import { exec } from "./utils/process.js";
import { log } from "./utils/logger.js";

/**
 * Matches GitHub issue URLs like:
 *   https://github.com/owner/repo/issues/123
 *   http://github.com/owner/repo/issues/456
 */
const GITHUB_URL_RE = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)\/?$/;

/**
 * Matches shorthand references like:
 *   owner/repo#123
 */
const SHORTHAND_RE = /^([^/]+\/[^/#]+)#(\d+)$/;

export interface GitHubIssueRef {
  repo: string; // "owner/repo"
  number: number;
}

/**
 * Attempt to parse a string as a GitHub issue reference.
 * Returns the parsed ref or null if the string isn't a recognizable issue reference.
 */
export function parseGitHubIssue(input: string): GitHubIssueRef | null {
  const urlMatch = input.match(GITHUB_URL_RE);
  if (urlMatch) {
    return { repo: urlMatch[1], number: Number(urlMatch[2]) };
  }

  const shortMatch = input.match(SHORTHAND_RE);
  if (shortMatch) {
    return { repo: shortMatch[1], number: Number(shortMatch[2]) };
  }

  return null;
}

/**
 * Fetch a GitHub issue's title and body using the `gh` CLI.
 * Returns formatted text suitable for use as a feature spec.
 */
export async function fetchGitHubIssue(ref: GitHubIssueRef): Promise<string> {
  log.step(`Fetching GitHub issue ${ref.repo}#${ref.number}`);

  const result = await exec("gh", [
    "issue",
    "view",
    String(ref.number),
    "--repo",
    ref.repo,
    "--json",
    "title,body",
  ]);

  if (result.exitCode !== 0) {
    const msg = result.stderr.trim() || result.stdout.trim();
    throw new Error(`Failed to fetch GitHub issue ${ref.repo}#${ref.number}: ${msg}`);
  }

  const data = JSON.parse(result.stdout) as { title: string; body: string };
  const body = (data.body ?? "").trim();

  return body ? `# ${data.title}\n\n${body}` : `# ${data.title}`;
}
