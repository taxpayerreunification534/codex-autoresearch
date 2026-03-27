/**
 * 业务职责：仓库根导出统一暴露执行引擎、技能体系和 MCP 服务，
 * 方便 CLI、兼容层和外部集成复用同一批核心能力。
 *
 * 为什么保留这个聚合出口：
 * - 外部集成方不需要记住内部目录结构，只要从仓库根导入即可。
 * - 未来内部文件再拆分时，对外导入路径可以保持稳定，降低重构成本。
 */
export * from "./application/context.js";
export * from "./application/types.js";
export * from "./application/use-cases.js";
export * from "./engine/completion.js";
export * from "./engine/error.js";
export * from "./engine/job.js";
export * from "./engine/state.js";
export * from "./presenters/json.js";
export * from "./skills/skill.js";
export * from "./mcp/server.js";
