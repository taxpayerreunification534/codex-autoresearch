/**
 * 业务职责：应用层用例模块把 direct task、skill、resume、状态查询和聊天路由统一成稳定业务入口，
 * 让 CLI、MCP 和兼容层只负责解析与展示，而不再直接编排底层引擎细节。
 */
import path from "node:path";
import { getSessionStatus, resumeSession, runTask } from "../engine/job.js";
import { routeChatIntentWithPolicies } from "../routing/chat-intent.js";
import { listSkills, loadSkill, renderSkillPrompt, resolveSkillInputs, toPublicSkillDefinition } from "../skills/skill.js";
import type {
  ChatIntentRouteResult,
  GetTaskStatusCommand,
  PublicSkillDefinition,
  ResumeTaskCommand,
  RouteChatIntentCommand,
  RunDirectTaskCommand,
  RunSkillCommand
} from "./types.js";
import { toRunTaskOptions } from "./types.js";

/**
 * 业务职责：统一承接“执行一条明确任务”的业务入口，让所有 transport 都共享同一套 direct task 行为。
 */
export async function runDirectTask(command: RunDirectTaskCommand): Promise<Awaited<ReturnType<typeof runTask>>> {
  return runTask(toRunTaskOptions(command));
}

/**
 * 业务职责：统一承接“按 skill 配方执行任务”的业务入口，确保 skill 加载、补参与模板渲染只维护一份流程。
 */
export async function runSkillTask(command: RunSkillCommand): Promise<Awaited<ReturnType<typeof runTask>>> {
  const definition = await loadSkill(command.skillName, path.resolve(command.skillsRoot ?? "skills"));
  const values = await resolveSkillInputs(definition, command.inputs ?? {}, command.interactive ?? false);
  return runDirectTask({
    ...command,
    task: renderSkillPrompt(definition.promptTemplate, values),
    workdir: command.workdir ?? definition.manifest.defaultWorkdir,
    model: command.model ?? definition.manifest.defaultModel
  });
}

/**
 * 业务职责：统一承接“继续已有任务”的业务入口，让 session 定位、最近任务恢复和 transport 输出完全解耦。
 */
export async function resumeExistingTask(command: ResumeTaskCommand): Promise<Awaited<ReturnType<typeof resumeSession>>> {
  return resumeSession({
    sessionId: command.sessionId,
    jobId: command.jobId,
    useLast: command.useLast,
    stateDir: command.stateDir,
    codexBin: command.codexBin,
    intervalSeconds: command.intervalSeconds,
    maxAttempts: command.maxAttempts
  });
}

/**
 * 业务职责：统一承接“读取任务状态”的业务入口，避免 CLI 和 MCP 分别维护 status 的查找规则。
 */
export async function getTaskStatus(command: GetTaskStatusCommand): Promise<Awaited<ReturnType<typeof getSessionStatus>>> {
  return getSessionStatus({
    sessionId: command.sessionId,
    jobId: command.jobId,
    useLast: command.useLast,
    stateDir: command.stateDir
  });
}

/**
 * 业务职责：统一对外暴露仓库内可用 skill 清单，供 CLI 列表页和 MCP `list_skills` 共享同一份公开元数据。
 */
export async function listAvailableSkills(skillsRoot = path.resolve("skills")): Promise<PublicSkillDefinition[]> {
  const definitions = await listSkills(path.resolve(skillsRoot));
  return definitions.map((definition) => toPublicSkillDefinition(definition));
}

/**
 * 业务职责：统一承接聊天意图路由，让“继续旧任务还是创建新任务”的决策从 transport 层下沉到业务层。
 */
export async function routeChatIntent(command: RouteChatIntentCommand): Promise<ChatIntentRouteResult> {
  return routeChatIntentWithPolicies(command);
}
