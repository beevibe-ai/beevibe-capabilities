# beevibe-capabilities

The community-maintained data layer that powers Beevibe's
[`find_repo`](https://github.com/beevibe-ai/beevibe) MCP tool.

Beevibe agents call `find_repo({ goal })` to discover which open-source
repo to borrow for a task. The ranker reads four signal sources, two of
which live here:

- **`data/boost-list.json`** — curated repos for common task families
  (PDF parsing, video transcoding, web scraping, etc.). Hand-edited,
  changes infrequently. Adds +20 to the matching candidate's score.
- **`data/registry.json`** — community-promoted learned skills.
  Populated when a beevibe team approves a `skill_outcome` and the
  publishing flow lands a PR here. Adds +30.
- **`data/trending-daily.json`** / **`-weekly.json`** / **`-monthly.json`**
  — GitHub repos with recent star velocity, refreshed via the cron in
  `.github/workflows/refresh.yml`. Adds +15 if a candidate appears
  in the daily or weekly window. The hybrid query
  (`pushed:>X stars:>Y sort:stars-desc`) catches both brand-new repos
  AND established repos hitting a star spike.

Beevibe fetches these files from `raw.githubusercontent.com` — no API
hosting, no auth, no rate limit. Falls back to bundled local copies if
the network is unreachable.

## File contracts

Each JSON file in `data/` is consumed by beevibe's `find_repo` tool.
The shapes are pinned — don't break them without a coordinated change
to [`packages/api/src/tools/find-repo.ts`](https://github.com/beevibe-ai/beevibe/blob/main/packages/api/src/tools/find-repo.ts).

### `boost-list.json`

```json
{
  "description": "Curated repos to boost in the discovery ranker...",
  "version": "1.0.0",
  "entries": [
    {
      "repo_url": "https://github.com/jsvine/pdfplumber",
      "goal_keywords": ["pdf", "extract", "table", "parse"],
      "language": "python",
      "category": "data"
    }
  ]
}
```

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

## Adding to `boost-list.json`

Open a PR with a new entry. Criteria:

- The repo solves a **common** goal class (PDF, audio, video, OCR, etc.)
- It has a **clean install path** (one `pip install` or `apt-get install`
  command — agents have to figure this out from the README inside a sandbox)
- It's actively maintained (commits in the last ~6 months)

Don't add: niche libraries, libraries with heavy native deps,
abandonware. The boost list is a curated short-list — quality over
coverage.

## Promotions from `skill_outcome` to `registry.json`

When a beevibe team approves enough `skill_outcome` reviews for a saved
`learned_skill`, the publish flow opens a PR here adding the skill to
`registry.json`. Reviewer signs off, merge. The skill becomes available
to every beevibe instance globally.

The threshold + automation lives in
[`packages/api/src/routes/learned-skills.ts`](https://github.com/beevibe-ai/beevibe/blob/main/packages/api/src/routes/learned-skills.ts).
