#!/usr/bin/env bash
# 构建前端并同步静态产物到服务器。
#
#   ./deploy-frontend.sh
#   SERVER=47.108.60.176 TARGET=/var/www/team-tasks ./deploy-frontend.sh
#   DRY_RUN=1 ./deploy-frontend.sh     # 只打印会改动的文件
#
# 需要本机具备到服务器的 SSH 权限。注意：会用 rsync --delete 清掉目标目录里
# dist 之外的多余文件（包括旧的 app.js / styles.css），别指向共用目录。
set -euo pipefail

SERVER="${SERVER:-47.108.60.176}"
USER_NAME="${USER_NAME:-root}"
TARGET="${TARGET:-/var/www/team-tasks}"
PORT="${PORT:-22}"
NODE_BIN="${NODE_BIN:-node}"

cd "$(dirname "$0")"

echo "==> 构建 dist"
"$NODE_BIN" node_modules/vite/bin/vite.js build

if [ ! -f dist/index.html ]; then
  echo "构建失败：dist/index.html 不存在" >&2
  exit 1
fi

RSYNC_OPTS=(-az --delete --human-readable)
if [ "${DRY_RUN:-0}" = "1" ]; then
  RSYNC_OPTS+=(--dry-run --itemize-changes)
  echo "==> DRY_RUN：只预览，不写入"
fi

echo "==> 同步到 ${USER_NAME}@${SERVER}:${TARGET}"
rsync "${RSYNC_OPTS[@]}" -e "ssh -p ${PORT}" dist/ "${USER_NAME}@${SERVER}:${TARGET}/"

echo "==> 完成：http://${SERVER}/"
