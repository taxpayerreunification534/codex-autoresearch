/**
 * 业务职责：统一执行引擎负责承接 direct task、skill、兼容脚本和 MCP 请求，
 * 并确保它们都走同一套 session 续跑、完成协议和状态持久化流程。
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildCompletionProtocolText, createCompletionProtocol, isCompletionMessage } from "./completion.js";
import { discoverSessionId, runCodex } from "./codex.js";
import { JobError, toJobErrorInfo, type JobErrorInfo } from "./error.js";
import {
  clearJobError,
  ensureJobMetadata,
  findJobBySessionId,
  listJobs,
  readJobMetadata,
  readLastMessage,
  readLatestJobId,
  readSessionIdFile,
  recordJobFailure,
  recordSessionId,
  snapshotAttempt,
  type JobMetadata,
  type JobStatus,
  workdirExists,
  writeJobMetadata
} from "./state.js";

export interface RunTaskOptions {
  task: string;
  workdir?: string;
  stateDir?: string;
  exactStateDir?: string;
  jobId?: string;
  model?: string;
  profile?: string;
  codexBin?: string;
  confirmText?: string;
  resumeTextBase?: string;
  intervalSeconds?: number;
  fullAuto?: boolean;
  dangerouslyBypass?: boolean;
  skipGitRepoCheck?: boolean;
  startWithResumeIfPossible?: boolean;
  maxAttempts?: number;
}

export interface ResumeSessionOptions {
  sessionId?: string;
  jobId?: string;
  useLast?: boolean;
  stateDir?: string;
  codexBin?: string;
  intervalSeconds?: number;
  maxAttempts?: number;
}

export interface JobRunResult {
  jobId: string;
  sessionId?: string;
  stateDir: string;
  status: JobStatus;
  lastMessage: string;
  lastMessageFile: string;
  error?: JobErrorInfo;
}

const DEFAULT_CONFIRM_TEXT = "CONFIRMED: all tasks completed";
const DEFAULT_RESUME_TEXT =
  "You must respond to this message. Continue any unfinished user-requested work immediately from the current state. Do not restart. Do not summarize. Do not ask for confirmation. If all requested work is already complete, follow the completion protocol below.";

interface NormalizedRunOptions {
  task: string;
  workdir: string;
  stateDir?: string;
  exactStateDir?: string;
  jobId?: string;
  model?: string;
  profile?: string;
  codexBin: string;
  confirmText: string;
  resumeTextBase: string;
  intervalSeconds: number;
  fullAuto: boolean;
  dangerouslyBypass: boolean;
  skipGitRepoCheck: boolean;
  startWithResumeIfPossible: boolean;
  maxAttempts?: number;
}

/**
 * 业务职责：构建首轮真实任务文本，把用户目标和统一完成协议拼成执行引擎的标准输入。
 */
export function buildInitialPrompt(task: string, confirmText: string, rawNonce?: string): { prompt: string; protocol: ReturnType<typeof createCompletionProtocol> } {
  const protocol = createCompletionProtocol(confirmText, rawNonce);
  return {
    protocol,
    prompt: `${task}\n\n${buildCompletionProtocolText(protocol)}\n`
  };
}

/**
 * 业务职责：构建续跑提示，只提醒 Codex 继续推进当前任务而不重复灌入原始全文。
 */
export function buildResumePrompt(protocol: ReturnType<typeof createCompletionProtocol>, resumeTextBase = DEFAULT_RESUME_TEXT): string {
  return `${resumeTextBase} ${buildCompletionProtocolText(protocol)}\n`;
}

/**
 * 业务职责：把用户级别的运行参数规范化成共享引擎配置，保证不同入口的默认行为一致。
 */
export function normalizeRunOptions(options: RunTaskOptions): NormalizedRunOptions {
  return {
    task: options.task,
    workdir: path.resolve(options.workdir ?? process.cwd()),
    codexBin: options.codexBin ?? process.env.CODEX_BIN ?? "codex",
    intervalSeconds: options.intervalSeconds ?? 3,
    fullAuto: options.fullAuto ?? true,
    dangerouslyBypass: options.dangerouslyBypass ?? false,
    skipGitRepoCheck: options.skipGitRepoCheck ?? false,
    startWithResumeIfPossible: options.startWithResumeIfPossible ?? true,
    jobId: options.jobId,
    stateDir: options.stateDir,
    exactStateDir: options.exactStateDir,
    model: options.model,
    profile: options.profile,
    confirmText: options.confirmText ?? DEFAULT_CONFIRM_TEXT,
    resumeTextBase: options.resumeTextBase ?? DEFAULT_RESUME_TEXT,
    maxAttempts: options.maxAttempts
  };
}

/**
 * 业务职责：运行或续跑一个统一任务，持续使用同一状态目录直到收到严格完成协议或被外部中断。
 */
export async function runTask(options: RunTaskOptions): Promise<JobRunResult> {
  const normalized = normalizeRunOptions(options);
  const { protocol, prompt: initialPrompt } = buildInitialPrompt(normalized.task, normalized.confirmText);
  const workdirIsValid = await workdirExists(normalized.workdir);
  const metadata = await ensureJobMetadata({
    stateRoot: resolveStateRoot(normalized.stateDir, normalized.workdir, workdirIsValid),
    exactStateDir: normalized.exactStateDir,
    jobId: normalized.jobId,
    workdir: normalized.workdir,
    protocol,
    model: normalized.model,
    profile: normalized.profile,
    fullAuto: normalized.fullAuto,
    dangerouslyBypass: normalized.dangerouslyBypass,
    skipGitRepoCheck: normalized.skipGitRepoCheck,
    startWithResumeIfPossible: normalized.startWithResumeIfPossible
  });

  if (!workdirIsValid) {
    return failJob(metadata, new JobError("WORKDIR_NOT_FOUND", `WORKDIR does not exist: ${path.resolve(normalized.workdir)}`, false));
  }

  await writeFile(metadata.initialPromptFile, initialPrompt, "utf8");
  await writeFile(metadata.resumePromptFile, buildResumePrompt(protocol, normalized.resumeTextBase), "utf8");
  return runLoop(metadata, normalized.codexBin, normalized.intervalSeconds, normalized.maxAttempts);
}

/**
 * 业务职责：根据 session-id、job-id 或 `--last` 恢复已有任务，让守护进程中断后可以继续原链路推进。
 */
export async function resumeSession(options: ResumeSessionOptions): Promise<JobRunResult> {
  const metadata = await resolveResumeTarget(options);

  if (!metadata) {
    const failureMetadata = await createFailureMetadata(
      options.stateDir,
      process.cwd(),
      new JobError("SESSION_NOT_FOUND", "No resumable session was found.", false)
    );
    return buildResult(failureMetadata, "", failureMetadata.lastError);
  }

  const sessionId = await readSessionIdFile(metadata.sessionIdFile);
  if (sessionId && !metadata.sessionId) {
    metadata.sessionId = sessionId;
    await writeJobMetadata(metadata);
  }

  return runLoop(metadata, options.codexBin ?? process.env.CODEX_BIN ?? "codex", options.intervalSeconds ?? 3, options.maxAttempts);
}

/**
 * 业务职责：对外暴露任务状态查询结果，方便 MCP 客户端和人工命令查看长任务当前推进到哪里。
 */
export async function getSessionStatus(input: { stateDir?: string; jobId?: string; sessionId?: string; useLast?: boolean }): Promise<JobRunResult> {
  const metadata = await resolveResumeTarget({
    stateDir: input.stateDir,
    jobId: input.jobId,
    sessionId: input.sessionId,
    useLast: input.useLast
  });

  if (!metadata) {
    throw new JobError("SESSION_NOT_FOUND", "No session status could be found.", false);
  }

  return buildResult(metadata);
}

/**
 * 业务职责：为 `session resume` 和 `get_session_status` 统一寻找目标任务，保证优先级和行为一致。
 */
export async function resolveResumeTarget(options: {
  stateDir?: string;
  jobId?: string;
  sessionId?: string;
  useLast?: boolean;
}): Promise<JobMetadata | undefined> {
  const stateRoot = path.resolve(options.stateDir ?? path.resolve(process.cwd(), ".codex-run"));

  if (options.jobId) {
    return readJobMetadata(path.join(stateRoot, options.jobId));
  }

  if (options.sessionId) {
    const matched = await findJobBySessionId(stateRoot, options.sessionId);
    if (matched) {
      return matched;
    }
  }

  if (options.useLast) {
    const latestJobId = await readLatestJobId(stateRoot);
    if (latestJobId) {
      const latestJob = await readJobMetadata(path.join(stateRoot, latestJobId));
      if (latestJob) {
        return latestJob;
      }
    }

    return (await listJobs(stateRoot))[0];
  }

  return undefined;
}

/**
 * 业务职责：执行主守护循环，持续推进同一任务直到收到严格完成协议或命中显式尝试上限。
 */
async function runLoop(metadata: JobMetadata, codexBin: string, intervalSeconds: number, maxAttempts?: number): Promise<JobRunResult> {
  const initialPrompt = await readFile(metadata.initialPromptFile, "utf8");
  const resumePrompt = await readFile(metadata.resumePromptFile, "utf8");
  const hasSessionId = Boolean(metadata.sessionId || (await readSessionIdFile(metadata.sessionIdFile)));
  let nextMode: "initial" | "resume" =
    metadata.attemptCount === 0 && !hasSessionId && !(await hasResumeArtifacts(metadata)) ? "initial" : "resume";

  while (true) {
    metadata.status = "running";
    metadata.attemptCount += 1;
    metadata.lastError = undefined;
    await writeJobMetadata(metadata);

    const prompt = nextMode === "initial" ? initialPrompt : resumePrompt;
    let exitCode: number;
    try {
      exitCode = await runCodex(metadata, { codexBin, prompt, mode: nextMode });
    } catch (error) {
      return failJob(metadata, error);
    }
    metadata.lastExitCode = exitCode;

    const discoveredSessionId = await discoverSessionId(metadata.eventLogFile);
    if (discoveredSessionId) {
      await recordSessionId(metadata, discoveredSessionId);
    }

    await snapshotAttempt(metadata, metadata.attemptCount);
    const lastMessage = await readLastMessage(metadata);
    const protocol = createCompletionProtocol(metadata.confirmText, metadata.nonce.replace(/-/g, ""));
    if (isCompletionMessage(lastMessage, protocol)) {
      metadata.status = "completed";
      await writeJobMetadata(metadata);
      return buildResult(metadata, lastMessage);
    }

    if (maxAttempts && metadata.attemptCount >= maxAttempts) {
      metadata.status = "needs_resume";
      await writeJobMetadata(metadata);
      return buildResult(metadata, lastMessage);
    }

    metadata.status = "needs_resume";
    await writeJobMetadata(metadata);
    await sleep(intervalSeconds * 1000);
    nextMode = "resume";
  }
}

/**
 * 业务职责：判断当前任务目录里是否已有可续跑痕迹，避免重启后无脑新建会话导致上下文漂移。
 */
async function hasResumeArtifacts(metadata: JobMetadata): Promise<boolean> {
  return Boolean((await readSessionIdFile(metadata.sessionIdFile)) || metadata.sessionId || metadata.attemptCount > 0);
}

/**
 * 业务职责：把任务元信息和最后输出收敛成统一结果对象，供 CLI、测试和 MCP 工具直接返回。
 */
async function buildResult(metadata: JobMetadata, lastMessage?: string, error?: JobErrorInfo): Promise<JobRunResult> {
  return {
    jobId: metadata.jobId,
    sessionId: metadata.sessionId ?? (await readSessionIdFile(metadata.sessionIdFile)),
    stateDir: metadata.stateDir,
    status: metadata.status,
    lastMessage: lastMessage ?? (await readLastMessage(metadata)),
    lastMessageFile: metadata.lastMessageFile,
    error: error ?? metadata.lastError
  };
}

/**
 * 业务职责：在未完成时按配置间隔再次推进任务，维持与旧 Bash 守护脚本一致的续跑节奏。
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 业务职责：为工作目录无效等前置失败场景选择安全的状态根目录，避免意外创建不存在的业务仓库目录。
 */
function resolveStateRoot(stateDir: string | undefined, workdir: string, workdirIsValid: boolean): string {
  if (stateDir) {
    return path.resolve(stateDir);
  }

  if (workdirIsValid) {
    return path.resolve(workdir, ".codex-run");
  }

  return path.resolve(process.cwd(), ".codex-run");
}

/**
 * 业务职责：把不可继续推进的任务统一写成失败态结果，让调用方既能看到错误也能拿到状态目录。
 */
async function failJob(metadata: JobMetadata, error: unknown): Promise<JobRunResult> {
  const normalizedError = toJobErrorInfo(error);
  await recordJobFailure(metadata, normalizedError);
  return buildResult(metadata, await readLastMessage(metadata), normalizedError);
}

/**
 * 业务职责：在 resume 目标缺失等没有现成任务目录的场景下创建一个失败记录，保证错误同样可追踪。
 */
async function createFailureMetadata(stateDir: string | undefined, workdir: string, error: JobError): Promise<JobMetadata> {
  const metadata = await ensureJobMetadata({
    stateRoot: stateDir ? path.resolve(stateDir) : path.resolve(process.cwd(), ".codex-run"),
    workdir,
    protocol: createCompletionProtocol(DEFAULT_CONFIRM_TEXT),
    fullAuto: true,
    dangerouslyBypass: false,
    skipGitRepoCheck: false,
    startWithResumeIfPossible: false
  });

  await clearJobError(metadata);
  await recordJobFailure(metadata, toJobErrorInfo(error));
  return metadata;
}
