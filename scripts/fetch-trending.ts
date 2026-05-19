/**
 * fetch-trending.ts — pulls "trending" repos from GitHub Search API and
 * writes data/trending-{daily,weekly,monthly}.json.
 *
 * GitHub has no official trending API. The community workarounds either
 * scrape the HTML trending page (fragile — breaks when GitHub tweaks
 * markup) or build a full event-stream pipeline (overkill). The hybrid
 * we use here approximates trending with `pushed:>DATE stars:>N
 * sort:stars-desc` on the official Search API:
 *
 *   - `pushed:>` captures both brand-new repos AND established repos
 *     hitting a fresh release / star spike
 *   - `stars:>N` floors the noise (different threshold per window)
 *   - `sort:stars-desc` ranks the survivors
 *
 * Outputs are pinned snapshots — the whole file is overwritten each
 * run. Beevibe's find_repo reads these via raw.githubusercontent.com
 * with in-memory TTL caching, so the consumer pays no per-request
 * GitHub API cost.
 *
 * Usage:
 *   GITHUB_TOKEN=ghp_... pnpm tsx scripts/fetch-trending.ts
 *   DRY_RUN=1            pnpm tsx scripts/fetch-trending.ts  # logs only
 */
import { writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Period = "daily" | "weekly" | "monthly";

interface PeriodConfig {
  /** How many days back the `pushed:>DATE` clause looks. */
  daysBack: number;
  /** Minimum stars floor — keeps trash out of the lower tiers. */
  minStars: number;
  /** How many results to keep in the JSON file. */
  topN: number;
}

const CONFIGS: Record<Period, PeriodConfig> = {
  daily:   { daysBack: 2,  minStars: 100,  topN: 30 },
  weekly:  { daysBack: 7,  minStars: 500,  topN: 50 },
  monthly: { daysBack: 30, minStars: 1500, topN: 50 },
};

interface GitHubSearchItem {
  html_url: string;
  full_name: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  pushed_at: string;
  archived?: boolean;
  fork?: boolean;
}

interface GitHubSearchResponse {
  total_count: number;
  incomplete_results: boolean;
  items: GitHubSearchItem[];
}

interface TrendingRepo {
  repo_url: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  stars: number;
  rank: number;
}

interface TrendingSnapshot {
  fetched_at: string;
  period: Period;
  source: string;
  repos: TrendingRepo[];
}

async function fetchPeriod(period: Period, token: string | undefined): Promise<TrendingSnapshot> {
  const cfg = CONFIGS[period];
  const since = new Date(Date.now() - cfg.daysBack * 86_400_000).toISOString().split("T")[0]!;
  const q = `pushed:>${since} stars:>${cfg.minStars}`;
  const url =
    `https://api.github.com/search/repositories` +
    `?q=${encodeURIComponent(q)}` +
    `&sort=stars&order=desc&per_page=${Math.min(cfg.topN, 100)}`;

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "beevibe-capabilities/fetch-trending",
  };
  if (token) headers.Authorization = `token ${token}`;

  console.log(`[${period}] querying: ${q}`);
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub Search API ${res.status} for ${period}: ${body.slice(0, 300)}`);
  }
  const body = (await res.json()) as GitHubSearchResponse;

  // Filter forks + archived; rank the survivors.
  const survivors = body.items
    .filter((r) => !r.fork && !r.archived)
    .slice(0, cfg.topN);

  const repos: TrendingRepo[] = survivors.map((r, i) => {
    const [owner = "", name = ""] = r.full_name.split("/");
    return {
      repo_url: r.html_url,
      owner,
      name,
      description: r.description,
      language: r.language,
      stars: r.stargazers_count,
      rank: i + 1,
    };
  });

  console.log(`[${period}] ${repos.length} repos (top star: ${repos[0]?.stars ?? "—"})`);

  return {
    fetched_at: new Date().toISOString(),
    period,
    source: `github-search:${q} sort:stars-desc`,
    repos,
  };
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn(
      "[fetch-trending] GITHUB_TOKEN not set — falling back to anonymous rate " +
        "limit (60 req/hr per IP). Three queries fit comfortably; will fail if " +
        "you re-run this script many times in an hour.",
    );
  }

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = join(repoRoot, "data");
  const dryRun = process.env.DRY_RUN === "1";

  // Sequential, not parallel — three back-to-back API calls is fine and
  // makes failure attribution clearer if a single window blows up.
  for (const period of ["daily", "weekly", "monthly"] as const) {
    const snapshot = await fetchPeriod(period, token);
    if (dryRun) {
      console.log(`[${period}] DRY_RUN — skipping write`);
      console.log(JSON.stringify(snapshot, null, 2).slice(0, 500) + "...");
      continue;
    }
    const path = join(dataDir, `trending-${period}.json`);
    await writeFile(path, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
    console.log(`[${period}] wrote ${path}`);
  }

  console.log("[fetch-trending] done.");
}

main().catch((err) => {
  console.error("[fetch-trending] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
