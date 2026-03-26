/**
 * 业务职责：集成测试辅助模块负责准备临时仓库、fake codex 环境和状态目录，
 * 让长任务场景测试能独立验证而不污染真实工作区。
 */
import { chmod, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * 业务职责：创建一套可执行的 fake codex 二进制和最小工作目录，供引擎集成测试复用。
 */
export async function createFakeCodexWorkspace(): Promise<{
  root: string;
  workdir: string;
  fakeCodexPath: string;
  stateFile: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-autoresearch-"));
  const workdir = path.join(root, "repo");
  await mkdir(workdir, { recursive: true });
  await writeFile(path.join(workdir, "README.md"), "# temp\n", "utf8");

  const fakeCodexPath = path.join(root, "fake-codex.js");
  const stateFile = path.join(root, "fake-calls.json");
  await writeFile(fakeCodexPath, await readFile(path.resolve("test/integration/fake-codex.js"), "utf8"), "utf8");
  await chmod(fakeCodexPath, 0o755);

  return { root, workdir, fakeCodexPath, stateFile };
}
