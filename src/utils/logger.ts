const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
} as const;

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export const log = {
  info(msg: string) {
    console.log(`${COLORS.gray}[${timestamp()}]${COLORS.reset} ${msg}`);
  },
  step(msg: string) {
    console.log(
      `${COLORS.cyan}${COLORS.bold}▶${COLORS.reset} ${COLORS.cyan}${msg}${COLORS.reset}`
    );
  },
  success(msg: string) {
    console.log(`${COLORS.green}✓${COLORS.reset} ${msg}`);
  },
  warn(msg: string) {
    console.log(`${COLORS.yellow}⚠${COLORS.reset} ${msg}`);
  },
  error(msg: string) {
    console.error(`${COLORS.red}✗${COLORS.reset} ${msg}`);
  },
  detail(msg: string) {
    console.log(`  ${COLORS.dim}${msg}${COLORS.reset}`);
  },
  /** Write raw streaming output without adding newlines. Dimmed to distinguish from structured logs. */
  stream(chunk: string) {
    process.stderr.write(`${COLORS.dim}${chunk}${COLORS.reset}`);
  },
  divider() {
    console.log(`${COLORS.dim}${"─".repeat(60)}${COLORS.reset}`);
  },
};
