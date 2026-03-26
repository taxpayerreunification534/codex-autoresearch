#!/usr/bin/env bash
set -Eeuo pipefail

# 业务职责：
# - 这个兼容层保留旧版 `prompt.md -> shell` 的调用方式，避免现有脚本、cron 和人工习惯直接失效。
# - 真正的长任务执行、session 续跑和完成协议已经迁移到 TypeScript CLI，这里只做最薄的一层转发。
# - 如果仓库还没 build，则优先尝试现成 dist；开发态下允许用本地 tsx 直连源码，方便迭代。

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
DIST_CLI="$SCRIPT_DIR/dist/src/cli.js"

# 业务职责：对外继续保留旧版用法，方便老入口无缝迁移到新的统一 CLI。
usage() {
  printf 'Usage: %s <prompt_file | ->\n' "${0##*/}" >&2
  printf 'Example: %s ./prompt.md\n' "${0##*/}" >&2
  printf 'Example: cat ./prompt.md | WORKDIR=/repo %s -\n' "${0##*/}" >&2
  exit 1
}

# 业务职责：优先使用构建产物，保证 npm 安装后的开源发布入口稳定可执行。
run_dist() {
  exec node "$DIST_CLI" legacy "$@"
}

# 业务职责：开发态下允许直接走 tsx 源码入口，避免调试时必须先手动 build。
run_tsx() {
  if command -v npx >/dev/null 2>&1; then
    exec npx --yes tsx "$SCRIPT_DIR/src/cli.ts" legacy "$@"
  fi

  printf 'ERROR: dist CLI not found and npx is unavailable. Please run npm install && npm run build first.\n' >&2
  exit 1
}

main() {
  [[ $# -eq 1 ]] || usage

  if [[ -f "$DIST_CLI" ]]; then
    run_dist "$@"
  fi

  run_tsx "$@"
}

main "$@"
