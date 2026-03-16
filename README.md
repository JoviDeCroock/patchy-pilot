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

## Configuration

Configuration is optional. If you do not provide a config file, patchy-pilot will use provider defaults and try to infer validation commands from `package.json` scripts.

If you want to override providers, thresholds, or validation commands, create a `patchy-pilot.json` (or `.patchy-pilot.json`, or `.patchy-pilot/config.json`) in your project root. See `patchy-pilot.example.json` for a full example.

```json
{
  "builder": {
    "provider": "claude-code",
    "model": "sonnet"
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
| `reviewer.provider` | AI tool for reviewing | `claude-code` |
| `reviewer.model` | Model override for reviewer | (provider default) |
| `repairer.provider` | AI tool for repair pass | `claude-code` |
| `repairer.enabled` | Auto-repair when review fails gating | `false` |
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
| `claude-code` | `claude --print` | Claude Code CLI |
| `codex` | `codex --quiet` | OpenAI Codex CLI |
| `opencode` | `opencode -m` | OpenCode CLI |

Mix and match — use one provider for building and another for reviewing.

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

## Architecture

```
src/
  cli.ts              CLI entrypoint (commander)
  config.ts           Config loading
  runner.ts           Main orchestrator
  validator.ts        Deterministic checks
  collector.ts        Artifact collection (git diff, file contents)
  reviewer.ts         AI reviewer with JSON extraction
  repairer.ts         AI repair pass
  gating.ts           Threshold-based pass/fail
  providers/
    types.ts          Provider interface
    claude-code.ts    Claude Code provider
    codex.ts          Codex provider
    opencode.ts       OpenCode provider
    index.ts          Provider factory
  prompts/
    builder.ts        Builder prompt template
    reviewer.ts       Reviewer prompt template
    repairer.ts       Repairer prompt template
  schemas/
    review.ts         Zod schemas for review output, validation, artifacts
    config.ts         Zod schema for config
  utils/
    logger.ts         Colored terminal output
    process.ts        Child process execution
    git.ts            Git diff/changed files
    artifacts.ts      Artifact storage
```

## Future improvements

- Claude Code hooks integration (trigger review on `PostToolUse` or session end)
- Watch mode for continuous review during development
- HTML report generation
- Review history and trend tracking
- Multi-file focus analysis (changed files + nearby impacted files)
- Custom provider plugins via config
- Parallel validation steps with streaming output
