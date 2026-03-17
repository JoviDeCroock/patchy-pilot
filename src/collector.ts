import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { Config } from "./schemas/config.js";
import type { Artifacts, ValidationResult } from "./schemas/review.js";
import { collectProjectContext } from "./project-context.js";
import { changedFiles, gitDiff, untrackedFiles } from "./utils/git.js";
import { log } from "./utils/logger.js";

/** File extensions that are almost certainly binary and should be skipped. */
const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".ico",
  ".webp",
  ".avif",
  ".svg",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".avi",
  ".mov",
  ".zip",
  ".tar",
  ".gz",
  ".bz2",
  ".xz",
  ".7z",
  ".rar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".bin",
  ".pyc",
  ".pyo",
  ".class",
  ".o",
  ".obj",
  ".sqlite",
  ".db",
  ".lock",
]);

/** File names/patterns that likely contain secrets. */
const SECRET_PATTERNS = [
  /^\.env($|\.)/, // .env, .env.local, .env.production, etc.
  /^\.env\..+/,
  /^credentials\.json$/,
  /^service[-_]?account.*\.json$/,
  /^.*[-_]key\.pem$/,
  /^.*[-_]key\.json$/,
  /^id_rsa/,
  /^id_ed25519/,
  /^.*\.key$/,
  /^\.npmrc$/,
  /^\.pypirc$/,
  /^\.netrc$/,
  /^htpasswd$/,
  /^\.htpasswd$/,
];

function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(extname(filePath).toLowerCase());
}

function isSecretFile(filePath: string): boolean {
  const name = basename(filePath);
  return SECRET_PATTERNS.some((pattern) => pattern.test(name));
}

export async function collectArtifacts(
  spec: string,
  validation: ValidationResult,
  config: Config,
  cwd: string,
  builderSummary?: string,
): Promise<Artifacts> {
  log.step("Collecting artifacts");

  const diff = await gitDiff(config.base_branch, cwd);
  const trackedFiles = await changedFiles(config.base_branch, cwd);
  const newFiles = await untrackedFiles(cwd);
  const files = Array.from(new Set([...trackedFiles, ...newFiles])).sort();
  const projectContext = await collectProjectContext(cwd);

  log.detail(`Found ${files.length} changed files`);

  // Read contents of changed files, skipping binary and secret files
  const fileContents: Record<string, string> = {};
  let skippedBinary = 0;
  let skippedSecret = 0;

  for (const file of files) {
    if (isBinaryFile(file)) {
      fileContents[file] = "[binary file — skipped]";
      skippedBinary++;
      continue;
    }
    if (isSecretFile(file)) {
      fileContents[file] = "[potential secret file — skipped for safety]";
      skippedSecret++;
      log.warn(`Skipped secret file from artifacts: ${file}`);
      continue;
    }

    try {
      const content = await readFile(join(cwd, file), "utf-8");
      // Cap individual file size to avoid enormous prompts
      fileContents[file] =
        content.length > 20_000 ? content.slice(0, 20_000) + "\n... [truncated]" : content;
    } catch {
      fileContents[file] = "[could not read file]";
    }
  }

  if (skippedBinary > 0) {
    log.detail(`Skipped ${skippedBinary} binary file(s)`);
  }
  if (skippedSecret > 0) {
    log.detail(`Skipped ${skippedSecret} potential secret file(s)`);
  }

  const diffWithUntracked =
    newFiles.length > 0
      ? `${diff}\n\n# Untracked files\n${newFiles.map((file) => `- ${file}`).join("\n")}`
      : diff;

  return {
    spec,
    git_diff:
      diffWithUntracked.length > 50_000
        ? diffWithUntracked.slice(0, 50_000) + "\n... [truncated]"
        : diffWithUntracked,
    changed_files: files,
    file_contents: fileContents,
    validation,
    builder_summary: builderSummary,
    project_context: projectContext,
  };
}
