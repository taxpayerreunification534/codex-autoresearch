/**
 * 业务职责：CLI 入口单测验证顶层直接任务、无参数分流和 Desktop 快捷入口，
 * 确保“站在当前目录直接用”的傻瓜式体验不会在后续改动中回退。
 */
import { EventEmitter } from "node:events";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const runTaskMock = vi.fn();
const resumeSessionMock = vi.fn();
const getSessionStatusMock = vi.fn();
const resolveResumeTargetMock = vi.fn();
const serveMcpMock = vi.fn();
const askMock = vi.fn();
const spawnMock = vi.fn();

vi.mock("../../src/engine/job.js", () => ({
  runTask: runTaskMock,
  resumeSession: resumeSessionMock,
  getSessionStatus: getSessionStatusMock,
  resolveResumeTarget: resolveResumeTargetMock
}));

vi.mock("../../src/mcp/server.js", () => ({
  serveMcp: serveMcpMock
}));

vi.mock("../../src/engine/interactive.js", () => ({
  ask: askMock
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock
}));

describe("cli entrypoints", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalAsyncIterator = process.stdin[Symbol.asyncIterator];
  const stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  const stderrSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    runTaskMock.mockResolvedValue({
      jobId: "job-1",
      sessionId: "session-1",
      stateDir: path.resolve(".codex-run/job-1"),
      status: "completed",
      lastMessage: "done",
      lastMessageFile: path.resolve(".codex-run/job-1/last-message.txt")
    });
    resumeSessionMock.mockResolvedValue({
      jobId: "job-1",
      sessionId: "session-1",
      stateDir: path.resolve(".codex-run/job-1"),
      status: "completed",
      lastMessage: "done",
      lastMessageFile: path.resolve(".codex-run/job-1/last-message.txt")
    });
    getSessionStatusMock.mockResolvedValue({
      jobId: "job-1",
      sessionId: "session-1",
      stateDir: path.resolve(".codex-run/job-1"),
      status: "completed",
      lastMessage: "done",
      lastMessageFile: path.resolve(".codex-run/job-1/last-message.txt")
    });
    askMock.mockReset();
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    Object.defineProperty(process.stdin, Symbol.asyncIterator, {
      configurable: true,
      value: async function* () {}
    });
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalIsTTY });
    Object.defineProperty(process.stdin, Symbol.asyncIterator, {
      configurable: true,
      value: originalAsyncIterator
    });
  });

  /**
   * 业务职责：验证顶层直接任务文本会走和 `run` 一样的统一执行链路，避免用户再记子命令。
   */
  it("treats top-level task text as run command", async () => {
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync(["修这个 bug"], { from: "user" });

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "修这个 bug",
        workdir: process.cwd()
      })
    );
  });

  /**
   * 业务职责：验证 `run` 子命令会继承根级 `--state-dir`，防止全局状态目录参数在子命令层级被吞掉。
   */
  it("propagates global state-dir to run subcommand", async () => {
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();
    const customStateDir = path.resolve("test/manual/runtime/regression-run-state-dir");

    await program.parseAsync(["--state-dir", customStateDir, "run", "校验 state-dir 透传"], { from: "user" });

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "校验 state-dir 透传",
        stateDir: customStateDir
      })
    );
  });

  /**
   * 业务职责：验证非 TTY 下有 stdin 时会把管道内容当任务文本直接执行，满足 shell 管道式傻瓜用法。
   */
  it("runs piped stdin as task when no args are provided", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    Object.defineProperty(process.stdin, Symbol.asyncIterator, {
      configurable: true,
      value: async function* () {
        yield Buffer.from("从 stdin 读取的任务");
      }
    });
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();

    await program.parseAsync([], { from: "user" });

    expect(runTaskMock).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "从 stdin 读取的任务",
        workdir: process.cwd()
      })
    );
  });

  /**
   * 业务职责：验证非 TTY 且没有任何输入时会给出明确帮助，避免命令静默无响应让用户误以为卡住。
   */
  it("fails with help when no args and no stdin are provided in non-tty mode", async () => {
    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false });
    Object.defineProperty(process.stdin, Symbol.asyncIterator, {
      configurable: true,
      value: async function* () {}
    });
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();

    await expect(program.parseAsync([], { from: "user" })).rejects.toThrow();
    expect(stderrSpy).toHaveBeenCalledWith("No task provided. Pass a task text, pipe stdin, or use --interactive.");
  });

  /**
   * 业务职责：验证 `app` 快捷入口会把当前目录交给 Codex Desktop 打开，但不改动现有执行链路。
   */
  it("opens current directory in codex desktop via app command", async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValue(child);
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();

    const parsing = program.parseAsync(["app"], { from: "user" });
    queueMicrotask(() => child.emit("close", 0));
    await parsing;

    expect(spawnMock).toHaveBeenCalledWith(
      "codex",
      ["app", path.resolve(process.cwd())],
      expect.objectContaining({ stdio: "inherit" })
    );
  });

  /**
   * 业务职责：验证无参数交互菜单包含 Desktop 打开分支，方便已经在正确目录时一键切到 Codex Desktop。
   */
  it("supports app choice in interactive root menu", async () => {
    const child = new EventEmitter();
    spawnMock.mockReturnValue(child);
    askMock.mockResolvedValueOnce("app");
    const { createProgram } = await import("../../src/cli.js");
    const program = createProgram();
    program.exitOverride();

    const parsing = program.parseAsync([], { from: "user" });
    queueMicrotask(() => child.emit("close", 0));
    await parsing;

    expect(askMock).toHaveBeenCalledWith("请选择入口：run / skill / resume / app", "run");
    expect(spawnMock).toHaveBeenCalled();
  });

  afterEach(() => {
    stdoutSpy.mockClear();
    stderrSpy.mockClear();
  });
});
