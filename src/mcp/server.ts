/**
 * 业务职责：MCP 服务层把本仓库暴露成可被外部 agent 调用的任务执行服务，
 * 让 run task、run skill、resume 和状态查询都通过统一执行引擎完成。
 *
 * 为什么把 MCP 单独做成 transport 层：
 * - MCP 只是“怎么被外部调用”的协议，不应该承载核心业务编排。
 * - 这样 `route_chat_intent`、skill 执行、resume 规则都能和 CLI 共用同一套用例。
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getTaskStatus, listAvailableSkills, resumeExistingTask, routeChatIntent, runDirectTask, runSkillTask } from "../application/use-cases.js";
import { presentFailurePayload, presentMcpJson, type TextContentResponse } from "../presenters/json.js";

/**
 * 业务职责：direct task tool schema 定义 MCP 调用方可传入的直接任务参数，
 * 保证外部 agent 在启动长任务时遵循和 CLI 一致的最小输入契约。
 */
const RunTaskSchema = {
  task: z.string().min(1),
  workdir: z.string().optional(),
  stateDir: z.string().optional(),
  model: z.string().optional(),
  profile: z.string().optional(),
  maxAttempts: z.number().int().positive().optional()
};

/**
 * 业务职责：skill tool schema 定义 MCP 如何按仓库配方运行任务，
 * 让外部 agent 可以显式提供 skill 名称、输入值和可选交互行为。
 */
const RunSkillSchema = {
  skillName: z.string().min(1),
  inputs: z.record(z.string(), z.string()).optional(),
  workdir: z.string().optional(),
  stateDir: z.string().optional(),
  model: z.string().optional(),
  interactive: z.boolean().optional(),
  maxAttempts: z.number().int().positive().optional()
};

/**
 * 业务职责：resume tool schema 约束 MCP 恢复入口的定位字段，
 * 保证 session id、job id 和最近任务恢复这几种方式在协议上清晰区分。
 */
const ResumeSchema = {
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  useLast: z.boolean().optional(),
  stateDir: z.string().optional(),
  maxAttempts: z.number().int().positive().optional()
};

/**
 * 业务职责：status tool schema 约束纯状态查询所需的定位字段，
 * 避免调用方把状态查询和实际续跑请求混在一个工具里表达。
 */
const StatusSchema = {
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  useLast: z.boolean().optional(),
  stateDir: z.string().optional()
};

/**
 * 业务职责：聊天路由 tool schema 定义当前聊天意图、最近 8 轮摘要、显式 skill 指令和执行上下文的输入格式，
 * 让插件与外部 agent 能用稳定协议触发“继续 / 新建 / 运行 skill”的统一判断。
 */
const RouteChatIntentSchema = {
  chatIntent: z.string().min(1),
  chatSummary: z.string().optional(),
  chatWindowTurns: z.array(z.string().min(1)).optional(),
  triggerMode: z.enum(["slash", "natural", "explicit_skill"]).optional(),
  skillName: z.string().min(1).optional(),
  workdir: z.string().optional(),
  stateDir: z.string().optional(),
  model: z.string().optional(),
  profile: z.string().optional(),
  maxAttempts: z.number().int().positive().optional(),
  skillsRoot: z.string().optional()
};

/**
 * 业务职责：MCP handler 接口定义 transport 层每个工具回调的统一输出形态，
 * 让 server 注册、测试和 presenter 之间围绕同一份文本响应契约协作。
 */
export interface McpHandlers {
  runTaskTool: (input: { task: string; workdir?: string; stateDir?: string; model?: string; profile?: string; maxAttempts?: number }) => Promise<TextContentResponse>;
  runSkillTool: (input: { skillName: string; inputs?: Record<string, string>; workdir?: string; stateDir?: string; model?: string; interactive?: boolean; maxAttempts?: number }) => Promise<TextContentResponse>;
  resumeSessionTool: (input: { sessionId?: string; jobId?: string; useLast?: boolean; stateDir?: string; maxAttempts?: number }) => Promise<TextContentResponse>;
  getSessionStatusTool: (input: { sessionId?: string; jobId?: string; useLast?: boolean; stateDir?: string }) => Promise<TextContentResponse>;
  routeChatIntentTool: (input: {
    chatIntent: string;
    chatSummary?: string;
    chatWindowTurns?: string[];
    triggerMode?: "slash" | "natural" | "explicit_skill";
    skillName?: string;
    workdir?: string;
    stateDir?: string;
    model?: string;
    profile?: string;
    maxAttempts?: number;
    skillsRoot?: string;
  }) => Promise<TextContentResponse>;
  listSkillsTool: () => Promise<TextContentResponse>;
}

/**
 * 业务职责：抽出 MCP 工具处理器，便于在不启动 stdio server 的情况下直接做契约测试。
 *
 * 解决的问题：
 * - 直接测 stdio server 太重，handler 级测试可以更快覆盖输入输出契约。
 * - 以后新增 tool 时，只要加 handler 和测试，不必先起完整 server。
 */
export function createMcpHandlers(): McpHandlers {
  return {
    async runTaskTool(input) {
      return handleTool(async () =>
        presentMcpJson(
          await runDirectTask({
          task: input.task,
          workdir: input.workdir,
          stateDir: input.stateDir,
          model: input.model,
          profile: input.profile,
          maxAttempts: input.maxAttempts
          })
        )
      );
    },
    async runSkillTool(input) {
      return handleTool(async () =>
        presentMcpJson(
          await runSkillTask({
          skillName: input.skillName,
          inputs: input.inputs,
          workdir: input.workdir,
          stateDir: input.stateDir,
          model: input.model,
          interactive: input.interactive,
          maxAttempts: input.maxAttempts
          })
        )
      );
    },
    async resumeSessionTool(input) {
      return handleTool(async () =>
        presentMcpJson(
          await resumeExistingTask({
          sessionId: input.sessionId,
          jobId: input.jobId,
          useLast: input.useLast,
          stateDir: input.stateDir,
          maxAttempts: input.maxAttempts
          })
        )
      );
    },
    async getSessionStatusTool(input) {
      return handleTool(async () =>
        presentMcpJson(
          await getTaskStatus({
          sessionId: input.sessionId,
          jobId: input.jobId,
          useLast: input.useLast,
          stateDir: input.stateDir
          })
        )
      );
    },
    async routeChatIntentTool(input) {
      return handleTool(async () => presentMcpJson(await routeChatIntent(input)));
    },
    async listSkillsTool() {
      return handleTool(async () => presentMcpJson(await listAvailableSkills()));
    }
  };
}

/**
 * 业务职责：创建 MCP server 实例，并注册本项目对外承诺的固定工具集合。
 *
 * 为什么这里强调“固定工具集合”：
 * - 外部 agent 会依赖这些名称做自动调用，不能随意改名。
 * - 内部实现可以重构，但这里的注册面相当于公开 API。
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "codex-autoresearch",
    version: "0.1.0"
  });
  const handlers = createMcpHandlers();

  server.tool("run_task", "运行一个直接任务并持久化状态。", RunTaskSchema, async (input) => handlers.runTaskTool(input));

  server.tool("run_skill", "运行一个仓库内 skill 配方。", RunSkillSchema, async (input) => handlers.runSkillTool(input));

  server.tool("resume_session", "续跑已有 session 或最近一次任务。", ResumeSchema, async (input) => handlers.resumeSessionTool(input));

  server.tool("get_session_status", "读取已有任务状态。", StatusSchema, async (input) => handlers.getSessionStatusTool(input));

  server.tool("route_chat_intent", "根据当前聊天意图自动判断继续当前目录任务、创建新任务或运行显式 skill。", RouteChatIntentSchema, async (input) =>
    handlers.routeChatIntentTool(input)
  );

  server.tool("list_skills", "列出仓库内可用 skills。", {}, async () => handlers.listSkillsTool());

  return server;
}

/**
 * 业务职责：以 stdio 方式启动 MCP 服务，方便本地桌面客户端或外部 agent 直接连接本项目能力。
 *
 * 示例：
 * - 插件 `.mcp.json` 会通过 `node ./dist/src/cli.js mcp serve` 连到这里。
 * - 命令行里运行 `codex-autoresearch mcp serve` 时，也是同一条链路。
 */
export async function serveMcp(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * 业务职责：统一包裹 MCP tool 执行过程，让所有错误都输出为稳定 JSON，而不是把 SDK 异常直接暴露给调用方。
 *
 * 解决的问题：
 * - 对外调用方最怕“有时报 JSON，有时报异常文本”。
 * - 这里把异常统一转成失败 payload，外部 agent 才能稳定判断是否可重试。
 */
async function handleTool(run: () => Promise<TextContentResponse>) {
  try {
    return await run();
  } catch (error) {
    return presentMcpJson(presentFailurePayload(error));
  }
}
