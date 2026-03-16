import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";

export class ArtifactStore {
  constructor(private dir: string) {}

  async init(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  async save(name: string, data: unknown): Promise<string> {
    const path = join(this.dir, name);
    const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
    await writeFile(path, content, "utf-8");
    return path;
  }

  async load<T>(name: string): Promise<T> {
    const path = join(this.dir, name);
    const content = await readFile(path, "utf-8");
    return JSON.parse(content) as T;
  }

  get path(): string {
    return this.dir;
  }
}

export function createRunId(): string {
  const now = new Date();
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
}
