/**
 * 业务职责：会话恢复单测验证 `session-id.txt`、`latest-job.txt` 和目录扫描回退的优先级，
 * 确保守护层中断后仍然能按既定顺序命中正确任务。
 */
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCompletionProtocol } from "../../src/engine/completion.js";
import { resolveResumeTarget } from "../../src/engine/job.js";
import { ensureJobMetadata } from "../../src/engine/state.js";

describe("session resolution", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
  });

  /**
   * 业务职责：验证按 session id 查找时会优先读取 `session-id.txt`，避免元信息未同步时无法恢复会话。
   */
  it("prefers session-id file when resolving by session id", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "session-resolution-"));
    const metadata = await ensureJobMetadata({
      stateRoot: tempRoot,
      workdir: tempRoot,
      protocol: createCompletionProtocol("CONFIRMED"),
      fullAuto: true,
      dangerouslyBypass: false,
      skipGitRepoCheck: false,
      startWithResumeIfPossible: true
    });
    await writeFile(metadata.sessionIdFile, "11111111-1111-1111-1111-111111111111\n", "utf8");

    const resolved = await resolveResumeTarget({
      stateDir: tempRoot,
      sessionId: "11111111-1111-1111-1111-111111111111"
    });

    expect(resolved?.jobId).toBe(metadata.jobId);
  });

  /**
   * 业务职责：验证 `--last` 会先尊重 `latest-job.txt`，缺失时再退回到按目录扫描的最近任务。
   */
  it("falls back from latest-job pointer to directory scan", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "session-resolution-"));
    const first = await ensureJobMetadata({
      stateRoot: tempRoot,
      workdir: tempRoot,
      protocol: createCompletionProtocol("CONFIRMED"),
      fullAuto: true,
      dangerouslyBypass: false,
      skipGitRepoCheck: false,
      startWithResumeIfPossible: true
    });
    const second = await ensureJobMetadata({
      stateRoot: tempRoot,
      workdir: tempRoot,
      protocol: createCompletionProtocol("CONFIRMED"),
      fullAuto: true,
      dangerouslyBypass: false,
      skipGitRepoCheck: false,
      startWithResumeIfPossible: true
    });
    await writeMetadataTimestamp(first.metaFile, "2026-03-26T08:00:00.000Z");
    await writeMetadataTimestamp(second.metaFile, "2026-03-26T09:00:00.000Z");
    await writeFile(path.join(tempRoot, "latest-job.txt"), `${first.jobId}\n`, "utf8");

    const latestResolved = await resolveResumeTarget({
      stateDir: tempRoot,
      useLast: true
    });
    expect(latestResolved?.jobId).toBe(first.jobId);

    await rm(path.join(tempRoot, "latest-job.txt"), { force: true });
    const scannedResolved = await resolveResumeTarget({
      stateDir: tempRoot,
      useLast: true
    });
    expect(scannedResolved?.jobId).toBe(second.jobId);
  });
});

/**
 * 业务职责：测试需要可控地制造“哪个任务更新得更晚”，因此直接改写 meta.json 的时间戳字段。
 */
async function writeMetadataTimestamp(metaFile: string, updatedAt: string): Promise<void> {
  const metadata = JSON.parse(await readFile(metaFile, "utf8")) as { updatedAt: string };
  metadata.updatedAt = updatedAt;
  await writeFile(metaFile, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}
