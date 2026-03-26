/**
 * 业务职责：MCP 服务层把本仓库暴露成可被外部 agent 调用的任务执行服务，
 * 让 run task、run skill、resume 和状态查询都通过统一执行引擎完成。
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { getTaskStatus, listAvailableSkills, resumeExistingTask, routeChatIntent, runDirectTask, runSkillTask } from "../application/use-cases.js";
import { presentFailurePayload, presentMcpJson, type TextContentResponse } from "../presenters/json.js";

const RunTaskSchema = {
  task: z.string().min(1),
  workdir: z.string().optional(),
  stateDir: z.string().optional(),
  model: z.string().optional(),
  profile: z.string().optional(),
  maxAttempts: z.number().int().positive().optional()
};

const RunSkillSchema = {
  skillName: z.string().min(1),
  inputs: z.record(z.string(), z.string()).optional(),
  workdir: z.string().optional(),
  stateDir: z.string().optional(),
  model: z.string().optional(),
  interactive: z.boolean().optional(),
  maxAttempts: z.number().int().positive().optional()
};

const ResumeSchema = {
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  useLast: z.boolean().optional(),
  stateDir: z.string().optional(),
  maxAttempts: z.number().int().positive().optional()
};

const StatusSchema = {
  sessionId: z.string().optional(),
  jobId: z.string().optional(),
  useLast: z.boolean().optional(),
  stateDir: z.string().optional()
};

const RouteChatIntentSchema = {
  chatIntent: z.string().min(1),
  chatSummary: z.string().optional(),
  workdir: z.string().optional(),
  stateDir: z.string().optional(),
  model: z.string().optional(),
  profile: z.string().optional(),
  maxAttempts: z.number().int().positive().optional()
};

export interface McpHandlers {
  runTaskTool: (input: { task: string; workdir?: string; stateDir?: string; model?: string; profile?: string; maxAttempts?: number }) => Promise<TextContentResponse>;
  runSkillTool: (input: { skillName: string; inputs?: Record<string, string>; workdir?: string; stateDir?: string; model?: string; interactive?: boolean; maxAttempts?: number }) => Promise<TextContentResponse>;
  resumeSessionTool: (input: { sessionId?: string; jobId?: string; useLast?: boolean; stateDir?: string; maxAttempts?: number }) => Promise<TextContentResponse>;
  getSessionStatusTool: (input: { sessionId?: string; jobId?: string; useLast?: boolean; stateDir?: string }) => Promise<TextContentResponse>;
  routeChatIntentTool: (input: { chatIntent: string; chatSummary?: string; workdir?: string; stateDir?: string; model?: string; profile?: string; maxAttempts?: number }) => Promise<TextContentResponse>;
  listSkillsTool: () => Promise<TextContentResponse>;
}

/**
 * 业务职责：抽出 MCP 工具处理器，便于在不启动 stdio server 的情况下直接做契约测试。
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

  server.tool("route_chat_intent", "根据当前聊天意图自动判断继续当前目录任务还是创建新任务。", RouteChatIntentSchema, async (input) =>
    handlers.routeChatIntentTool(input)
  );

  server.tool("list_skills", "列出仓库内可用 skills。", {}, async () => handlers.listSkillsTool());

  return server;
}

/**
 * 业务职责：以 stdio 方式启动 MCP 服务，方便本地桌面客户端或外部 agent 直接连接本项目能力。
 */
export async function serveMcp(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * 业务职责：统一包裹 MCP tool 执行过程，让所有错误都输出为稳定 JSON，而不是把 SDK 异常直接暴露给调用方。
 */
async function handleTool(run: () => Promise<TextContentResponse>) {
  try {
    return await run();
  } catch (error) {
    return presentMcpJson(presentFailurePayload(error));
  }
}
