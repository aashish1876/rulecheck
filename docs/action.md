# GitHub Action

Use the action after checking out the repository. Replace `<owner>` with the GitHub account or organization that owns rulecheck.

```yaml
- uses: actions/checkout@v4
- uses: <owner>/rulecheck@v0
  with:
    min-score: 80
```

The example works after the rulecheck repository is public and a `v0` tag exists.

| Input / output | Default | Description |
| --- | --- | --- |
| `path` | `.` | Directory to lint, relative to the workspace. |
| `ignore` | empty | Comma-separated glob patterns to ignore. |
| `min-score` | empty | Fail when the score is below this value. |
| `max-warnings` | empty | Fail when warnings exceed this value. |
| `verbose` | `false` | Include informational findings. |
| `score` (output) | empty | Score from 0 to 100; empty when no rules files are found. |
