/**
 * 业务职责：应用层类型模块定义统一的命令输入、业务结果和对外可展示字段，
 * 让 CLI、MCP 和兼容入口都围绕同一套语义边界协作，而不是各自拼装零散参数。
 *
 * 为什么这一层很重要：
 * - 没有统一类型时，CLI、MCP、legacy 会各自长出一套“差不多但不完全一样”的参数结构。
 * - 统一类型能把“业务命令是什么”和“传输层长什么样”分开，后面新增 HTTP/TUI 入口也更容易。
 */
import type { JobRunResult, ResumeSessionOptions, RunTaskOptions } from "../engine/job.js";

/**
 * 业务职责：统一描述所有应用层命令可继承的运行上下文，
 * 让不同入口都围绕同一组工作目录、状态目录、模型和安全开关传参。
 *
 * 解决的问题：
 * - 以前这些字段容易散落在 CLI 选项、MCP schema 和 legacy 环境变量里各写一份。
 * - 统一后，调用方只需要知道“我要执行什么”，上下文配置有固定容器承接。
 */
export interface CommandExecutionContext {
  workdir?: string;
  stateDir?: string;
  model?: string;
  profile?: string;
  codexBin?: string;
  intervalSeconds?: number;
  fullAuto?: boolean;
  dangerouslyBypass?: boolean;
  skipGitRepoCheck?: boolean;
  startWithResumeIfPossible?: boolean;
  maxAttempts?: number;
}

/**
 * 业务职责：直接任务命令描述“已经有明确任务文本”的执行请求，
 * 供 CLI 顶层任务入口、`run` 子命令和兼容层共用同一套业务输入。
 *
 * 示例：
 * - `codex-autoresearch "修这个 bug"`
 * - `codex-autoresearch run "补 README"`
 */
export interface RunDirectTaskCommand extends CommandExecutionContext {
  task: string;
  exactStateDir?: string;
  jobId?: string;
  confirmText?: string;
  resumeTextBase?: string;
}

/**
 * 业务职责：Skill 命令描述“按仓库任务配方执行”的请求，
 * 让 skill 名称、用户输入和交互补参策略能够独立于 CLI/MCP 传输层表达。
 *
 * 示例：
 * - CLI：`codex-autoresearch skill run research --set topic=...`
 * - MCP：`run_skill` tool 传入 `skillName + inputs`
 */
export interface RunSkillCommand extends CommandExecutionContext {
  skillName: string;
  inputs?: Record<string, string>;
  interactive?: boolean;
  skillsRoot?: string;
}

/**
 * 业务职责：恢复任务命令统一描述 session id、job id 和最近任务恢复等定位方式，
 * 保证 resume 相关入口不再各自定义一套恢复参数。
 *
 * 为什么要单独抽出：
 * - resume 的业务重点不是“执行什么任务”，而是“附着到哪条已有状态链”。
 * - 这类参数和 direct task 完全不同，混在一起会让上层接口越来越难理解。
 */
export interface ResumeTaskCommand extends Pick<ResumeSessionOptions, "sessionId" | "jobId" | "useLast" | "stateDir" | "codexBin" | "intervalSeconds" | "maxAttempts"> {}

/**
 * 业务职责：状态查询命令描述“只查状态、不推进执行”的查询请求，
 * 让 CLI 和 MCP 都能围绕统一的任务定位语义读取现状。
 */
export interface GetTaskStatusCommand {
  sessionId?: string;
  jobId?: string;
  useLast?: boolean;
  stateDir?: string;
}

/**
 * 业务职责：聊天路由命令描述“从当前聊天意图推导执行动作”的输入，
 * 让插件、MCP 和未来聊天入口统一复用同一份意图摘要结构。
 *
 * 示例：
 * - `chatIntent`: “用 codex-autoresearch 继续做我们当前聊天里还没完成的事情。”
 * - `chatSummary`: “继续完善 README 和 MCP 路由测试”
 */
export interface RouteChatIntentCommand extends CommandExecutionContext {
  chatIntent: string;
  chatSummary?: string;
}

/**
 * 业务职责：公开 skill 定义描述对外可见的技能元数据，
 * 供 CLI 列表页和 MCP `list_skills` 在不暴露内部实现细节的前提下稳定输出。
 */
export interface PublicSkillDefinition {
  name: string;
  description: string;
  inputs: Record<string, { description: string; required?: boolean; default?: string; prompt?: string }>;
  defaultWorkdir?: string;
  defaultModel?: string;
  outputContract: string;
}

/**
 * 业务职责：聊天路由冲突结果描述“不能静默执行、必须先确认”的场景，
 * 让插件和 MCP 客户端可以稳定识别确认态而不是把它误判为失败或成功。
 */
export interface ChatIntentConflictResult {
  action: "conflict";
  reason: string;
  chatIntent: string;
  chatSummary: string;
  stateDir?: string;
  status: "needs_confirmation";
}

/**
 * 业务职责：聊天路由执行结果描述“已经决定继续或新建”的成功路径，
 * 在普通任务结果上补充路由原因和匹配状态，方便上层解释为什么这样执行。
 */
export interface ChatIntentExecutionResult extends JobRunResult {
  action: "run_task" | "resume_session";
  reason: string;
  chatIntent: string;
  chatSummary: string;
  latestTaskMatched: boolean;
}

/**
 * 业务职责：聊天路由总结果把确认态与执行态统一进一个联合类型，
 * 让 transport 层只判断路由结果，不必感知内部决策细节。
 */
export type ChatIntentRouteResult = ChatIntentExecutionResult | ChatIntentConflictResult;

/**
 * 业务职责：应用层总结果类型为 presenter 和测试提供统一输入范围，
 * 避免不同传输层再各自维护零散的返回对象集合。
 */
export type ApplicationResult = JobRunResult | ChatIntentRouteResult | PublicSkillDefinition[];

/**
 * 业务职责：把 direct task 命令映射到底层执行引擎需要的运行参数，供应用层用例统一转发。
 *
 * 为什么不让上层直接构造 `RunTaskOptions`：
 * - 应用层需要屏蔽 engine 的内部细节，让 transport 只面对业务命令模型。
 * - 这样以后 engine 参数再扩展时，影响点只集中在映射函数。
 */
export function toRunTaskOptions(command: RunDirectTaskCommand): RunTaskOptions {
  return {
    task: command.task,
    workdir: command.workdir,
    stateDir: command.stateDir,
    exactStateDir: command.exactStateDir,
    jobId: command.jobId,
    model: command.model,
    profile: command.profile,
    codexBin: command.codexBin,
    confirmText: command.confirmText,
    resumeTextBase: command.resumeTextBase,
    intervalSeconds: command.intervalSeconds,
    fullAuto: command.fullAuto,
    dangerouslyBypass: command.dangerouslyBypass,
    skipGitRepoCheck: command.skipGitRepoCheck,
    startWithResumeIfPossible: command.startWithResumeIfPossible,
    maxAttempts: command.maxAttempts
  };
}
