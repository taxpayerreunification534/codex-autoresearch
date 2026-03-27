# Real E2E Legacy Prompt

你现在是在 `codex-autoresearch` 仓库里执行一个真实兼容链路测试。

任务要求：

1. 不要修改任何文件。
2. 只读取当前仓库的 `README.md` 标题。
3. 再读取 `package.json` 中的包名。
4. 最终只输出两行：
   - 第 1 行输出 README 标题。
   - 第 2 行输出一句中文总结，格式固定为：`包名：<name>；入口：direct task、run、skill、session、mcp、app、legacy。`
5. 完成后严格按当前任务自带的完成协议结束，不要额外输出解释。
