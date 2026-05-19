# beevibe-capabilities

The community-maintained data layer that powers Beevibe's
[`find_repo`](https://github.com/beevibe-ai/beevibe) MCP tool.

Beevibe agents call `find_repo({ goal })` to discover which open-source
repo to borrow for a task. The ranker reads two signal sources from here:

- **`data/registry.json`** — community-promoted learned skills.
  Populated when a beevibe team approves a `skill_outcome` and the
  publishing flow lands a PR here. Adds +30. This is the curation
  that **builds itself from real proven outcomes**, not opinion.
- **`data/trending-daily.json`** / **`-weekly.json`** / **`-monthly.json`**
  — GitHub repos with recent star velocity, refreshed daily via the
  cron in `.github/workflows/refresh.yml`. Adds +25 if a candidate
  appears in the daily or weekly window. The hybrid query
  (`pushed:>X stars:>Y sort:stars-desc`) catches both brand-new repos
  AND established repos hitting a star spike.

Beevibe fetches these via `raw.githubusercontent.com` — no API
hosting, no auth, no rate limit on the read side.

## No curated boost list (intentional)

The repo used to ship a hand-curated `boost-list.json` (pdfplumber,
yt-dlp, FFmpeg, transformers, etc.) that bumped well-known mature
tools above raw GitHub search. We removed it. Reasons:

- Those tools are already in every LLM's training data — agents know
  about them. The boost added no information.
- "Mature, stable" is the opposite of "trending" — by definition the
  boost list misses what just shipped this week.
- Hand-curation creates opinion drift. v1 of the boost list contained
  a hallucinated repo (`nicowillis/spreadsheet-intelligence`) that
  didn't exist, and ranked it equally with real ones.

If a tool repeatedly proves itself across beevibe instances, the
publish flow promotes it to `registry.json` automatically — that's
the path where curation comes from real proven outcomes, not opinion.

## File contracts

Each JSON file in `data/` is consumed by beevibe's `find_repo` tool.
The shapes are pinned — don't break them without a coordinated change
to [`packages/api/src/tools/find-repo.ts`](https://github.com/beevibe-ai/beevibe/blob/main/packages/api/src/tools/find-repo.ts).

### `registry.json`

```json
{
  "version": "1.0.0",
  "skills": [
    {
      "repo_url": "https://github.com/foo/bar",
      "goal_pattern": "extract tables from a PDF",
      "invocation": "python -m foo.cli --input <pdf>"
    }
  ]
}
```

### `trending-{daily,weekly,monthly}.json`

```json
{
  "fetched_at": "2026-05-19T14:00:00Z",
  "period": "daily",
  "source": "github-search:pushed:>2026-05-17 stars:>100 sort:stars-desc",
  "repos": [
    {
      "repo_url": "https://github.com/owner/name",
      "owner": "owner",
      "name": "name",
      "description": "What it does, one sentence.",
      "language": "python",
      "stars": 2843,
      "rank": 1
    }
  ]
}
```

## Refresh cycle

A GitHub Actions cron at noon UTC daily runs `scripts/fetch-trending.ts`
against the GitHub Search API (auth'd with the workflow's `GITHUB_TOKEN`
for 5000-req/hr capacity), regenerates the three trending JSON files,
and commits the diff to `main`.

The fetch can also be triggered manually:

```bash
GITHUB_TOKEN=... pnpm tsx scripts/fetch-trending.ts
```

A future "dogfooding" path will route the daily refresh through a
beevibe agent task instead of GitHub Actions — exercising the
Capability Network on a real, ongoing maintenance job. The Actions cron
stays in place as the production safety net.

## Promotions from `skill_outcome` to `registry.json`

When a beevibe team approves enough `skill_outcome` reviews for a saved
`learned_skill`, the publish flow opens a PR here adding the skill to
`registry.json`. Reviewer signs off, merge. The skill becomes available
to every beevibe instance globally.

The threshold + automation lives in
[`packages/api/src/routes/learned-skills.ts`](https://github.com/beevibe-ai/beevibe/blob/main/packages/api/src/routes/learned-skills.ts).
