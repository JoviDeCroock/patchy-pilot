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

/** Lines of context around each changed hunk when building scoped file contents. */
const HUNK_CONTEXT_LINES = 10;

/** Max size for a single file's content in chars. */
const MAX_FILE_SIZE = 20_000;

/** Max size for the combined diff in chars. */
const MAX_DIFF_SIZE = 50_000;

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
  const newFilesSet = new Set(newFiles);

  // Parse diff to find changed line ranges per file
  const changedRanges = parseDiffRanges(diff);

  log.detail(`Found ${files.length} changed files`);

  // Read contents of changed files, skipping binary and secret files
  const fileContents: Record<string, string> = {};
  let skippedBinary = 0;
  let skippedSecret = 0;
  let scopedFiles = 0;

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

      // For new (untracked) files or small files, include the full content.
      // For modified files with known changed ranges, include only the
      // changed hunks with surrounding context to save tokens.
      const ranges = changedRanges.get(file);
      if (!newFilesSet.has(file) && ranges && ranges.length > 0 && content.length > MAX_FILE_SIZE) {
        fileContents[file] = extractScopedContent(content, ranges, HUNK_CONTEXT_LINES);
        scopedFiles++;
      } else {
        fileContents[file] =
          content.length > MAX_FILE_SIZE ? content.slice(0, MAX_FILE_SIZE) + "\n... [truncated]" : content;
      }
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
  if (scopedFiles > 0) {
    log.detail(`Scoped ${scopedFiles} large file(s) to changed hunks only`);
  }

  const diffWithUntracked =
    newFiles.length > 0
      ? `${diff}\n\n# Untracked files\n${newFiles.map((file) => `- ${file}`).join("\n")}`
      : diff;

  return {
    spec,
    git_diff:
      diffWithUntracked.length > MAX_DIFF_SIZE
        ? diffWithUntracked.slice(0, MAX_DIFF_SIZE) + "\n... [truncated]"
        : diffWithUntracked,
    changed_files: files,
    file_contents: fileContents,
    validation,
    builder_summary: builderSummary,
    project_context: projectContext,
  };
}

/** A line range in the post-image of a diff hunk (1-indexed, inclusive). */
interface LineRange {
  start: number;
  end: number;
}

/**
 * Parse a unified diff to extract changed line ranges per file.
 * Returns a map of file path → array of changed line ranges (post-image, 1-indexed).
 */
export function parseDiffRanges(diff: string): Map<string, LineRange[]> {
  const result = new Map<string, LineRange[]>();
  let currentFile: string | undefined;

  for (const line of diff.split("\n")) {
    // Match the +++ line to get the file path (skip /dev/null for deleted files)
    if (line.startsWith("+++ b/")) {
      currentFile = line.slice(6);
      if (!result.has(currentFile)) {
        result.set(currentFile, []);
      }
      continue;
    }

    // Match hunk headers: @@ -oldStart,oldCount +newStart,newCount @@
    if (line.startsWith("@@") && currentFile) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const start = parseInt(match[1], 10);
        const count = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        if (count > 0) {
          result.get(currentFile)!.push({
            start,
            end: start + count - 1,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Extract only the changed regions of a file with surrounding context.
 * Merges overlapping regions and adds line numbers for reviewer orientation.
 */
export function extractScopedContent(
  content: string,
  ranges: LineRange[],
  contextLines: number,
): string {
  const lines = content.split("\n");
  const totalLines = lines.length;

  // Expand ranges with context and merge overlapping ones
  const expanded = mergeRanges(
    ranges.map((r) => ({
      start: Math.max(1, r.start - contextLines),
      end: Math.min(totalLines, r.end + contextLines),
    })),
  );

  const sections: string[] = [];
  for (const range of expanded) {
    const sectionLines: string[] = [];
    for (let i = range.start; i <= range.end && i <= totalLines; i++) {
      sectionLines.push(`${i}: ${lines[i - 1]}`);
    }
    sections.push(sectionLines.join("\n"));
  }

  const header = `[scoped to ${expanded.length} changed region(s), ${totalLines} total lines]`;
  return `${header}\n\n${sections.join("\n\n...\n\n")}`;
}

/** Merge overlapping or adjacent line ranges. Input must be non-empty. */
function mergeRanges(ranges: LineRange[]): LineRange[] {
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: LineRange[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];
    if (current.start <= last.end + 1) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push(current);
    }
  }

  return merged;
}
