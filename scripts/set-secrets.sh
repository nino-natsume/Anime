#!/usr/bin/env bash
# 设置 GitHub Secrets: Cloudflare 凭据 + 部署所需的运行时 secret
# 用法: bash scripts/set-secrets.sh <your-github-repo>

set -euo pipefail

REPO="${1:?用法: bash scripts/set-secrets.sh <owner/repo>}"

# 需要 gh CLI
if ! command -v gh >/dev/null 2>&1; then
  echo "错误: 未安装 GitHub CLI (gh), 请先安装: https://cli.github.com/"
  exit 1
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "请先登录 gh: gh auth login"
  exit 1
fi

# 读取本地不入库凭据文件 (含 Cloudflare 凭据)
LOCAL_FILE=".cloudflare.local"
if [ ! -f "$LOCAL_FILE" ]; then
  echo "错误: 未找到 $LOCAL_FILE (请先创建并填入凭据)"
  exit 1
fi

set +e
ACCOUNT_ID=$(grep '^CLOUDFLARE_ACCOUNT_ID=' "$LOCAL_FILE" | head -1 | cut -d= -f2-)
API_TOKEN=$(grep '^CLOUDFLARE_API_TOKEN=' "$LOCAL_FILE" | head -1 | cut -d= -f2-)
set -e

set_secret() {
  local name="$1" value="$2"
  if [ -n "$value" ]; then
    echo "$value" | gh secret set "$name" --repo "$REPO"
    echo "  ✅ $name 已写入"
  else
    echo "  ⚠️  $name 为空, 跳过"
  fi
}

echo "正在写入 GitHub Secrets 到 $REPO ..."

# Cloudflare 凭据 (来自 .cloudflare.local)
set_secret "CLOUDFLARE_ACCOUNT_ID" "$ACCOUNT_ID"
set_secret "CLOUDFLARE_API_TOKEN" "$API_TOKEN"

# 部署时由 build-config.js 组装 wrangler.toml 所需的真实值
read -rsp "请输入 D1_DATABASE_ID (回车跳过): " D1_ID; echo
set_secret "D1_DATABASE_ID" "$D1_ID"

read -rsp "请输入 KV_NAMESPACE_ID (回车跳过): " KV_ID; echo
set_secret "KV_NAMESPACE_ID" "$KV_ID"

read -rsp "请输入 SITE_URL (回车跳过): " SITE; echo
set_secret "SITE_URL" "$SITE"

read -rsp "请输入 GITHUB_CLIENT_ID (回车跳过): " GH_ID; echo
set_secret "GITHUB_CLIENT_ID" "$GH_ID"

read -rsp "请输入 GITHUB_CLIENT_SECRET (回车跳过): " GH_SECRET; echo
set_secret "GITHUB_CLIENT_SECRET" "$GH_SECRET"

read -rsp "请输入 JWT_SECRET (回车跳过): " JWT; echo
set_secret "JWT_SECRET" "$JWT"

read -rsp "请输入 STREAM_API_URL (可选, 回车跳过): " STREAM; echo
set_secret "STREAM_API_URL" "$STREAM"

read -rsp "请输入 STREAM_ANIKOTO_URL (可选, 回车跳过): " STREAM2; echo
set_secret "STREAM_ANIKOTO_URL" "$STREAM2"

echo ""
echo "全部完成! 每次 Action 部署时会:"
echo "  1. 在 job 内随机生成一次性密钥"
echo "  2. 从上述 Secrets 读取真实值并执行双重加密"
echo "  3. 组装临时 wrangler.toml 后部署, 结束后删除"
echo ""
echo "现在 push 到 main 即可自动部署:"
echo "  git push origin main"