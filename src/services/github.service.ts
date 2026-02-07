import { Octokit } from "@octokit/rest";
import { config } from "../config.js";

const octokit = new Octokit({ auth: config.GITHUB_TOKEN });

export function parseRepoUrl(repoUrl: string): { owner: string; repo: string } {
  // SSH: git@github.com:owner/repo.git
  const sshMatch = repoUrl.match(/git@github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = repoUrl.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  throw new Error(`Unable to parse repo URL: ${repoUrl}`);
}

export async function findExistingPr(
  owner: string,
  repo: string,
  head: string,
): Promise<{ url: string } | null> {
  const { data: prs } = await octokit.pulls.list({
    owner,
    repo,
    head: `${owner}:${head}`,
    state: "open",
  });

  if (prs.length > 0) {
    return { url: prs[0].html_url };
  }

  return null;
}

export async function createPr(
  owner: string,
  repo: string,
  options: { title: string; body: string; head: string; base: string },
): Promise<{ url: string }> {
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title: options.title,
    body: options.body,
    head: options.head,
    base: options.base,
  });

  return { url: pr.html_url };
}
