import { spawn } from "node:child_process";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** True if the process was killed due to timeout. */
  timedOut?: boolean;
}

/**
 * Run a command and capture all output. Returns after the process exits.
 * If stdin is provided, it's written to the process stdin and the stream is closed.
 *
 * On timeout, sends SIGTERM then SIGKILL after a grace period to ensure
 * the process tree is fully cleaned up.
 */
export function exec(
  command: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
    timeout?: number;
    onData?: (chunk: string) => void;
  },
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const timeoutMs = options?.timeout ?? 600_000; // 10 min default

    const proc = spawn(command, args, {
      cwd: options?.cwd ?? process.cwd(),
      env: { ...process.env, ...options?.env },
      stdio: ["pipe", "pipe", "pipe"],
      // Don't use spawn's built-in timeout — it sends SIGTERM but doesn't
      // escalate to SIGKILL, so hung processes can ignore it.
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    // Set up our own timeout with proper kill escalation
    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      // Try graceful shutdown first
      proc.kill("SIGTERM");
      // If still alive after 5s, force kill
      killTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, 5_000);
    }, timeoutMs);

    proc.stdout.on("data", (chunk) => {
      stdout.push(chunk);
      options?.onData?.(chunk.toString());
    });
    proc.stderr.on("data", (chunk) => {
      stderr.push(chunk);
      options?.onData?.(chunk.toString());
    });

    if (options?.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    } else {
      proc.stdin.end();
    }

    proc.on("error", (err) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        stdout: Buffer.concat(stdout).toString(),
        stderr: Buffer.concat(stderr).toString(),
        exitCode: code ?? 1,
        timedOut,
      });
    });
  });
}
