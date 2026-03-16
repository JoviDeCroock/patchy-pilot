import { z } from "zod";

export const LearnedSkillSchema = z.object({
  slug: z.string(),
  title: z.string(),
  summary: z.string(),
  when_to_use: z.string(),
  why_it_matters: z.string(),
  instructions: z.array(z.string()).min(1),
  source_runs: z.array(z.string()).min(1),
  evidence: z.array(z.string()).min(1),
});

export type LearnedSkill = z.infer<typeof LearnedSkillSchema>;

export const LearnOutputSchema = z.object({
  overview: z.string(),
  skills: z.array(LearnedSkillSchema),
});

export type LearnOutput = z.infer<typeof LearnOutputSchema>;
