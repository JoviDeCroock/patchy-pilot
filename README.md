# patchy-pilot

Local AI workflow harness that automatically runs an independent review pass after an AI coding session finishes.

One AI builds. Another AI reviews. Deterministic checks run in between. Everything is saved to disk.

## How it works

```
spec → builder AI → formatter/linter/typecheck/tests → artifact collection → reviewer AI → gating → (optional repair)
```

1. A **builder** AI implements a feature from a spec
2. **Deterministic validation** runs (formatter, linter, typecheck, tests)
3. **Artifacts** are collected (git diff, changed files, test output)
4. A separate **reviewer** AI independently inspects the result
5. **Gating** checks whether the review passes severity thresholds
6. An optional **repair** pass fixes issues the reviewer found

The reviewer is independent from the builder — it doesn't trust the builder's output and verifies everything against the original spec and the actual code.

## Install

```bash
pnpm install
pnpm build
```

To use globally:

```bash
pnpm link --global
```

Or run directly:

```bash
node dist/cli.js <command>
```

## CLI Commands

### `ppilot feature <spec>`

Full workflow: build → validate → review → (repair).

```bash
# Inline spec
ppilot feature "Add a retry mechanism to the HTTP client with exponential backoff"

# Spec from file
ppilot feature @specs/retry-mechanism.md

# Skip the build step (review existing uncommitted changes)
ppilot feature --no-build "Add retry mechanism"

# Enable automatic repair if review finds issues
ppilot feature --repair "Add retry mechanism"

# Override providers
ppilot feature --builder claude-code --reviewer claude-code "Add retry mechanism"
```

### `ppilot review <spec>`

Review-only: run validation and AI review on existing changes without building first.

```bash
ppilot review "The changes should implement a retry mechanism with exponential backoff"
ppilot review @specs/retry-mechanism.md
```

### `ppilot repair <review-file> <spec>`

Run a repair pass using findings from a previous review.

```bash
ppilot repair .patchy-pilot/runs/2026-03-16T14-30-00/review.json @specs/retry-mechanism.md
```

### `ppilot learn`

Analyze recent patchy-pilot runs and turn repeated lessons, blind spots, or non-obvious expectations into reusable skill files.

```bash
# Analyze the 10 most recent runs and write skills to .patchy-pilot/skills
ppilot learn

# Analyze a smaller window of recent runs
ppilot learn --limit 5

# Override the provider used for learning
ppilot learn --learner opencode --learner-model gpt-5
```

The command writes a `README.md`, `manifest.json`, and one Markdown file per generated skill under `.patchy-pilot/skills/`.

### `ppilot report [run-id]`

Generate a self-contained HTML report from a run's artifacts.

```bash
# Report for the most recent run
ppilot report

# Report for a specific run
ppilot report 2026-03-16T19-39-58

# Write to a custom path
ppilot report -o review-report.html
```

The report includes validation results, all review findings grouped by category and severity, gating status, confidence score, and merge recommendation. The output is a single HTML file with no external dependencies.

## Configuration

Configuration is optional. If you do not provide a config file, patchy-pilot will use provider defaults and try to infer validation commands from `package.json` scripts.

If you want to override providers, thresholds, or validation commands, create a `patchy-pilot.json` (or `.patchy-pilot.json`, or `.patchy-pilot/config.json`) in your project root. See `patchy-pilot.example.json` for a full example.

`dangerouslySkipPermissions` is supported for the builder only. Reviewer and repairer configs reject it, and the learner never inherits dangerous permissions from the reviewer.

```json
{
  "builder": {
    "provider": "claude-code",
    "model": "sonnet",
    "dangerouslySkipPermissions": false
  },
  "reviewer": {
    "provider": "claude-code",
    "model": "sonnet"
  },
  "validation": {
    "formatter": { "command": "npx", "args": ["prettier", "--check", "."], "enabled": true },
    "linter": { "command": "npx", "args": ["eslint", "."], "enabled": true },
    "typecheck": { "command": "npx", "args": ["tsc", "--noEmit"], "enabled": true },
    "tests": { "command": "npm", "args": ["test"], "enabled": true }
  },
  "thresholds": {
    "max_critical": 0,
    "max_high": 2,
    "min_confidence": 0.6,
    "block_on": ["critical_issues"]
  },
  "review_rules": [
    "Check that all user inputs are validated",
    "Ensure error messages don't leak internal details"
  ],
  "base_branch": "main"
}
```

### Config fields

| Field | Description | Default |
|---|---|---|
| `builder.provider` | AI tool for building | `claude-code` |
| `builder.model` | Model override for builder | (provider default) |
| `builder.dangerouslySkipPermissions` | Skip provider permission prompts/sandbox when supported; use only in an external sandbox | `false` |
| `reviewer.provider` | AI tool for reviewing | `claude-code` |
| `reviewer.model` | Model override for reviewer | (provider default) |
| `repairer.provider` | AI tool for repair pass | `claude-code` |
| `repairer.enabled` | Auto-repair when review fails gating | `false` |
| `repairer.max_iterations` | Max repair/review loops before giving up | `3` |
| `validation.*` | Deterministic check commands | inferred from `package.json` when possible |
| `thresholds.max_critical` | Max critical issues before gating fails | `0` |
| `thresholds.max_high` | Max high-severity issues before gating fails | `2` |
| `thresholds.min_confidence` | Min reviewer confidence score | `0.6` |
| `thresholds.block_on` | Issue categories that block on any count | `["critical_issues"]` |
| `review_rules` | Extra rules included in the reviewer prompt | `[]` |
| `base_branch` | Branch to diff against | `main` |
| `artifacts_dir` | Where run artifacts are saved | `.patchy-pilot/runs` |

## Supported providers

| Provider | Command | Notes |
|---|---|---|
| `claude-code` | `claude --print` | Claude Code CLI; reviewer/learner run with tools disabled |
| `codex` | `codex exec` | OpenAI Codex CLI; reviewer/learner run in read-only sandbox |
| `opencode` | `opencode run` | OpenCode CLI; builder/repairer only because read-only review mode is not verified |
| `pi` | `pi -p` | Pi coding agent; builder/repairer only because read-only review mode is not verified |

Mix and match — use one provider for building and another for reviewing.

Dangerous permission bypass is builder-only and should be used only inside a disposable external sandbox with no secrets mounted.

During review, patchy-pilot also includes `package.json` scripts and detected CI workflow snippets in the reviewer prompt so the reviewer can compare the implementation against the checks your project appears to expect.

## Artifacts

Each run saves artifacts to `.patchy-pilot/runs/<timestamp>/`:

```
.patchy-pilot/runs/2026-03-16T14-30-00/
  spec.md              # Original specification
  builder-output.txt   # Builder's stdout/stderr
  validation.json      # Formatter/linter/typecheck/test results
  artifacts.json       # Collected context (diff, files, validation)
  review.json          # Structured review findings
  gating.json          # Pass/fail with reasons
  repair-output.txt    # Repair pass output (if triggered)
  result.json          # Final run summary with exit code
  report.html          # HTML report (generated via ppilot report)
```

Learned skills are written separately to:

```
.patchy-pilot/skills/
  README.md            # High-level index of generated skills
  manifest.json        # Machine-readable skill manifest
  <skill>.md           # One generated skill per file
```

### Review output shape

```json
{
  "critical_issues": [{ "description": "...", "severity": "critical", "file": "...", "suggestion": "..." }],
  "likely_bugs": [],
  "missing_tests": [],
  "spec_mismatches": [],
  "risky_changes": [],
  "hidden_assumptions": [],
  "confidence": 0.85,
  "merge_recommendation": "safe_to_merge",
  "short_summary": "..."
}
```

`merge_recommendation` is one of: `safe_to_merge`, `merge_with_minor_fixes`, `needs_changes`, `do_not_merge`.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Gating passed (or repair was applied) |
| `1` | Gating failed — review found blocking issues |
| `2` | Runtime error (config, provider failure, etc.) |

## Future improvements

- Claude Code hooks integration (trigger review on `PostToolUse` or session end)
- Watch mode for continuous review during development
- Review history and trend tracking
- Multi-file focus analysis (changed files + nearby impacted files)
- Parallel validation steps with streaming output
