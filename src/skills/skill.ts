/**
 * 业务职责：Skill 聚合模块继续对外暴露稳定的技能接口，
 * 同时把内部职责拆到 manifest、catalog、inputs 和 prompt 子模块中，降低单文件耦合。
 */
export { loadSkill, listSkills, toPublicSkillDefinition, type SkillDefinition } from "./catalog.js";
export { resolveSkillInputs } from "./inputs.js";
export { SkillInputSchema, SkillManifestSchema, type SkillManifest } from "./manifest.js";
export { loadSkillPromptTemplate, renderSkillPrompt } from "./prompt.js";
