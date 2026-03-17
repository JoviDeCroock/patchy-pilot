import { createInterface } from "node:readline";
import type { Config } from "./schemas/config.js";
import { createProvider } from "./providers/index.js";
import { plannerPrompt, plannerFeedbackPrompt } from "./prompts/planner.js";
import type { ArtifactStore } from "./utils/artifacts.js";
import { log } from "./utils/logger.js";

export interface PlanResult {
  plan: string;
  iterations: number;
}

const MAX_ITERATIONS = 10;

export async function runPlanner(opts: {
  spec: string;
  config: Config;
  cwd: string;
  store: ArtifactStore;
  onData?: (text: string) => void;
}): Promise<PlanResult | null> {
  const provider = createProvider(opts.config.planner.provider, {
    model: opts.config.planner.model,
    role: "planner",
  });

  log.step("Starting planner");

  // First iteration: full prompt with spec
  const initialResult = await provider.run(plannerPrompt(opts.spec), {
    cwd: opts.cwd,
    onData: opts.onData,
  });
  if (initialResult.exitCode !== 0) {
    throw new Error(`Planner exited with code ${initialResult.exitCode}`);
  }

  let currentPlan = initialResult.output;
  let iteration = 1;
  await opts.store.save(`plan-v${iteration}.md`, currentPlan);

  log.divider();
  log.step(`Implementation Plan (v${iteration})`);
  console.log(currentPlan);
  log.divider();

  while (iteration < MAX_ITERATIONS) {
    const response = await askUser("Accept plan? [Y/feedback/quit]: ");
    const trimmed = response.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "" || lower === "y" || lower === "yes" || lower === "accept") {
      log.success("Plan accepted");
      return { plan: currentPlan, iterations: iteration };
    }

    if (lower === "q" || lower === "quit" || lower === "exit") {
      return null;
    }

    // Feedback: revise the plan
    iteration++;
    log.step("Revising plan with feedback");

    let result;
    if (provider.supportsContinue) {
      // Continue the existing session — LLM keeps its codebase context
      const feedbackMessage =
        `The user has reviewed your plan and provided this feedback:\n\n${trimmed}\n\n` +
        `Please revise the implementation plan to address the feedback. ` +
        `Keep the same markdown structure (Summary, Files to modify, Files to create, Approach, Testing strategy, Edge cases, Open questions). ` +
        `Only change what the feedback asks for — preserve parts of the plan that are still valid.`;

      result = await provider.run(feedbackMessage, {
        cwd: opts.cwd,
        continue: true,
      });
    } else {
      // Provider doesn't support session continuation — send full context
      result = await provider.run(plannerFeedbackPrompt(opts.spec, currentPlan, trimmed), {
        cwd: opts.cwd,
        onData: opts.onData,
      });
    }

    if (result.exitCode !== 0) {
      throw new Error(`Planner exited with code ${result.exitCode}`);
    }

    currentPlan = result.output;
    await opts.store.save(`plan-v${iteration}.md`, currentPlan);

    log.divider();
    log.step(`Revised Plan (v${iteration})`);
    console.log(currentPlan);
    log.divider();
  }

  log.warn("Maximum plan iterations reached");
  return null;
}

function askUser(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
