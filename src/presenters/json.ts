/**
 * 业务职责：JSON presenter 统一负责把业务结果转换成 CLI 和 MCP 需要的稳定文本输出，
 * 避免每个 transport 再各自手写 JSON.stringify、失败判断和错误包装。
 */
import { buildFailurePayload, toJobErrorInfo } from "../engine/error.js";

export type TextContentResponse = Record<string, unknown> & {
  content: [{ type: "text"; text: string }];
};

/**
 * 业务职责：把任意业务结果序列化成稳定 JSON 文本，供 CLI 打印和测试断言复用同一格式。
 */
export function serializeJsonPayload(payload: unknown): string {
  return JSON.stringify(payload, null, 2);
}

/**
 * 业务职责：判断一个业务结果是否属于明确失败态，供 CLI 决定退出码和 stderr/stdout 落点。
 */
export function isFailedPayload(payload: unknown): boolean {
  return Boolean(payload && typeof payload === "object" && "status" in payload && (payload as { status?: string }).status === "failed");
}

/**
 * 业务职责：把业务结果包装成 MCP 约定的 text content 响应，保证所有工具输出结构一致。
 */
export function presentMcpJson(payload: unknown): TextContentResponse {
  return {
    content: [
      {
        type: "text",
        text: serializeJsonPayload(payload)
      }
    ]
  };
}

/**
 * 业务职责：把异常统一转换为稳定失败 JSON，方便 CLI 与 MCP 在 transport 层共享相同错误表达。
 */
export function presentFailurePayload(error: unknown, fallbackCode = "UNKNOWN_ERROR") {
  return buildFailurePayload(toJobErrorInfo(error, fallbackCode));
}
