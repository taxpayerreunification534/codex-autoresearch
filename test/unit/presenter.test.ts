/**
 * 业务职责：presenter 单测验证统一 JSON 输出层能稳定区分成功、失败和 MCP 文本包装，
 * 避免 transport 层回到各自手写字符串拼装。
 */
import { describe, expect, it } from "vitest";
import { isFailedPayload, presentFailurePayload, presentMcpJson, serializeJsonPayload } from "../../src/presenters/json.js";

describe("json presenter", () => {
  /**
   * 业务职责：验证失败态会被识别为 CLI 非零退出条件，而确认态或成功态不会被误判成失败。
   */
  it("detects failed payloads", () => {
    expect(isFailedPayload({ status: "failed" })).toBe(true);
    expect(isFailedPayload({ status: "needs_confirmation" })).toBe(false);
  });

  /**
   * 业务职责：验证 MCP presenter 会把业务结果包装成稳定 text content 响应。
   */
  it("wraps payloads for mcp text responses", () => {
    const response = presentMcpJson({ status: "completed", jobId: "job-1" });

    expect(response.content[0].text).toContain('"jobId": "job-1"');
  });

  /**
   * 业务职责：验证异常会被统一标准化成失败 JSON，便于 CLI 和 MCP 共用错误表达。
   */
  it("formats unknown errors as stable failure payloads", () => {
    const payload = presentFailurePayload(new Error("boom"), "CLI_ERROR");

    expect(serializeJsonPayload(payload)).toContain('"code": "CLI_ERROR"');
  });
});
