import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ConfigSchema, type Config } from "./schemas/config.js";

const CONFIG_FILES = ["patchy-pilot.json", ".patchy-pilot.json", ".patchy-pilot/config.json"];

export async function loadConfig(cwd: string = process.cwd()): Promise<Config> {
  for (const file of CONFIG_FILES) {
    try {
      const raw = await readFile(join(cwd, file), "utf-8");
      const parsed = JSON.parse(raw);
      return ConfigSchema.parse(parsed);
    } catch {
      // try next
    }
  }

  // Return defaults if no config found
  return ConfigSchema.parse({
    validation: {},
  });
}
