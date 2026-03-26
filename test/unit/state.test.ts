/**
 * 业务职责：状态单测验证 session 恢复优先级和 `.codex-run/<job-id>` 布局，
 * 确保守护脚本重启后仍能回到正确任务目录继续推进。
 */
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCompletionProtocol } from "../../src/engine/completion.js";
import { ensureJobMetadata, findJobBySessionId, readLatestJobId, recordSessionId } from "../../src/engine/state.js";

describe("state metadata", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) {
      await import("node:fs/promises").then(({ rm }) => rm(tempRoot, { recursive: true, force: true }));
      tempRoot = "";
    }
  });

  /**
   * 业务职责：验证任务状态目录固定带 job-id 子目录，支撑统一的状态归档和多任务并存。
   */
  it("creates job state beneath state root", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "state-test-"));
    const metadata = await ensureJobMetadata({
      stateRoot: tempRoot,
      workdir: tempRoot,
      protocol: createCompletionProtocol("CONFIRMED", "a1b2c3d4e5f6"),
      fullAuto: true,
      dangerouslyBypass: false,
      skipGitRepoCheck: false,
      startWithResumeIfPossible: true
    });

    expect(metadata.stateDir.startsWith(tempRoot)).toBe(true);
    expect(path.basename(metadata.stateDir)).toBe(metadata.jobId);
  });

  /**
   * 业务职责：验证 session-id 可以反查到正确任务，确保外部 agent 能按返回标识继续续跑。
   */
  it("finds job by session id", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "state-test-"));
    const metadata = await ensureJobMetadata({
      stateRoot: tempRoot,
      workdir: tempRoot,
      protocol: createCompletionProtocol("CONFIRMED", "a1b2c3d4e5f6"),
      fullAuto: true,
      dangerouslyBypass: false,
      skipGitRepoCheck: false,
      startWithResumeIfPossible: true
    });
    await recordSessionId(metadata, "11111111-1111-1111-1111-111111111111");

    const found = await findJobBySessionId(tempRoot, "11111111-1111-1111-1111-111111111111");
    expect(found?.jobId).toBe(metadata.jobId);
    expect(await readLatestJobId(tempRoot)).toBe(metadata.jobId);
  });
});
