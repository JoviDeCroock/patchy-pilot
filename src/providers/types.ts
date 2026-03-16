export interface ProviderResponse {
  output: string;
  exitCode: number;
}

export interface ProviderOptions {
  model?: string;
  dangerouslySkipPermissions?: boolean;
}

export interface AIProvider {
  readonly name: string;

  /** Run the AI tool with a prompt. Returns the combined output. */
  run(prompt: string, options?: { cwd?: string; timeout?: number }): Promise<ProviderResponse>;
}
