export interface ProviderResponse {
  output: string;
  exitCode: number;
}

export type ProviderRole = "builder" | "reviewer" | "repairer" | "learner";

export interface ProviderOptions {
  model?: string;
  dangerouslySkipPermissions?: boolean;
  role?: ProviderRole;
}

export interface AIProvider {
  readonly name: string;

  /** Run the AI tool with a prompt. Returns the combined output. */
  run(prompt: string, options?: { cwd?: string; timeout?: number }): Promise<ProviderResponse>;
}
