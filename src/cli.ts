#!/usr/bin/env node
/**
 * 业务职责：CLI 主入口把 direct task、skills、session 恢复和 MCP 服务统一收口，
 * 让本仓库从单一 Bash 守护脚本升级为正式的 Node 命令行工具。
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Command, InvalidArgumentError } from "commander";
import { once } from "node:events";
import { normalizeCliExecutionContext } from "./application/context.js";
import { getTaskStatus, listAvailableSkills, resumeExistingTask, runDirectTask, runSkillTask } from "./application/use-cases.js";
import { ask } from "./engine/interactive.js";
import { serveMcp } from "./mcp/server.js";
import { isFailedPayload, presentFailurePayload, serializeJsonPayload } from "./presenters/json.js";

/**
 * 业务职责：创建 CLI 命令结构，固定对外公开的 `run`、`skill`、`session` 和 `mcp` 四组接口。
 */
export function createProgram(): Command {
  const program = new Command();

  program
    .name("codex-autoresearch")
    .description("Unified Codex long-task runner with CLI, skills, and MCP.")
    .argument("[task]", "直接执行的任务文本");
  program.option("--state-dir <path>", "状态根目录，默认落到 workdir/.codex-run");
  program.option("--workdir <path>", "Codex 实际执行目录", process.cwd());
  program.option("--model <model>", "透传给 codex exec -m");
  program.option("--profile <profile>", "透传给 codex exec --profile");
  program.option("--interactive", "启用交互补参");
  program.option("--interval <seconds>", "未完成时的重试间隔秒数", parsePositiveInt, 3);
  program.option("--skip-git-repo-check", "跳过 git 仓库校验");
  program.option("--dangerously-bypass", "启用危险绕过模式");
  program.option("--no-full-auto", "关闭默认 --full-auto");

  program.command("run").argument("[task]").description("直接执行一条任务文本").action(async (task, command) => {
    const rootOptions = normalizeCliExecutionContext(command.parent?.opts() ?? {});
    const resolvedTask = task ?? (rootOptions.interactive ? await ask("请输入任务") : "");

    if (!resolvedTask) {
      throw new InvalidArgumentError("run 命令需要任务文本，或使用交互模式输入。");
    }

    const result = await runDirectTask({
      ...rootOptions,
      task: resolvedTask,
    });

    printResult(result);
  });

  const skill = program.command("skill").description("管理或运行仓库内 skills");
  skill.command("list").description("列出全部 skills").action(async () => {
    const definitions = await listAvailableSkills(path.resolve("skills"));
    for (const definition of definitions) {
      console.log(`${definition.name}\t${definition.description}`);
    }
  });

  skill.command("run").argument("<skillName>").option("--set <key=value...>", "传入 skill 输入").description("执行指定 skill").action(async (skillName, options, command) => {
    const rootOptions = normalizeCliExecutionContext(command.parent?.parent?.opts() ?? {});
    const inputMap = parseKeyValuePairs(options.set ?? []);
    const result = await runSkillTask({
      ...rootOptions,
      skillName,
      inputs: inputMap,
      interactive: rootOptions.interactive,
      skillsRoot: path.resolve("skills")
    });

    printResult(result);
  });

  const session = program.command("session").description("恢复或查看已有任务");
  session.command("resume").argument("[sessionId]").option("--last", "恢复最近一次任务").description("按 session id 或最近状态继续运行").action(async (sessionId, options, command) => {
    const rootOptions = normalizeCliExecutionContext(command.parent?.parent?.opts() ?? {});
    if (!sessionId && !options.last) {
      throw new InvalidArgumentError("session resume 需要 <session-id> 或 --last。");
    }

    const result = await resumeExistingTask({
      sessionId,
      useLast: options.last,
      stateDir: rootOptions.stateDir,
      intervalSeconds: rootOptions.intervalSeconds
    });
    printResult(result);
  });

  session.command("status").argument("[sessionId]").option("--last", "读取最近一次任务状态").description("查看已有任务当前状态").action(async (sessionId, options, command) => {
    const rootOptions = normalizeCliExecutionContext(command.parent?.parent?.opts() ?? {});
    const result = await getTaskStatus({
      sessionId,
      useLast: options.last || !sessionId,
      stateDir: rootOptions.stateDir
    });
    printResult(result);
  });

  const mcp = program.command("mcp").description("启动仓库自有 MCP server");
  mcp.command("serve").description("以 stdio 启动 MCP 服务").action(async () => {
    await serveMcp();
  });

  program.command("app").description("在 Codex Desktop 中打开当前目录").action(async (_, command) => {
    const rootOptions = command.parent?.opts() ?? {};
    await openCurrentDirectoryInDesktop(rootOptions.workdir, process.env.CODEX_BIN);
  });

  program.command("legacy").argument("<promptFile>").description("兼容旧版 prompt.md + shell 包装入口").action(async (promptFile) => {
    const task = promptFile === "-" ? await readStdin() : await readFile(path.resolve(promptFile), "utf8");
    const stateDir = process.env.STATE_DIR ? path.resolve(process.env.STATE_DIR) : undefined;
    const shouldResume = process.env.START_WITH_RESUME_IF_POSSIBLE !== "0";
    const result = shouldResume && stateDir
      ? await resumeExistingTask({
          useLast: true,
          stateDir,
          codexBin: process.env.CODEX_BIN,
          intervalSeconds: parseEnvInt(process.env.INTERVAL, 3)
        }).then((resumeResult) =>
          resumeResult.status === "failed" && resumeResult.error?.code === "SESSION_NOT_FOUND" ? runLegacyTask(task, stateDir) : resumeResult
        )
      : await runLegacyTask(task, stateDir);
    printResult(result);
  });

  program.action(async (task) => {
    const rootOptions = normalizeCliExecutionContext(program.opts());
    if (task) {
      const result = await runDirectTask({
        ...rootOptions,
        task,
      });
      printResult(result);
      return;
    }

    if (!process.stdin.isTTY) {
      const pipedTask = await readStdin();
      if (pipedTask.trim()) {
        const result = await runDirectTask({
          ...rootOptions,
          task: pipedTask,
        });
        printResult(result);
        return;
      }

      console.error("No task provided. Pass a task text, pipe stdin, or use --interactive.");
      program.help({ error: true });
      return;
    }

    const choice = await ask("请选择入口：run / skill / resume / app", "run");
    if (choice === "skill") {
      const skillName = await ask("请输入 skill 名称");
      await program.parseAsync(["skill", "run", skillName], { from: "user" });
      return;
    }

    if (choice === "resume") {
      await program.parseAsync(["session", "resume", "--last"], { from: "user" });
      return;
    }

    if (choice === "app") {
      await program.parseAsync(["app"], { from: "user" });
      return;
    }

    const promptedTask = await ask("请输入任务");
    await program.parseAsync(["run", promptedTask], { from: "user" });
  });

  return program;
}

/**
 * 业务职责：校验正整数参数，避免重试间隔等关键执行参数出现非法值导致守护行为异常。
 */
export function parsePositiveInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`Invalid positive integer: ${value}`);
  }
  return parsed;
}

/**
 * 业务职责：把 `--set key=value` 形式的 skill 输入收敛成统一 map，便于渲染模板和补齐缺参。
 */
export function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  return pairs.reduce<Record<string, string>>((result, pair) => {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      throw new InvalidArgumentError(`Invalid key=value input: ${pair}`);
    }

    const key = pair.slice(0, separatorIndex);
    const value = pair.slice(separatorIndex + 1);
    result[key] = value;
    return result;
  }, {});
}

/**
 * 业务职责：兼容层环境变量里常用的数字参数需要有稳定兜底，避免 legacy 模式在空值时行为漂移。
 */
function parseEnvInt(value: string | undefined, fallback: number): number {
  return value ? parsePositiveInt(value) : fallback;
}

/**
 * 业务职责：兼容旧 shell 管道把任务文本通过标准输入传入，避免强制先落一个 md 文件。
 */
async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * 业务职责：显式把当前工作目录交给 Codex Desktop 打开，满足“我已经在对的目录里”时的一键进入体验。
 */
export async function openCurrentDirectoryInDesktop(workdir: string, codexBin?: string): Promise<void> {
  const targetDir = path.resolve(workdir);
  const child = spawn(codexBin ?? "codex", ["app", targetDir], {
    stdio: "inherit",
    env: process.env
  });

  const [exitCode] = (await once(child, "close")) as [number | null];
  if ((exitCode ?? 1) !== 0) {
    throw new Error(`Failed to open Codex Desktop for directory: ${targetDir}`);
  }
}

/**
 * 业务职责：暴露真实入口，供 npm bin、测试和兼容脚本共享同一个 CLI 启动流程。
 */
export async function main(argv = process.argv): Promise<void> {
  try {
    await createProgram().parseAsync(argv);
  } catch (error) {
    console.error(serializeJsonPayload(presentFailurePayload(error, "CLI_ERROR")));
    process.exitCode = 1;
  }
}

/**
 * 业务职责：仅在作为真实可执行文件启动时运行 CLI，避免单测导入参数解析函数时误触发主流程。
 */
function isDirectExecution(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) {
  void main();
}

/**
 * 业务职责：兼容层发起新任务时只把 `STATE_DIR` 视为状态根目录，确保状态统一落到 `<job-id>` 子目录。
 */
async function runLegacyTask(task: string, stateDir?: string) {
  return runDirectTask({
    task,
    workdir: process.env.WORKDIR,
    stateDir,
    model: process.env.MODEL,
    profile: process.env.PROFILE,
    intervalSeconds: parseEnvInt(process.env.INTERVAL, 3),
    fullAuto: process.env.USE_FULL_AUTO !== "0",
    dangerouslyBypass: process.env.DANGEROUSLY_BYPASS === "1",
    skipGitRepoCheck: process.env.SKIP_GIT_REPO_CHECK === "1",
    startWithResumeIfPossible: process.env.START_WITH_RESUME_IF_POSSIBLE !== "0",
    confirmText: process.env.CONFIRM_TEXT
  });
}

/**
 * 业务职责：统一根据 presenter 规则打印 CLI 结果，保证 direct task、skill、resume 和 legacy 的成功失败表达一致。
 */
function printResult(result: unknown): void {
  const serialized = serializeJsonPayload(result);
  if (isFailedPayload(result)) {
    console.error(serialized);
    process.exitCode = 1;
    return;
  }

  console.log(serialized);
}
