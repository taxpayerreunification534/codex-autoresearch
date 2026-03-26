/**
 * 业务职责：CLI 参数单测确保命令行输入在进入执行引擎前被稳定校验，
 * 避免无效数值和 skill 参数格式问题在长任务运行到中途才暴露。
 */
import { describe, expect, it } from "vitest";
import { createProgram, parseKeyValuePairs, parsePositiveInt } from "../../src/cli.js";

describe("cli parsers", () => {
  /**
   * 业务职责：验证正整数参数合法时能被正确解析，支撑 interval 等关键执行开关。
   */
  it("parses positive int", () => {
    expect(parsePositiveInt("5")).toBe(5);
  });

  /**
   * 业务职责：验证非法数值会尽早报错，避免守护间隔被配置成无效值。
   */
  it("rejects invalid positive int", () => {
    expect(() => parsePositiveInt("0")).toThrow();
  });

  /**
   * 业务职责：验证 `--set key=value` 能稳定转换为 skill 输入 map。
   */
  it("parses key value pairs", () => {
    expect(parseKeyValuePairs(["topic=cli", "lang=zh"])).toEqual({ topic: "cli", lang: "zh" });
    expect(() => parseKeyValuePairs(["broken"])).toThrow();
  });

  /**
   * 业务职责：验证非交互模式下 `run` 缺少任务会立即失败，避免 CLI 在 TTY 环境里误进入隐式提问流程。
   */
  it("rejects missing run task in non-interactive mode", async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(program.parseAsync(["run"], { from: "user" })).rejects.toThrow(
      "run 命令需要任务文本"
    );
  });

  /**
   * 业务职责：验证缺少 session 标识且没有 `--last` 时会直接报错，避免恢复命令落入不明确状态。
   */
  it("rejects resume without session id or last", async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(program.parseAsync(["session", "resume"], { from: "user" })).rejects.toThrow(
      "session resume 需要 <session-id> 或 --last"
    );
  });

  /**
   * 业务职责：验证非交互 skill 执行缺少必填输入时会报稳定错误，避免上线后命令挂在等待用户输入。
   */
  it("rejects missing required skill input without interactive mode", async () => {
    const program = createProgram();
    program.exitOverride();

    await expect(program.parseAsync(["skill", "run", "research"], { from: "user" })).rejects.toThrow(
      "Missing required skill input: topic"
    );
  });
});
