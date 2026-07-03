import { config } from './config.js';

// Minimal GitHub Releases client using the built-in fetch (Node 18+). A token
// is optional for public repos but REQUIRED for a private one — without it the
// API returns 404 and we treat "no release found" gracefully (this was the
// "peering"/access gap when the repo is private during beta).

export interface Release {
  tag: string;
  name: string;
  htmlUrl: string;
  body: string;
  publishedAt: string;
  prerelease: boolean;
  assets: { name: string; url: string; size: number }[];
}

function headers(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'conquered-time-bot',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (config.githubToken) h.Authorization = `Bearer ${config.githubToken}`;
  return h;
}

/** Fetch the newest published (non-draft) release, or null if none/unauthorized. */
export async function fetchLatestRelease(): Promise<Release | null> {
  const url = `https://api.github.com/repos/${config.githubRepo}/releases?per_page=10`;
  let res: Response;
  try {
    res = await fetch(url, { headers: headers() });
  } catch (e) {
    console.warn('[github] fetch failed:', (e as Error).message);
    return null;
  }
  if (res.status === 404) {
    console.warn(`[github] ${config.githubRepo} returned 404 — repo is private and GITHUB_TOKEN is missing or lacks access.`);
    return null;
  }
  if (!res.ok) {
    console.warn(`[github] releases request failed: ${res.status} ${res.statusText}`);
    return null;
  }
  const list = (await res.json()) as Array<Record<string, any>>;
  const rel = list.find((r) => !r.draft);
  if (!rel) return null;
  return {
    tag: rel.tag_name,
    name: rel.name || rel.tag_name,
    htmlUrl: rel.html_url,
    body: rel.body || '',
    publishedAt: rel.published_at,
    prerelease: !!rel.prerelease,
    assets: (rel.assets || []).map((a: Record<string, any>) => ({
      name: a.name,
      url: a.browser_download_url,
      size: a.size,
    })),
  };
}
