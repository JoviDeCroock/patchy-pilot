export interface ProviderResponse {
  output: string;
  exitCode: number;
}

export type ProviderRole = "builder" | "reviewer" | "repairer" | "learner" | "planner";

export interface ProviderOptions {
  model?: string;
  dangerouslySkipPermissions?: boolean;
  role?: ProviderRole;
}

export interface ProviderRunOptions {
  cwd?: string;
  timeout?: number;
  continue?: boolean;
  /** Called with each chunk of output as it arrives. */
  onData?: (chunk: string) => void;
}

export interface AIProvider {
  readonly name: string;

  /** Whether the provider supports continuing a previous session. */
  readonly supportsContinue: boolean;

  /** Run the AI tool with a prompt. Returns the combined output. */
  run(prompt: string, options?: ProviderRunOptions): Promise<ProviderResponse>;
}
