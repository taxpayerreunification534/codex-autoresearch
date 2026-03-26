/**
 * 业务职责：Skill 输入模块负责补齐默认值、交互提问和必填校验，
 * 让技能配方的参数约束独立演进，而不是夹在 CLI 或 MCP 入口逻辑里。
 */
import { JobError } from "../engine/error.js";
import { ask } from "../engine/interactive.js";
import type { SkillDefinition } from "./catalog.js";

/**
 * 业务职责：根据 skill manifest 规则补齐实际输入值，减少用户每次重复手写固定参数。
 */
export async function resolveSkillInputs(
  definition: SkillDefinition,
  provided: Record<string, string>,
  interactive: boolean
): Promise<Record<string, string>> {
  const resolved = { ...provided };

  for (const [name, input] of Object.entries(definition.manifest.inputs)) {
    if (resolved[name]) {
      continue;
    }

    if (interactive) {
      resolved[name] = await ask(input.prompt ?? `请输入 ${name}`, input.default);
    } else if (input.default) {
      resolved[name] = input.default;
    } else if (input.required) {
      throw new JobError("SKILL_INPUT_MISSING", `Missing required skill input: ${name}`, false);
    }
  }

  return resolved;
}
