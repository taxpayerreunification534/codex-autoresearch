/**
 * 业务职责：Skill catalog 模块负责枚举、加载和公开仓库内技能配方，
 * 让 CLI、MCP 和未来其它入口都围绕同一份技能目录和元数据工作。
 */
import { readdir } from "node:fs/promises";
import path from "node:path";
import type { PublicSkillDefinition } from "../application/types.js";
import { loadSkillManifest, type SkillManifest } from "./manifest.js";
import { loadSkillPromptTemplate } from "./prompt.js";

/**
 * 业务职责：完整 skill 定义把 manifest 与 prompt 模板绑在一起，
 * 作为技能系统内部的标准工作对象，供 application 层直接执行。
 */
export interface SkillDefinition {
  manifest: SkillManifest;
  promptTemplate: string;
  directory: string;
}

/**
 * 业务职责：读取单个 skill 目录的 manifest 与 prompt，产出应用层可直接执行的完整定义。
 */
export async function loadSkill(skillName: string, skillsRoot = path.resolve("skills")): Promise<SkillDefinition> {
  const directory = path.join(path.resolve(skillsRoot), skillName);
  const [manifest, promptTemplate] = await Promise.all([loadSkillManifest(directory), loadSkillPromptTemplate(directory)]);
  return { manifest, promptTemplate, directory };
}

/**
 * 业务职责：枚举仓库内全部技能目录，给 CLI 列表页和 MCP `list_skills` 提供统一的数据源。
 */
export async function listSkills(skillsRoot = path.resolve("skills")): Promise<SkillDefinition[]> {
  const root = path.resolve(skillsRoot);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const definitions = await Promise.all(
    entries.filter((entry) => entry.isDirectory()).map((entry) => loadSkill(entry.name, root).catch(() => undefined))
  );

  return definitions.filter((definition): definition is SkillDefinition => Boolean(definition));
}

/**
 * 业务职责：把完整 skill 定义裁剪成公开元数据，供列表展示和 MCP 响应返回稳定字段。
 */
export function toPublicSkillDefinition(definition: SkillDefinition): PublicSkillDefinition {
  return {
    name: definition.manifest.name,
    description: definition.manifest.description,
    inputs: definition.manifest.inputs,
    defaultWorkdir: definition.manifest.defaultWorkdir,
    defaultModel: definition.manifest.defaultModel,
    outputContract: definition.manifest.outputContract
  };
}
