/**
 * 业务职责：应用层上下文模块负责把不同传输入口的零散默认值收口成统一执行上下文，
 * 避免 CLI、legacy 和未来新入口分别维护 workdir、interval、full-auto 等默认策略。
 */
import type { CommandExecutionContext } from "./types.js";

export interface CliExecutionOptions {
  workdir?: string;
  stateDir?: string;
  model?: string;
  profile?: string;
  interval?: number;
  interactive?: boolean;
  skipGitRepoCheck?: boolean;
  dangerouslyBypass?: boolean;
  fullAuto?: boolean;
}

export interface NormalizedCliExecutionContext extends CommandExecutionContext {
  workdir: string;
  interactive: boolean;
  intervalSeconds: number;
  fullAuto: boolean;
  dangerouslyBypass: boolean;
  skipGitRepoCheck: boolean;
}

/**
 * 业务职责：把 CLI 根选项统一变成应用层命令上下文，保证 direct task、skill、resume 和 legacy 的默认行为一致。
 */
export function normalizeCliExecutionContext(options: CliExecutionOptions): NormalizedCliExecutionContext {
  return {
    workdir: options.workdir ?? process.cwd(),
    stateDir: options.stateDir,
    model: options.model,
    profile: options.profile,
    intervalSeconds: options.interval ?? 3,
    interactive: options.interactive ?? false,
    skipGitRepoCheck: options.skipGitRepoCheck ?? false,
    dangerouslyBypass: options.dangerouslyBypass ?? false,
    fullAuto: options.fullAuto ?? true
  };
}
