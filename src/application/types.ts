/**
 * 业务职责：应用层类型模块定义统一的命令输入、业务结果和对外可展示字段，
 * 让 CLI、MCP 和兼容入口都围绕同一套语义边界协作，而不是各自拼装零散参数。
 */
import type { JobRunResult, ResumeSessionOptions, RunTaskOptions } from "../engine/job.js";

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

export interface RunDirectTaskCommand extends CommandExecutionContext {
  task: string;
  exactStateDir?: string;
  jobId?: string;
  confirmText?: string;
  resumeTextBase?: string;
}

export interface RunSkillCommand extends CommandExecutionContext {
  skillName: string;
  inputs?: Record<string, string>;
  interactive?: boolean;
  skillsRoot?: string;
}

export interface ResumeTaskCommand extends Pick<ResumeSessionOptions, "sessionId" | "jobId" | "useLast" | "stateDir" | "codexBin" | "intervalSeconds" | "maxAttempts"> {}

export interface GetTaskStatusCommand {
  sessionId?: string;
  jobId?: string;
  useLast?: boolean;
  stateDir?: string;
}

export interface RouteChatIntentCommand extends CommandExecutionContext {
  chatIntent: string;
  chatSummary?: string;
}

export interface PublicSkillDefinition {
  name: string;
  description: string;
  inputs: Record<string, { description: string; required?: boolean; default?: string; prompt?: string }>;
  defaultWorkdir?: string;
  defaultModel?: string;
  outputContract: string;
}

export interface ChatIntentConflictResult {
  action: "conflict";
  reason: string;
  chatIntent: string;
  chatSummary: string;
  stateDir?: string;
  status: "needs_confirmation";
}

export interface ChatIntentExecutionResult extends JobRunResult {
  action: "run_task" | "resume_session";
  reason: string;
  chatIntent: string;
  chatSummary: string;
  latestTaskMatched: boolean;
}

export type ChatIntentRouteResult = ChatIntentExecutionResult | ChatIntentConflictResult;

export type ApplicationResult = JobRunResult | ChatIntentRouteResult | PublicSkillDefinition[];

/**
 * 业务职责：把 direct task 命令映射到底层执行引擎需要的运行参数，供应用层用例统一转发。
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
