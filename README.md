# codex-autoresearch

一个围绕 Codex CLI 的永动机包装器：开一个 codex 对话把任务给它，模型干一部分活停了，自动 resume 同一个对话说"继续"，循环直到全部做完。

## 工作流程

以用户在 Claude Code 对话框输入以下内容为例：

> 使用 codex-autoresearch MCP 工具完成这个 /Users/wang/.../12-58章写作规划.md 规划

```
用户对话框                         Claude Code (宿主 Agent)                     codex-autoresearch MCP                        Codex CLI (Worker)
    |                                      |                                           |                                              |
    |  "使用 MCP 完成这个规划"              |                                           |                                              |
    | -----------------------------------> |                                           |                                              |
    |                                      |                                           |                                              |
    |                                      |  1. 读取 .md 文件内容                     |                                              |
    |                                      |  2. 调用 run_task(task=文件内容)           |                                              |
    |                                      | ----------------------------------------> |                                              |
    |                                      |                                           |                                              |
    |                                      |    （聊天被阻塞，宿主无法做其他事情）       |                                              |
    |                                      |                                           |                                              |
    |                                      |                                           |  ensureJobMetadata                            |
    |                                      |                                           |  创建 .codex-run/<job-id>/meta.json           |
    |                                      |                                           |                                              |
    |                                      |                                           |  ========== runLoop 开始 ==========           |
    |                                      |                                           |                                              |
    |                                      |                                           |  buildInitialPrompt:                          |
    |                                      |                                           |    任务文本                                    |
    |                                      |                                           |    + 执行边界(2行)                             |
    |                                      |                                           |    + completion protocol                      |
    |                                      |                                           |                                              |
    |                                      |                                           |  codex exec --full-auto <prompt>              |
    |                                      |                                           | -------------------------------------------> |
    |                                      |                                           |                                              |  开始写第12-15章...
    |                                      |                                           |                                              |  context 用完 / 惰性停止
    |                                      |                                           |  <-- exit code 0 --------------------------> |
    |                                      |                                           |                                              |
    |                                      |                                           |  检查 last-message.txt                        |
    |                                      |                                           |  没有匹配 completion protocol                 |
    |                                      |                                           |  等 3 秒                                      |
    |                                      |                                           |                                              |
    |                                      |                                           |  codex exec resume <session-id> "继续"         |
    |                                      |                                           | -------------------------------------------> |
    |                                      |                                           |                                              |  接着写第16-20章...
    |                                      |                                           |                                              |  又停了
    |                                      |                                           |  <-- exit ---------------------------------> |
    |                                      |                                           |                                              |
    |                                      |                                           |  ... 重复 N 轮 ...                            |
    |                                      |                                           |                                              |
    |                                      |                                           |  <-- exit ---------------------------------> |
    |                                      |                                           |  检查 last-message.txt                        |
    |                                      |                                           |  匹配 completion protocol 或 maxAttempts      |
    |                                      |                                           |  status -> completed / needs_resume           |
    |                                      |                                           |                                              |
    |                                      |  <-- 返回 {status: completed, lastMessage} |                                              |
    |  <-- "全部完成，12-58章已写好"         |                                           |                                              |
    |                                      |                                           |                                              |
```

**关键设计**：
- 宿主 Agent 只是控制面——读文件、调 MCP，不自己做研究
- MCP 层阻塞模式——调用后聊天卡住，完成后才释放，宿主无法重复创建任务或越俎代庖
- 永动机核心循环：`codex exec` → 退出 → `codex exec resume "继续"` → 退出 → 循环
- resume prompt 就一个字——"继续"，不塞行为约束，不重复任务描述

## 安装

```bash
npm install
npm run build
```

全局安装：

```bash
npm install -g .
codex-autoresearch --help
```

## 最推荐路径：prompt.md + CLI

站在目标项目目录里，准备好一个 prompt.md 文件，然后：

```bash
codex-autoresearch --prompt-file ./prompt.md
# 或
codex-autoresearch run --prompt-file ./prompt.md
```

也可以直接传任务文本：

```bash
codex-autoresearch "请检查当前仓库 TODO，补齐缺失测试并更新 README"
```

## MCP 路径

启动 MCP server：

```bash
codex-autoresearch mcp serve
```

### MCP 工具集

| 工具 | 说明 |
| --- | --- |
| `run_task` | 启动永动机任务，阻塞直到完成后返回最终结果 |

调用后聊天会被阻塞，宿主不需要（也无法）做任何其他事情，等待返回即可。任务可能需要几分钟到几十分钟。

推荐主路径示例：

```json
{
  "tool": "run_task",
  "arguments": {
    "task": "（完整任务描述文本）"
  }
}
```

返回 `jobId`、`sessionId`、`stateDir`、`status`、`lastMessageFile`。

## .codex-run 状态模型

统一执行引擎会把状态写到：

```text
.codex-run/<job-id>/
```

典型文件：

| 文件 | 作用 |
| --- | --- |
| `meta.json` | 任务元信息、状态、配置、prompt 来源 |
| `events.jsonl` | Codex JSON 事件流 |
| `runner.log` | 执行日志和错误输出 |
| `last-message.txt` | 最近一轮 assistant 最终输出 |
| `session-id.txt` | 从事件流提取的 session id |

`meta.json` 中记录的 prompt 来源字段：

| 字段 | 说明 |
| --- | --- |
| `promptSource` | `"file"` / `"text"` / `"skill"` |
| `sourcePromptFile` | 原始 prompt 文件绝对路径（仅 `promptSource: "file"` 时有值） |

## 恢复、查看状态、tail

```bash
# 恢复最近一次任务
codex-autoresearch session resume --last

# 查看最近任务状态
codex-autoresearch session status --last

# 按 session id 继续
codex-autoresearch session resume <session-id>
```

## Skills

仓库自带的任务配方，遵循：

```text
skills/<name>/skill.yaml
skills/<name>/prompt.md
```

列出可用 skills：

```bash
codex-autoresearch skill list
```

运行 skill：

```bash
codex-autoresearch skill run research --set topic=...
```

## Shell 薄包装 codex-keep-running.sh

```bash
./codex-keep-running.sh ./prompt.md
cat ./prompt.md | ./codex-keep-running.sh -
```

环境变量：

| 变量 | 作用 |
| --- | --- |
| `WORKDIR` | 实际执行目录 |
| `STATE_DIR` | 状态根目录 |
| `INTERVAL` | 重试间隔 |
| `MODEL` | 模型 |
| `PROFILE` | profile |
| `USE_FULL_AUTO` | 是否开启 `--full-auto` |
| `DANGEROUSLY_BYPASS` | 是否启用危险绕过模式 |
| `SKIP_GIT_REPO_CHECK` | 是否跳过 git 校验 |
| `START_WITH_RESUME_IF_POSSIBLE` | 是否优先从历史状态恢复 |
| `CONFIRM_TEXT` | 自定义完成确认文本 |

## Completion Protocol

执行引擎要求 Codex 在真正完成时严格输出两行：

1. 基于 nonce 反转后的 done token
2. `CONFIRMED: all tasks completed`

只有完全匹配两行且没有第三行，任务才会被标记为 `completed`。

## 测试

```bash
npm test
```
