/**
 * 业务职责：统一错误模块负责把 CLI、执行引擎和 MCP 中出现的业务失败收敛成稳定结构，
 * 方便状态持久化、终端输出和外部 agent 判断错误是否可重试。
 */
export interface JobErrorInfo {
  code: string;
  message: string;
  retryable: boolean;
}

/**
 * 业务职责：执行错误对象携带稳定错误码和可重试语义，避免上层只能依赖不稳定的异常文本做判断。
 */
export class JobError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  /**
   * 业务职责：创建统一错误实例，让业务层在失败时可以同时保留错误码、文案和重试建议。
   */
  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "JobError";
    this.code = code;
    this.retryable = retryable;
  }
}

/**
 * 业务职责：把任意异常标准化成对外稳定的错误结构，便于日志、状态文件和 API 响应复用。
 */
export function toJobErrorInfo(error: unknown, fallbackCode = "UNKNOWN_ERROR"): JobErrorInfo {
  if (error instanceof JobError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable
    };
  }

  if (error instanceof Error) {
    return {
      code: fallbackCode,
      message: error.message,
      retryable: false
    };
  }

  return {
    code: fallbackCode,
    message: String(error),
    retryable: false
  };
}

/**
 * 业务职责：为 CLI 和 MCP 构造稳定失败响应，让不同入口对失败结果的表达保持一致。
 */
export function buildFailurePayload(error: JobErrorInfo, stateDir?: string, jobId?: string) {
  return {
    status: "failed" as const,
    stateDir,
    jobId,
    error
  };
}
