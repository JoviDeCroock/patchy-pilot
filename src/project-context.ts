import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Config, ValidationCommand } from "./schemas/config.js";

type ValidationKind = keyof Config["validation"];
type ValidationSource = "package.json" | "ci";

export interface InferredValidationHint extends ValidationCommand {
  source: ValidationSource;
  detail: string;
}

export interface ProjectContext {
  package_manager?: string;
  package_scripts: Record<string, string>;
  ci_files: Array<{
    path: string;
    excerpt: string;
  }>;
  inferred_validation: Partial<Record<ValidationKind, InferredValidationHint>>;
}

export async function inferValidationDefaults(cwd: string): Promise<Partial<Config["validation"]>> {
  const packageInfo = await loadPackageInfo(cwd);
  if (!packageInfo) {
    return {};
  }

  const hints = inferFromPackageScripts(packageInfo.scripts, packageInfo.packageManager);
  return stripHintMetadata(hints);
}

export async function collectProjectContext(cwd: string): Promise<ProjectContext> {
  const packageInfo = await loadPackageInfo(cwd);
  const ciFiles = await loadCiFiles(cwd);
  const inferredValidation = {
    ...(packageInfo
      ? inferFromPackageScripts(packageInfo.scripts, packageInfo.packageManager)
      : {}),
    ...inferFromCiFiles(ciFiles),
  };

  return {
    package_manager: packageInfo?.packageManager,
    package_scripts: packageInfo?.scripts ?? {},
    ci_files: ciFiles.map((file) => ({
      path: file.path,
      excerpt: truncate(file.content, 8_000),
    })),
    inferred_validation: inferredValidation,
  };
}

async function loadPackageInfo(cwd: string): Promise<{
  packageManager?: string;
  scripts: Record<string, string>;
} | null> {
  try {
    const raw = await readFile(join(cwd, "package.json"), "utf-8");
    const parsed = JSON.parse(raw) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };

    return {
      packageManager: await detectPackageManager(cwd, parsed.packageManager),
      scripts: parsed.scripts ?? {},
    };
  } catch {
    return null;
  }
}

async function detectPackageManager(
  cwd: string,
  declaredPackageManager?: string
): Promise<string | undefined> {
  if (declaredPackageManager) {
    return declaredPackageManager.split("@")[0];
  }

  const lockfiles: Array<[string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
    ["npm-shrinkwrap.json", "npm"],
  ];

  for (const [file, packageManager] of lockfiles) {
    try {
      await access(join(cwd, file));
      return packageManager;
    } catch {
      // try next
    }
  }

  return "npm";
}

function inferFromPackageScripts(
  scripts: Record<string, string>,
  packageManager = "npm"
): Partial<Record<ValidationKind, InferredValidationHint>> {
  const inferred: Partial<Record<ValidationKind, InferredValidationHint>> = {};

  for (const [kind, names] of Object.entries(PACKAGE_SCRIPT_CANDIDATES) as Array<
    [ValidationKind, string[]]
  >) {
    const match = names.find((name) => scripts[name]);
    if (!match) {
      continue;
    }

    inferred[kind] = {
      ...toPackageScriptCommand(packageManager, match),
      source: "package.json",
      detail: `Derived from package.json script \`${match}\``,
    };
  }

  return inferred;
}

async function loadCiFiles(cwd: string): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  const workflowDir = join(cwd, ".github", "workflows");

  try {
    const entries = await readdir(workflowDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !/\.ya?ml$/i.test(entry.name)) {
        continue;
      }

      const path = join(".github", "workflows", entry.name);
      files.push({
        path,
        content: await readFile(join(cwd, path), "utf-8"),
      });
    }
  } catch {
    // no GitHub workflow files
  }

  for (const relativePath of [".gitlab-ci.yml", ".circleci/config.yml"]) {
    try {
      files.push({
        path: relativePath,
        content: await readFile(join(cwd, relativePath), "utf-8"),
      });
    } catch {
      // file does not exist
    }
  }

  return files;
}

function inferFromCiFiles(
  ciFiles: Array<{ path: string; content: string }>
): Partial<Record<ValidationKind, InferredValidationHint>> {
  const inferred: Partial<Record<ValidationKind, InferredValidationHint>> = {};

  for (const file of ciFiles) {
    for (const command of extractCiRunCommands(file.content)) {
      const candidate = inferFromCommand(command);
      if (!candidate || inferred[candidate.kind]) {
        continue;
      }

      inferred[candidate.kind] = {
        command: candidate.command.command,
        args: candidate.command.args,
        enabled: true,
        selective: false,
        source: "ci",
        detail: `Derived from ${file.path}: \`${command}\``,
      };
    }
  }

  return inferred;
}

function extractCiRunCommands(content: string): string[] {
  const commands: string[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = line.match(/^(\s*)run:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const indent = match[1].length;
    const value = match[2].trim();
    if (value && !["|", ">", "|-", ">-"].includes(value)) {
      commands.push(value);
      continue;
    }

    const block: string[] = [];
    for (let blockIndex = index + 1; blockIndex < lines.length; blockIndex += 1) {
      const blockLine = lines[blockIndex];
      const blockIndent = blockLine.match(/^(\s*)/)?.[1].length ?? 0;
      if (blockLine.trim().length > 0 && blockIndent <= indent) {
        index = blockIndex - 1;
        break;
      }
      if (blockIndex === lines.length - 1) {
        index = blockIndex;
      }

      const trimmed = blockLine.trim();
      if (trimmed.length > 0) {
        block.push(trimmed);
      }
    }

    commands.push(...block);
  }

  return commands
    .flatMap((command) => command.split(/&&|\|\|/))
    .map((command) => command.replace(/^[-\s]+/, "").trim())
    .filter((command) => command.length > 0 && !command.startsWith("#"));
}

function inferFromCommand(command: string):
  | { kind: ValidationKind; command: ValidationCommand }
  | undefined {
  const normalized = command.trim();
  const packageScript = normalized.match(
    /^(npm|pnpm|yarn|bun)\s+(?:run\s+)?([A-Za-z0-9:_-]+|test)\b/
  );
  if (packageScript) {
    const packageManager = packageScript[1];
    const scriptName = packageScript[2];
    const kind = classifyScriptName(scriptName);
    if (kind) {
      return {
        kind,
        command: toPackageScriptCommand(packageManager, scriptName),
      };
    }
  }

  for (const [kind, patterns] of Object.entries(COMMAND_PATTERNS) as Array<
    [ValidationKind, RegExp[]]
  >) {
    if (patterns.some((pattern) => pattern.test(normalized))) {
      const [binary, ...args] = tokenizeCommand(normalized);
      if (!binary) {
        return undefined;
      }

      return {
        kind,
        command: {
          command: binary,
          args,
          enabled: true,
          selective: false,
        },
      };
    }
  }

  return undefined;
}

function classifyScriptName(scriptName: string): ValidationKind | undefined {
  for (const [kind, names] of Object.entries(PACKAGE_SCRIPT_CANDIDATES) as Array<
    [ValidationKind, string[]]
  >) {
    if (names.includes(scriptName)) {
      return kind;
    }
  }

  return undefined;
}

function toPackageScriptCommand(
  packageManager: string,
  scriptName: string
): ValidationCommand {
  if (packageManager === "npm" && scriptName === "test") {
    return { command: "npm", args: ["test"], enabled: true, selective: false };
  }

  return {
    command: packageManager,
    args: ["run", scriptName],
    enabled: true,
    selective: false,
  };
}

function stripHintMetadata(
  inferred: Partial<Record<ValidationKind, InferredValidationHint>>
): Partial<Config["validation"]> {
  const stripped: Partial<Config["validation"]> = {};

  for (const kind of Object.keys(inferred) as ValidationKind[]) {
    const hint = inferred[kind];
    if (!hint) {
      continue;
    }

    stripped[kind] = {
      command: hint.command,
      args: hint.args,
      enabled: hint.enabled,
      selective: hint.selective,
    };
  }

  return stripped;
}

function tokenizeCommand(command: string): string[] {
  const normalized = command
    .replace(/^\w+=\S+\s+/, "")
    .replace(/^['\"]|['\"]$/g, "")
    .trim();
  return normalized.split(/\s+/).filter(Boolean);
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n... [truncated]` : value;
}

const PACKAGE_SCRIPT_CANDIDATES: Record<ValidationKind, string[]> = {
  formatter: [
    "format:check",
    "fmt:check",
    "prettier:check",
    "check:format",
    "check-format",
  ],
  linter: ["lint", "lint:ci", "eslint", "check:lint"],
  typecheck: ["typecheck", "check-types", "typecheck:ci", "types", "tsc"],
  tests: ["test", "test:ci", "ci:test", "unit", "unit:test"],
};

const COMMAND_PATTERNS: Record<ValidationKind, RegExp[]> = {
  formatter: [
    /\bprettier\b.*\s--check\b/i,
    /\bbiome\b.*\bcheck\b/i,
    /\bgofmt\b/i,
    /\bblack\b.*\s--check\b/i,
  ],
  linter: [
    /\beslint\b/i,
    /\bbiome\b.*\blint\b/i,
    /\bruff\b\s+check\b/i,
    /\bgolangci-lint\b/i,
    /\bflake8\b/i,
  ],
  typecheck: [
    /\btsc\b.*\s--noEmit\b/i,
    /\bpyright\b/i,
    /\bmypy\b/i,
    /\bcargo\b\s+check\b/i,
  ],
  tests: [
    /\bvitest\b/i,
    /\bjest\b/i,
    /\bpytest\b/i,
    /\bgo\b\s+test\b/i,
    /\bcargo\b\s+test\b/i,
  ],
};
