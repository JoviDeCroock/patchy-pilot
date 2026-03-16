export function buildPrompt(spec: string): string {
  return `You are implementing a feature. Follow the specification precisely.

## Specification

${spec}

## Instructions

1. Read the existing codebase to understand the structure, conventions, and patterns
2. Implement the feature as described in the specification
3. Write tests that cover the main behavior and edge cases
4. Ensure the code follows existing project conventions
5. Do not make changes beyond what the specification requires

When you are done, provide a brief summary of:
- What you implemented
- What files you changed or created
- What tests you wrote
- Any decisions you made that the specification left open
- Anything you were unsure about`;
}
