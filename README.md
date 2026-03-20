# patchy-pilot

Local AI workflow harness that automatically runs an independent review pass after an AI coding session finishes.

One AI builds. Another AI reviews. Deterministic checks run in between. Everything is saved to disk.

## How it works

```
spec → (optional plan) → builder AI → validation gate → reviewer AI → rebuild on failure (max 2 by default)
```

1. An optional **planner** AI analyzes the spec and proposes an implementation plan for user approval
2. A **builder** AI implements a feature from the spec (and plan, if provided)
3. **Deterministic validation** acts as a build gate (formatter, linter, typecheck, tests)
4. If the gate passes, **artifacts** are collected (git diff, changed files, test output)
5. A separate **reviewer** AI independently inspects the result
6. If the review is not approved, patchy-pilot bounces back to the builder with the gate/review feedback
7. The loop stops after the initial build plus up to 2 rebuilds by default

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

Full workflow: build → gate → review, with automatic rebuilds when gate or review fails.

```bash
# Inline spec
ppilot feature "Add a retry mechanism to the HTTP client with exponential backoff"

# Spec from file
ppilot feature @specs/retry-mechanism.md

# Skip the build step (review existing uncommitted changes)
ppilot feature --no-build "Add retry mechanism"

# From a GitHub issue (full URL or shorthand)
ppilot feature https://github.com/owner/repo/issues/42
ppilot feature owner/repo#42

# Run a planner step first — review and approve a plan before building
ppilot feature --plan "Add retry mechanism"

# Start in a fresh git worktree using an auto-generated name
ppilot feature --worktree "Add retry mechanism"

# Or choose the worktree and branch name yourself
ppilot feature --worktree retry-backoff "Add retry mechanism"

# Allow up to 4 rebuilds instead of the default 2
ppilot feature --max-rebuilds 4 "Add retry mechanism"

# Suppress real-time streamed output (streaming is on by default)
ppilot feature --silent "Add retry mechanism"

# Skip the auto-generated HTML report (report is created and opened by default)
ppilot feature --no-report "Add retry mechanism"

# Override providers
ppilot feature --builder claude-code --reviewer claude-code "Add retry mechanism"

# Override the planner provider/model
ppilot feature --plan --planner claude-code --planner-model opus "Add retry mechanism"
```

#### Plan mode

When `--plan` is passed, a planner agent reads the codebase and spec, then produces an implementation plan before building. You review the plan interactively:

- **Accept** (press Enter, `y`, or `accept`) — the plan is passed to the builder alongside the spec
- **Feedback** (type any text) — the planner revises the plan incorporating your feedback, then re-presents it
- **Quit** (`q` or `quit`) — aborts the run with exit code 2

For providers that support session continuation (currently `claude-code`), feedback rounds reuse the same session so the planner keeps its codebase context. Other providers fall back to a full re-prompt with the spec, previous plan, and feedback included.

Each plan iteration is saved as `plan-v1.md`, `plan-v2.md`, etc. in the run's artifact directory.

When `--worktree` is passed, patchy-pilot creates a sibling git worktree from the current `HEAD`, checks out a new branch with the same name, and runs the whole feature workflow there. If you omit the name, it uses `patchy-pilot-<timestamp>`. Because the worktree starts from committed state, your current working tree must be clean.

### `ppilot review <spec>`

Review-only: run validation and AI review on existing changes without building first.

```bash
ppilot review "The changes should implement a retry mechanism with exponential backoff"
ppilot review @specs/retry-mechanism.md
ppilot review --silent "Add retry mechanism"

# Skip the auto-generated HTML report
ppilot review --no-report "Add retry mechanism"

# From a GitHub issue
ppilot review https://github.com/owner/repo/issues/42
ppilot review owner/repo#42
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

### `ppilot prod <spec>`

Generate a polished PRD (Product Requirements Document) from a rough idea, brief, or GitHub issue.

```bash
# From inline text
ppilot prod "Add a notification system for order status updates"

# From a file
ppilot prod @ideas/notifications.md

# From a GitHub issue
ppilot prod https://github.com/owner/repo/issues/42

# Write the PRD to a file
ppilot prod "Add notifications" --output specs/notifications-prd.md

# Suppress streaming output (only print final result)
ppilot prod --silent "Add notifications"
```

The command reuses the `planner` provider configuration. Override with `--planner` and `--planner-model`.

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

## Spec sources

The `<spec>` argument accepts three formats:

| Format | Example | Description |
| --- | --- | --- |
| Inline text | `"Add retry with backoff"` | Used as-is |
| File reference | `@specs/retry.md` | Reads the file contents |
| GitHub issue URL | `https://github.com/owner/repo/issues/42` | Fetches the issue title and body via `gh` |
| GitHub issue shorthand | `owner/repo#42` | Same as above, shorter syntax |

### GitHub issues

When a spec looks like a GitHub issue reference, ppilot fetches the issue title and body using the GitHub CLI (`gh`) and uses the result as the specification for the run. This means you can point ppilot directly at a bug report or feature request and let it build, review, or rebuild from that.

**Requirements:** The [GitHub CLI](https://cli.github.com/) must be installed and authenticated (`gh auth login`). ppilot will exit with code 2 if the issue cannot be fetched.

```bash
# These are equivalent
ppilot feature https://github.com/acme/api/issues/99
ppilot feature acme/api#99

# Combine with any other flags
ppilot feature --plan --max-rebuilds 3 acme/api#99
ppilot review acme/api#99
```

## Configuration

Configuration is optional. If you do not provide a config file, patchy-pilot will use provider defaults and try to infer validation commands from `package.json` scripts.

If you want to override providers, thresholds, or validation commands, create a `patchy-pilot.json` (or `.patchy-pilot.json`, or `.patchy-pilot/config.json`) in your project root. See `patchy-pilot.example.json` for a full example.

`dangerouslySkipPermissions` is supported for the builder only. Reviewer configs reject it, and the learner never inherits dangerous permissions from the reviewer.

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
  "workflow": {
    "max_rebuilds": 2
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

| Field                                | Description                                                                              | Default                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------ |
| `planner.provider`                   | AI tool for plan mode                                                                    | `claude-code`                              |
| `planner.model`                      | Model override for planner                                                               | (provider default)                         |
| `builder.provider`                   | AI tool for building                                                                     | `claude-code`                              |
| `builder.model`                      | Model override for builder                                                               | (provider default)                         |
| `builder.dangerouslySkipPermissions` | Skip provider permission prompts/sandbox when supported; use only in an external sandbox | `false`                                    |
| `reviewer.provider`                  | AI tool for reviewing                                                                    | `claude-code`                              |
| `reviewer.model`                     | Model override for reviewer                                                              | (provider default)                         |
| `workflow.max_rebuilds`              | Max times `feature` bounces back to build after a failed gate or review                  | `2`                                        |
| `validation.*`                       | Deterministic check commands                                                             | inferred from `package.json` when possible |
| `thresholds.max_critical`            | Max critical issues before gating fails                                                  | `0`                                        |
| `thresholds.max_high`                | Max high-severity issues before gating fails                                             | `2`                                        |
| `thresholds.min_confidence`          | Min reviewer confidence score                                                            | `0.6`                                      |
| `thresholds.block_on`                | Issue categories that block on any count                                                 | `["critical_issues"]`                      |
| `review_rules`                       | Extra rules included in the reviewer prompt                                              | `[]`                                       |
| `base_branch`                        | Branch to diff against                                                                   | `main`                                     |
| `artifacts_dir`                      | Where run artifacts are saved                                                            | `.patchy-pilot/runs`                       |

## Supported providers

| Provider      | Command        | Notes                                                                                |
| ------------- | -------------- | ------------------------------------------------------------------------------------ |
| `claude-code` | `claude`       | Claude Code CLI; reviewer/learner run with tools disabled                            |
| `codex`       | `codex exec`   | OpenAI Codex CLI; reviewer/learner run in read-only sandbox                          |
| `opencode`    | `opencode run` | OpenCode CLI; builder only because read-only review mode is not verified             |
| `pi`          | `pi -p`        | Pi coding agent; builder only because read-only review mode is not verified          |

Mix and match — use one provider for building and another for reviewing.

Dangerous permission bypass is builder-only and should be used only inside a disposable external sandbox with no secrets mounted.

During review, patchy-pilot also includes `package.json` scripts and detected CI workflow snippets in the reviewer prompt so the reviewer can compare the implementation against the checks your project appears to expect.

## Artifacts

Each run saves artifacts to `.patchy-pilot/runs/<timestamp>/`:

```
.patchy-pilot/runs/2026-03-16T14-30-00/
  spec.md              # Original specification
  plan-v1.md           # Implementation plan (if --plan was used)
  builder-output.txt   # Builder's stdout/stderr
  builder-output-attempt-1.txt
  validation.json      # Formatter/linter/typecheck/test results
  validation-attempt-1.json
  artifacts.json       # Collected context (diff, files, validation)
  artifacts-attempt-1.json
  review.json          # Structured review findings
  gating.json          # Pass/fail with reasons
  review-attempt-1.json
  gating-attempt-1.json
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
  "critical_issues": [
    { "description": "...", "severity": "critical", "file": "...", "suggestion": "..." }
  ],
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

| Code | Meaning                                        |
| ---- | ---------------------------------------------- |
| `0`  | Validation gate passed and the review was approved |
| `1`  | The validation gate failed or the review was not approved |
| `2`  | Runtime error (config, provider failure, etc.) |
