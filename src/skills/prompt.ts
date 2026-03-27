/**
 * 业务职责：Skill prompt 模块负责读取模板文件并渲染最终任务文本，
 * 让技能配方始终通过同一套模板替换规则生成实际执行内容。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { JobError } from "../engine/error.js";

/**
 * 业务职责：读取单个 skill 的 `prompt.md` 模板，确保每个配方都能落到明确任务文本。
 */
export async function loadSkillPromptTemplate(directory: string): Promise<string> {
  const promptPath = path.join(directory, "prompt.md");
  return readFile(promptPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new JobError("SKILL_TEMPLATE_MISSING", `Skill prompt template is missing: ${path.basename(directory)}`, false);
    }

    throw error;
  });
}

/**
 * 业务职责：按占位符把 skill 输入渲染成最终任务文本，保证不同入口执行得到完全一致的 prompt。
 */
export function renderSkillPrompt(promptTemplate: string, values: Record<string, string>): string {
  // 业务约束：未提供的占位符按空串处理，避免技能渲染阶段抛错破坏批量执行流程。
  return promptTemplate.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}
