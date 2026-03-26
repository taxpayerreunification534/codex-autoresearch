/**
 * 业务职责：完成协议单测确保统一执行引擎只会在严格双行口令命中时判定任务完成，
 * 避免迁移到 TS 后破坏原有 Bash 守护脚本最关键的收尾约束。
 */
import { describe, expect, it } from "vitest";
import { buildCompletionProtocolText, createCompletionProtocol, isCompletionMessage } from "../../src/engine/completion.js";

describe("completion protocol", () => {
  /**
   * 业务职责：验证 nonce 与 done token 的反转关系，确保完成口令可以稳定生成和复算。
   */
  it("creates reverse completion token", () => {
    const protocol = createCompletionProtocol("CONFIRMED", "a1b2c3d4e5f6");
    expect(protocol.nonce).toBe("a1b2-c3d4-e5f6");
    expect(protocol.doneToken).toBe("e5f6-c3d4-a1b2");
  });

  /**
   * 业务职责：验证完成协议提示文本包含 nonce 和确认文案，避免实际执行时协议说明缺失。
   */
  it("builds protocol text", () => {
    const protocol = createCompletionProtocol("CONFIRMED", "a1b2c3d4e5f6");
    expect(buildCompletionProtocolText(protocol)).toContain(protocol.nonce);
    expect(buildCompletionProtocolText(protocol)).toContain("CONFIRMED");
  });

  /**
   * 业务职责：验证多余第三行会导致判定失败，保持与旧 Bash 版本一致的严格性。
   */
  it("detects exact two-line completion", () => {
    const protocol = createCompletionProtocol("CONFIRMED", "a1b2c3d4e5f6");
    expect(isCompletionMessage("e5f6-c3d4-a1b2\nCONFIRMED", protocol)).toBe(true);
    expect(isCompletionMessage("e5f6-c3d4-a1b2\nCONFIRMED\nextra", protocol)).toBe(false);
  });
});
