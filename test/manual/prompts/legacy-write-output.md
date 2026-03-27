# Real E2E Legacy Write Prompt

你现在是在 `codex-autoresearch` 仓库里执行一个真实兼容链路测试。

任务要求：

1. 允许创建一个测试产物文件：`test/manual/output/legacy-result.md`。
2. 不要修改仓库内任何现有源码文件。
3. 读取当前仓库 `README.md` 的标题。
4. 读取当前仓库 `package.json` 的包名。
5. 把结果写入 `test/manual/output/legacy-result.md`，内容固定为两行：
   - 第 1 行：README 标题。
   - 第 2 行：`包名：<name>；入口：direct task、run、skill、session、mcp、app、legacy。`
6. 写完后自行检查该文件内容是否符合要求。
7. 完成后严格按当前任务自带的完成协议结束，不要额外输出解释。
