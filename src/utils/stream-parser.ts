/**
 * Creates a line-buffering parser for JSONL streams.
 * Chunks from subprocess output may not align with line boundaries,
 * so this buffers partial lines and calls the handler for each complete line.
 */
export function createLineParser(
  onLine: (line: string) => void
): ((chunk: string) => void) & { flush(): void } {
  let buffer = "";

  const parser = (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split("\n");
    // Keep the last (possibly incomplete) segment in the buffer
    buffer = lines.pop()!;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  };

  parser.flush = () => {
    const trimmed = buffer.trim();
    if (trimmed) onLine(trimmed);
    buffer = "";
  };

  return parser;
}
