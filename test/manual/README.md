# 手工真实测试目录

这个目录的业务职责是统一承接“需要真实 `codex`、真实状态目录、真实长任务链路”的手工联调素材。

这样做的原因：

1. 过去把 `prompt.md` 或状态目录直接放在仓库根目录时，很容易和正式源码混在一起。
2. 真实长任务会生成 `latest-job.txt`、`meta.json`、`runner.log`、`events.jsonl` 等大量运行时文件，
   这些文件对排障很有价值，但不应该成为常规源码提交的一部分。
3. 把“可复用的测试素材”和“只用于这一次验证的运行态产物”分开后，后续任何人接手项目都能立刻看懂：
   - 哪些文件是测试模板，应该保留
   - 哪些文件是运行垃圾，应该忽略

目录约定：

```text
test/manual/
├── README.md
├── prompts/   # 版本化保留的真实测试 prompt 模板
├── runtime/   # 真实执行时写入的状态目录，已忽略
└── output/    # 真实测试产生的验证文件，已忽略
```

推荐用法示例：

```bash
WORKDIR=$(pwd) \
STATE_DIR=$(pwd)/test/manual/runtime/legacy-readonly \
./codex-keep-running.sh ./test/manual/prompts/legacy-readonly.md
```

如果需要验证任务产物是否真的生成，推荐让任务写入：

```text
test/manual/output/
```

例如：

```bash
WORKDIR=$(pwd) \
STATE_DIR=$(pwd)/test/manual/runtime/legacy-write-output \
./codex-keep-running.sh ./test/manual/prompts/legacy-write-output.md
```

然后再检查：

```bash
sed -n '1,20p' ./test/manual/output/legacy-result.md
```

如果你要验证“同一任务被拆成多轮，外部守护链路能否持续 resume”，也统一使用 `prompts/` 里的分阶段提示词，
并把产物写到 `test/manual/output/continue-three-phase/` 这类子目录里，而不是再在仓库根目录新建临时测试目录。
