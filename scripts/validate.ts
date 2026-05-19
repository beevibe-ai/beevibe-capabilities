/**
 * validate.ts — sanity-checks the JSON files in data/ before commit.
 * Used by both the GitHub Actions cron (so a malformed trending fetch
 * doesn't land in main) and PR contributors editing registry.json
 * by hand.
 *
 * Exits 0 on success, 1 on any error. Prints the file + reason per
 * failure so CI logs are actionable.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface RegistrySkill {
  repo_url: string;
  goal_pattern: string;
  invocation?: string;
}
interface Registry {
  version: string;
  skills: RegistrySkill[];
}

interface TrendingRepo {
  repo_url: string;
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  /** Stars GAINED in the period — not lifetime stars. */
  stars_gained: number;
  rank: number;
}
interface TrendingSnapshot {
  fetched_at: string;
  period: "daily" | "weekly" | "monthly";
  source: string;
  repos: TrendingRepo[];
}

const errors: string[] = [];

function check(cond: unknown, msg: string): asserts cond {
  if (!cond) errors.push(msg);
}

function isGithubUrl(s: unknown): boolean {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && /(^|\.)github\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}


async function validateRegistry(path: string): Promise<void> {
  const raw = JSON.parse(await readFile(path, "utf8")) as Registry;
  check(typeof raw.version === "string", `${path}: missing version`);
  check(Array.isArray(raw.skills), `${path}: skills must be array`);
  if (!Array.isArray(raw.skills)) return;
  raw.skills.forEach((s, i) => {
    check(isGithubUrl(s.repo_url), `${path}#skills[${i}]: invalid repo_url`);
    check(
      typeof s.goal_pattern === "string" && s.goal_pattern.length > 0,
      `${path}#skills[${i}]: goal_pattern required`,
    );
  });
}

async function validateTrending(path: string, expectedPeriod: TrendingSnapshot["period"]): Promise<void> {
  let raw: TrendingSnapshot;
  try {
    raw = JSON.parse(await readFile(path, "utf8")) as TrendingSnapshot;
  } catch (err) {
    // Missing file is OK on first commit before the cron has run.
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    errors.push(`${path}: parse failed: ${(err as Error).message}`);
    return;
  }
  check(raw.period === expectedPeriod, `${path}: period must be "${expectedPeriod}", got "${raw.period}"`);
  check(typeof raw.fetched_at === "string", `${path}: fetched_at required`);
  check(typeof raw.source === "string", `${path}: source required`);
  check(Array.isArray(raw.repos), `${path}: repos must be array`);
  if (!Array.isArray(raw.repos)) return;
  raw.repos.forEach((r, i) => {
    check(isGithubUrl(r.repo_url), `${path}#repos[${i}]: invalid repo_url`);
    check(typeof r.stars_gained === "number" && r.stars_gained >= 0, `${path}#repos[${i}]: stars_gained must be ≥0`);
    check(typeof r.rank === "number" && r.rank === i + 1, `${path}#repos[${i}]: rank must equal ${i + 1}`);
  });
}

async function main(): Promise<void> {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const dataDir = join(repoRoot, "data");
  await validateRegistry(join(dataDir, "registry.json"));
  await validateTrending(join(dataDir, "trending-daily.json"), "daily");
  await validateTrending(join(dataDir, "trending-weekly.json"), "weekly");
  await validateTrending(join(dataDir, "trending-monthly.json"), "monthly");

  if (errors.length > 0) {
    console.error(`✗ ${errors.length} validation error(s):`);
    for (const e of errors) console.error("  -", e);
    process.exit(1);
  }
  console.log("✓ all data files valid");
}

main().catch((err) => {
  console.error("[validate] FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
