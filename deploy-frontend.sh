#!/usr/bin/env bash
# 构建前端并同步静态产物到服务器。
#
#   ./deploy-frontend.sh
#   SERVER=47.108.60.176 TARGET=/var/www/team-tasks ./deploy-frontend.sh
#   SSH_KEY=~/.ssh/pp5ee ./deploy-frontend.sh  # 指定私钥（非交互环境用）
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
SSH_KEY="${SSH_KEY:-}"

cd "$(dirname "$0")"

# --delete 会清空目标目录，禁止指向根目录或系统目录
case "$TARGET" in
  ""|"/"|"/var"|"/usr"|"/etc"|"/root"|"/home"|"/opt"|"/srv")
    echo "拒绝部署到 TARGET=${TARGET}：这个目录不合适，请用 /var/www/team-tasks 这类专用目录" >&2
    exit 1
    ;;
esac
if [ "${TARGET#/}" = "$TARGET" ]; then
  echo "拒绝部署：TARGET 必须是绝对路径（当前 ${TARGET}）" >&2
  exit 1
fi

echo "==> 构建 dist"
"$NODE_BIN" node_modules/vite/bin/vite.js build

if [ ! -f dist/index.html ]; then
  echo "构建失败：dist/index.html 不存在" >&2
  exit 1
fi

# 安全审计要求产物里必须带 CSP；构建插件没跑起来就别发布
if ! grep -q "Content-Security-Policy" dist/index.html; then
  echo "构建产物缺少 Content-Security-Policy，停止发布" >&2
  exit 1
fi

RSYNC_OPTS=(-az --delete --human-readable --chmod=Du=rwx,Dgo=rx,Fu=rw,Fgo=r)
if [ "${DRY_RUN:-0}" = "1" ]; then
  RSYNC_OPTS+=(--dry-run --itemize-changes)
  echo "==> DRY_RUN：只预览，不写入"
fi

# accept-new：首次连接记下主机指纹，之后指纹变了就拒绝，避免中间人悄悄换服务器
SSH_CMD="ssh -p ${PORT} -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=15 -o BatchMode=yes"
if [ -n "$SSH_KEY" ]; then
  SSH_CMD="$SSH_CMD -i $SSH_KEY -o IdentitiesOnly=yes"
fi

echo "==> 同步到 ${USER_NAME}@${SERVER}:${TARGET}"
rsync "${RSYNC_OPTS[@]}" -e "$SSH_CMD" dist/ "${USER_NAME}@${SERVER}:${TARGET}/"

echo "==> 完成：http://${SERVER}/"
