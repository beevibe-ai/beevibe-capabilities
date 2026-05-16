# beevibe-capabilities

Community-contributed capability packs for [Beevibe](https://github.com/beevibe-ai/beevibe).

Each skill in `skills/` is a sandboxed recipe: goal pattern → GitHub repo → install steps → invocation. When your Beevibe agent uses the `beevibe-discover-repo` skill, it pulls from this registry to find community-proven capabilities.

## Contributing

1. Create a successful `use_repo` run in your Beevibe instance
2. Click "Save as capability" on the approved artifact
3. Click "Share" — the UI files a PR here automatically, or returns step-by-step instructions for a manual PR if `BEEVIBE_REGISTRY_TOKEN` is not set

## Structure

```
skills/
  <name>/
    SKILL.md    # goal_pattern, repo_url, repo_ref, install_steps, invocation
registry.json   # auto-generated index (updated on each PR merge)
```

## License

Each skill's license is determined by the source repo's license. The SKILL.md itself is CC0.
