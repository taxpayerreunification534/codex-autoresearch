/**
 * 业务职责：集成测试覆盖 direct task、resume、`--last` 和兼容 wrapper，
 * 确认 TS 引擎迁移后仍保留原有 Bash 长任务守护语义。
 */
import { readFile, readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resumeSession, runTask } from "../../src/engine/job.js";
import { createFakeCodexWorkspace } from "./helpers.js";

const execFileAsync = promisify(execFile);

describe("job runner integration", () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((item) => rm(item, { recursive: true, force: true })));
  });

  /**
   * 业务职责：验证没有 prompt.md 时也能直接启动任务，满足新的命令优先执行入口。
   */
  it("runs direct task without prompt file", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    process.env.FAKE_CODEX_STATE_FILE = workspace.stateFile;
    process.env.FAKE_CODEX_BEHAVIOR = "complete_immediately";

    const result = await runTask({
      task: "research something",
      workdir: workspace.workdir,
      stateDir: path.join(workspace.root, ".codex-run"),
      codexBin: workspace.fakeCodexPath
    });

    expect(result.status).toBe("completed");
    expect(result.sessionId).toBe("11111111-1111-1111-1111-111111111111");
  });

  /**
   * 业务职责：验证未完成时会自动进入 resume 路径继续推进，而不是重新起新会话。
   */
  it("retries unfinished task with resume", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    process.env.FAKE_CODEX_STATE_FILE = workspace.stateFile;
    process.env.FAKE_CODEX_BEHAVIOR = "complete_on_resume";

    const result = await runTask({
      task: "long task",
      workdir: workspace.workdir,
      stateDir: path.join(workspace.root, ".codex-run"),
      codexBin: workspace.fakeCodexPath,
      intervalSeconds: 0.01
    });
    const fakeState = JSON.parse(await readFile(workspace.stateFile, "utf8"));

    expect(result.status).toBe("completed");
    expect(fakeState.calls).toBeGreaterThanOrEqual(2);
    expect(fakeState.phases[1].isResume).toBe(true);
  });

  /**
   * 业务职责：验证 `resume_session --last` 能绑定最近任务，支撑外部系统在中断后继续同一任务。
   */
  it("resumes latest session", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    process.env.FAKE_CODEX_STATE_FILE = workspace.stateFile;
    process.env.FAKE_CODEX_BEHAVIOR = "complete_immediately";

    const first = await runTask({
      task: "first",
      workdir: workspace.workdir,
      stateDir: path.join(workspace.root, ".codex-run"),
      codexBin: workspace.fakeCodexPath
    });

    process.env.FAKE_CODEX_BEHAVIOR = "complete_on_resume";
    const resumed = await resumeSession({
      useLast: true,
      stateDir: path.join(workspace.root, ".codex-run"),
      codexBin: workspace.fakeCodexPath,
      intervalSeconds: 0.01,
      maxAttempts: 1
    });

    expect(resumed.jobId).toBe(first.jobId);
  });

  /**
   * 业务职责：验证兼容 shell wrapper 仍能把旧入口转接到新的 Node CLI，避免老用法直接失效。
   */
  it("supports legacy wrapper", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    process.env.FAKE_CODEX_STATE_FILE = workspace.stateFile;
    process.env.FAKE_CODEX_BEHAVIOR = "complete_immediately";
    const promptPath = path.join(workspace.root, "prompt.md");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(promptPath, "legacy prompt", "utf8"));

    const { stdout } = await execFileAsync("bash", ["./codex-keep-running.sh", promptPath], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        CODEX_BIN: workspace.fakeCodexPath,
        WORKDIR: workspace.workdir,
        STATE_DIR: path.join(workspace.root, "legacy-state"),
        NODE_OPTIONS: "",
        PATH: process.env.PATH
      }
    });

    expect(stdout).toContain('"status": "completed"');
  });

  /**
   * 业务职责：验证兼容 shell 连续复用同一个 `STATE_DIR` 时会走统一状态根目录和最近任务恢复逻辑。
   */
  it("reuses latest job under the same legacy state root", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    const stateRoot = path.join(workspace.root, "legacy-state");
    const promptPath = path.join(workspace.root, "prompt.md");
    await import("node:fs/promises").then(({ writeFile }) => writeFile(promptPath, "legacy prompt", "utf8"));

    process.env.FAKE_CODEX_STATE_FILE = workspace.stateFile;
    process.env.FAKE_CODEX_BEHAVIOR = "complete_immediately";
    await execFileAsync("bash", ["./codex-keep-running.sh", promptPath], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        CODEX_BIN: workspace.fakeCodexPath,
        WORKDIR: workspace.workdir,
        STATE_DIR: stateRoot,
        NODE_OPTIONS: "",
        PATH: process.env.PATH
      }
    });

    const latestJobId = (await readFile(path.join(stateRoot, "latest-job.txt"), "utf8")).trim();
    const jobDirInfo = await stat(path.join(stateRoot, latestJobId));
    expect(jobDirInfo.isDirectory()).toBe(true);

    process.env.FAKE_CODEX_BEHAVIOR = "complete_on_resume";
    await execFileAsync("bash", ["./codex-keep-running.sh", promptPath], {
      cwd: path.resolve("."),
      env: {
        ...process.env,
        CODEX_BIN: workspace.fakeCodexPath,
        WORKDIR: workspace.workdir,
        STATE_DIR: stateRoot,
        NODE_OPTIONS: "",
        PATH: process.env.PATH
      }
    });

    const entries = await readdir(stateRoot);
    const jobDirectories = entries.filter((entry) => entry !== "latest-job.txt");
    const fakeState = JSON.parse(await readFile(workspace.stateFile, "utf8"));
    expect(jobDirectories).toContain(latestJobId);
    expect(fakeState.phases.at(-1)?.isResume).toBe(true);
  });

  /**
   * 业务职责：验证无效 workdir 会把 failed 状态和错误码持久化到 meta.json，便于外部系统排障。
   */
  it("persists failed status for invalid workdir", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    const stateRoot = path.join(workspace.root, ".codex-run");

    const result = await runTask({
      task: "broken workdir",
      workdir: path.join(workspace.root, "missing-repo"),
      stateDir: stateRoot,
      codexBin: workspace.fakeCodexPath
    });

    const meta = JSON.parse(await readFile(path.join(result.stateDir, "meta.json"), "utf8"));
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("WORKDIR_NOT_FOUND");
    expect(meta.status).toBe("failed");
    expect(meta.lastError.code).toBe("WORKDIR_NOT_FOUND");
  });

  /**
   * 业务职责：验证 codex 无法启动时会写回 failed 状态，而不是让任务只在异常栈里消失。
   */
  it("persists failed status when codex binary cannot start", async () => {
    const workspace = await createFakeCodexWorkspace();
    cleanup.push(workspace.root);
    const stateRoot = path.join(workspace.root, ".codex-run");

    const result = await runTask({
      task: "spawn fail",
      workdir: workspace.workdir,
      stateDir: stateRoot,
      codexBin: path.join(workspace.root, "missing-codex-bin")
    });

    const meta = JSON.parse(await readFile(path.join(result.stateDir, "meta.json"), "utf8"));
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("CODEX_SPAWN_FAILED");
    expect(meta.status).toBe("failed");
    expect(meta.lastError.code).toBe("CODEX_SPAWN_FAILED");
  });
});
