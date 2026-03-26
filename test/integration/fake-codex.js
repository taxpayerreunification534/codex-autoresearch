#!/usr/bin/env node
/**
 * 业务职责：fake codex 二进制用于集成测试里模拟 `codex exec/resume` 的结构化事件和最终输出，
 * 从而验证统一执行引擎在不依赖真实 Codex 网络环境时的长任务语义。
 */
const fs = require("node:fs");
const path = require("node:path");

/**
 * 业务职责：解析当前调用的核心参数，便于按首轮、resume、`--last` 等场景输出不同测试结果。
 */
function parseArgs(argv) {
  const outputIndex = argv.indexOf("-o");
  const lastMessageFile = outputIndex >= 0 ? argv[outputIndex + 1] : undefined;
  const isResume = argv[0] === "exec" && argv[1] === "resume";
  const prompt = argv.at(-1);
  const resumeTarget = isResume ? argv[argv.length - 2] : undefined;
  const workdirIndex = argv.indexOf("-C");
  const workdir = workdirIndex >= 0 ? argv[workdirIndex + 1] : process.cwd();

  return { lastMessageFile, isResume, prompt, resumeTarget, workdir };
}

/**
 * 业务职责：把每次调用追加到测试状态文件，让测试用例能够断言引擎是否真的走了 initial/resume 路径。
 */
function loadState(stateFile) {
  if (!stateFile || !fs.existsSync(stateFile)) {
    return { calls: 0, phases: [] };
  }

  return JSON.parse(fs.readFileSync(stateFile, "utf8"));
}

/**
 * 业务职责：持久化 fake codex 调用历史，支撑多轮续跑和 `--last` 行为验证。
 */
function saveState(stateFile, state) {
  if (!stateFile) {
    return;
  }

  fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

const args = process.argv.slice(2);
const parsed = parseArgs(args);
const stateFile = process.env.FAKE_CODEX_STATE_FILE;
const behavior = process.env.FAKE_CODEX_BEHAVIOR || "complete_on_resume";
const state = loadState(stateFile);
state.calls += 1;
state.phases.push({
  isResume: parsed.isResume,
  resumeTarget: parsed.resumeTarget,
  workdir: parsed.workdir
});
saveState(stateFile, state);

const sessionId = process.env.FAKE_CODEX_SESSION_ID || "11111111-1111-1111-1111-111111111111";
process.stdout.write(`${JSON.stringify({ session_id: sessionId, call: state.calls })}\n`);

if (!parsed.lastMessageFile) {
  process.exit(1);
}

if (behavior === "complete_immediately") {
  const nonce = parsed.prompt.match(/nonce `([^`]+)`/)?.[1] ?? "0000-0000-0000";
  fs.writeFileSync(parsed.lastMessageFile, `${nonce.split("-").reverse().join("-")}\nCONFIRMED: all tasks completed`, "utf8");
  process.exit(0);
}

if (behavior === "complete_on_resume" && parsed.isResume) {
  const nonce = parsed.prompt.match(/nonce `([^`]+)`/)?.[1] ?? "0000-0000-0000";
  fs.writeFileSync(parsed.lastMessageFile, `${nonce.split("-").reverse().join("-")}\nCONFIRMED: all tasks completed`, "utf8");
  process.exit(0);
}

if (behavior === "complete_after_two_attempts" && state.calls >= 2) {
  const nonce = parsed.prompt.match(/nonce `([^`]+)`/)?.[1] ?? "0000-0000-0000";
  fs.writeFileSync(parsed.lastMessageFile, `${nonce.split("-").reverse().join("-")}\nCONFIRMED: all tasks completed`, "utf8");
  process.exit(0);
}

fs.writeFileSync(parsed.lastMessageFile, "still working", "utf8");
process.exit(0);
