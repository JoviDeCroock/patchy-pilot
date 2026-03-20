export interface LearnRunSummary {
  run_id: string;
  completed_at?: string;
  exit_code?: number;
  rebuilds_used: number;
  spec_preview?: string;
  builder_summary?: string;
  validation: Record<string, string>;
  review?: {
    merge_recommendation: string;
    confidence: number;
    short_summary: string;
    critical_issues: string[];
    likely_bugs: string[];
    missing_tests: string[];
    spec_mismatches: string[];
    risky_changes: string[];
    hidden_assumptions: string[];
  };
  gating?: {
    passed: boolean;
    reasons: string[];
  };
}

export function learnPrompt(runs: LearnRunSummary[]): string {
  return `You are improving future patchy-pilot runs by writing reusable skills.

Study the past runs and identify only the highest-signal lessons that would materially improve future AI build/review passes.

Focus on:
- non-obvious repo or workflow expectations
- recurring mistakes or blind spots
- repeated missing tests or validation gaps
- assumptions that should be codified into a reusable skill

Do not create generic skills unless the runs clearly justify them. Prefer fewer, sharper skills over a long list of obvious advice.

## Past Runs

\`\`\`json
${JSON.stringify(runs, null, 2)}
\`\`\`

## What makes a good skill

- specific enough that another LLM can follow it without guessing
- grounded in evidence from one or more runs
- reusable across future tasks in this repo or workflow
- focused on what to inspect, what to avoid, and how to validate the result

## Required Output Format

Respond with ONLY a JSON object matching this exact schema:

\`\`\`json
{
  "overview": "Short paragraph about the main patterns across the runs.",
  "skills": [
    {
      "slug": "kebab-case-skill-name",
      "title": "Human readable skill title",
      "summary": "One sentence summary of the lesson.",
      "when_to_use": "When this skill should be applied.",
      "why_it_matters": "Why this lesson matters for future runs.",
      "instructions": [
        "Concrete imperative instruction 1",
        "Concrete imperative instruction 2"
      ],
      "source_runs": ["2026-03-16T14-30-00"],
      "evidence": [
        "Concrete evidence drawn from the run data"
      ]
    }
  ]
}
\`\`\`

Rules:
- Create 0 to 6 skills.
- Each slug must be concise kebab-case.
- Each instruction must be specific and actionable.
- Every skill must cite at least one run id from the provided data.
- Evidence must reference concrete failures, reviewer findings, or non-obvious expectations from the runs.
- If the runs do not justify a skill, return an empty skills array.`;
}
