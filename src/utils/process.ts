import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a command and capture all output. Returns after the process exits.
 * If stdin is provided, it's written to the process stdin and the stream is closed.
 */
export function exec(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
    timeout?: number;
  }
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: options?.timeout ?? 600_000, // 10 min default
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    proc.stdout.on("data", (chunk) => stdout.push(chunk));
    proc.stderr.on("data", (chunk) => stderr.push(chunk));

    if (options?.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("error", reject);
    proc.on("close", (code) => {
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: code ?? 1,
      });
    });
  });
}
