/**
 * 业务职责：MCP 服务层把本仓库暴露成可被外部 agent 调用的任务执行服务。
 * 只暴露一个工具：run_task（阻塞直到完成，期间发送进度心跳防止客户端超时）。
 */
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ServerNotification } from "@modelcontextprotocol/sdk/types.js";
import { runDirectTask } from "../application/use-cases.js";
import { presentFailurePayload, presentMcpJson, type TextContentResponse } from "../presenters/json.js";

const HEARTBEAT_INTERVAL_MS = 15_000;

const RunTaskSchema = {
  task: z.string().min(1).describe(
    "任务内容。如果用户给了文件路径，先用自己的工具读取文件全文，把全文原样粘贴到这里。" +
    "不要自己总结、改写、添加额外指令。worker 会原样收到这段话并独立执行。"
  ),
  workdir: z.string().optional().describe("任务执行的工作目录绝对路径，默认为 MCP server 的 cwd"),
  stateDir: z.string().optional().describe("状态目录根路径，默认为 workdir/.codex-run"),
  maxAttempts: z.number().int().positive().optional().describe("最大尝试轮次，达到后停止自动 resume，status 变为 needs_resume")
};

export interface McpHandlers {
  runTaskTool: (input: { task: string; workdir?: string; stateDir?: string; maxAttempts?: number }, onProgress?: (status: { attempt: number; lastMessage: string }) => void) => Promise<TextContentResponse>;
}

export function createMcpHandlers(): McpHandlers {
  return {
    async runTaskTool(input, onProgress) {
      return handleTool(async () =>
        presentMcpJson(
          await runDirectTask({
            task: input.task,
            workdir: input.workdir,
            stateDir: input.stateDir,
            maxAttempts: input.maxAttempts,
            fireAndForget: false,
            onProgress
          })
        )
      );
    }
  };
}

export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "codex-autoresearch",
    version: "0.1.0"
  });
  const handlers = createMcpHandlers();

  server.tool(
    "run_task",
    [
      "启动后台永动机任务，阻塞直到任务完成后返回最终结果。",
      "调用期间聊天会被阻塞，你不需要（也无法）做任何事情，等待返回即可。",
      "任务可能需要几分钟到几十分钟，这是正常的。",
      "",
      "调用规则（必须遵守）：",
      "1. 如果用户给了文件路径，先读取文件全文，把全文原样作为 task 传入。不要自己总结、改写、添加目标描述。",
      "2. 直接调用，不要先读仓库代码、分析结构、做研究。worker 有自己的能力去做这些。",
      "3. 一个任务只调用一次 run_task。",
      "4. 不要传 model/profile 等参数，worker 使用自己的默认配置。",
      "5. 你的角色是传话筒：用户说什么 → 原样传给 worker → 等结果。不要加戏。"
    ].join("\n"),
    RunTaskSchema,
    async (input, extra) => {
      const progressToken = extra._meta?.progressToken;

      // 心跳：每 15 秒发一次通知，防止 MCP 客户端 120s 超时断开。
      // 优先用 progress notification（需要 progressToken），同时也发 logging notification（无需 token）。
      let heartbeatCount = 0;
      const heartbeat = setInterval(() => {
        heartbeatCount++;
        // logging notification 不依赖 progressToken，任何 MCP 客户端都应该能收到。
        extra.sendNotification({
          method: "notifications/message" as const,
          params: { level: "info", data: `task still running (heartbeat #${heartbeatCount})`, logger: "codex-autoresearch" }
        } as ServerNotification).catch(() => {});

        if (progressToken !== undefined) {
          extra.sendNotification({
            method: "notifications/progress" as const,
            params: { progressToken, progress: heartbeatCount, total: 0 }
          } as ServerNotification).catch(() => {});
        }
      }, HEARTBEAT_INTERVAL_MS);

      // 真实进度回调：每轮 codex 退出时触发。
      const onProgress = (status: { attempt: number; lastMessage: string }) => {
        const message = `attempt ${status.attempt} done`;
        extra.sendNotification({
          method: "notifications/message" as const,
          params: { level: "info", data: message, logger: "codex-autoresearch" }
        } as ServerNotification).catch(() => {});

        if (progressToken !== undefined) {
          extra.sendNotification({
            method: "notifications/progress" as const,
            params: {
              progressToken,
              progress: status.attempt,
              total: input.maxAttempts ?? 0,
              message: status.lastMessage.slice(0, 200)
            }
          } as ServerNotification).catch(() => {});
        }
      };

      try {
        return await handlers.runTaskTool(input, onProgress);
      } finally {
        clearInterval(heartbeat);
      }
    }
  );

  return server;
}

export async function serveMcp(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

async function handleTool(run: () => Promise<TextContentResponse>) {
  try {
    return await run();
  } catch (error) {
    return presentMcpJson(presentFailurePayload(error));
  }
}
