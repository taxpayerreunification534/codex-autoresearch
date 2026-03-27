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

/**
 * 业务职责：单个 skill 输入字段 schema 约束技能配方如何声明业务输入，
 * 让默认值、必填性和交互提示在不同入口下都保持一致语义。
 */
export const SkillInputSchema = z.object({
  description: z.string().min(1),
  required: z.boolean().optional().default(true),
  default: z.string().optional(),
  prompt: z.string().optional()
});

/**
 * 业务职责：skill manifest schema 定义仓库技能配方的正式公开格式，
 * 让 CLI、MCP 和开源扩展者都基于同一份契约增删技能。
 */
export const SkillManifestSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputs: z.record(z.string(), SkillInputSchema).default({}),
  defaultWorkdir: z.string().optional(),
  defaultModel: z.string().optional(),
  outputContract: z.string().min(1)
});

/**
 * 业务职责：skill manifest 类型把 schema 约束落到 TypeScript 世界，
 * 让 catalog、inputs 和 application 层都共享同一份强类型配方定义。
 */
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
