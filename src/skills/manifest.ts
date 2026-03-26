/**
 * 业务职责：Skill manifest 模块负责定义和校验仓库技能配方的公开结构，
 * 让新增 skill 时的字段约束和兼容规则集中维护，而不是散落在加载流程里。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { JobError } from "../engine/error.js";

/**
 * 业务职责：技能 manifest 兼容版本号为未来扩展字段和兼容旧配方格式预留入口，
 * 当前对外协议不变，但内部可以据此演进加载逻辑。
 */
export const SKILL_MANIFEST_COMPAT_VERSION = 1;

export const SkillInputSchema = z.object({
  description: z.string().min(1),
  required: z.boolean().optional().default(true),
  default: z.string().optional(),
  prompt: z.string().optional()
});

export const SkillManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputs: z.record(z.string(), SkillInputSchema).default({}),
  defaultWorkdir: z.string().optional(),
  defaultModel: z.string().optional(),
  outputContract: z.string().min(1)
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

/**
 * 业务职责：从技能目录读取并校验 `skill.yaml`，确保 CLI 与 MCP 看到的是同一份合法契约。
 */
export async function loadSkillManifest(directory: string): Promise<SkillManifest> {
  const manifestPath = path.join(directory, "skill.yaml");
  const manifestContent = await readFile(manifestPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      throw new JobError("SKILL_NOT_FOUND", `Skill does not exist: ${path.basename(directory)}`, false);
    }

    throw error;
  });

  return SkillManifestSchema.parse(YAML.parse(manifestContent));
}
