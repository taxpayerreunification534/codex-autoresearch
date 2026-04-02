# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-04-02

### 核心亮点

首次正式发布！本项目从一个简单的 Bash 脚本演化为完整的 TypeScript/Node 长任务执行框架，支持 CLI、MCP server、Codex 插件、仓库 Skills 四种接入方式。

### Added

- **TypeScript CLI 核心**：从 Bash 脚本迁移到 TypeScript，提供稳定的命令行入口
  - `codex-autoresearch "任务"` - 直接执行任务
  - `codex-autoresearch session resume --last` - 恢复最近任务
  - `codex-autoresearch skill run <name>` - 运行仓库 skill
  - `codex-autoresearch mcp serve` - 启动 MCP server
  - `codex-autoresearch app` - 在 Codex Desktop 打开当前目录

- **MCP Server**：暴露 6 个工具供外部 agent/插件调用
  - `run_task` - 执行任务
  - `run_skill` - 运行 skill
  - `resume_session` - 恢复 session
  - `get_session_status` - 查询状态
  - `list_skills` - 列出 skills
  - `route_chat_intent` - 聊天意图路由

- **Codex 插件**：支持聊天窗内三种触发方式
  - `/codex-autoresearch` - slash 命令
  - 自然语言触发
  - 显式 skill 名触发

- **仓库 Skills**：可复用任务配方
  - `research` - 通用 research 和交叉核对
  - `phased-validation` - 分阶段长任务执行与验收

- **Session 恢复**：支持 `--last` 和指定 session id 续跑

- **兼容层**：保留旧 `codex-keep-running.sh` 入口，内部转调新 CLI

### Changed

- 执行引擎下沉为共享层，支持多入口复用
- 状态目录统一为 `.codex-run/<job-id>/`
- 插件入口改为 MCP-first，统一走 `route_chat_intent`

### Fixed

- 修复符号链接路径解析问题，支持全局安装
