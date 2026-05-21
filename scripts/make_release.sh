#!/usr/bin/env bash
# 在项目根目录运行：bash scripts/make_release.sh
# 产物：dist-shangxue-YYYYMMDD-HHMM.zip
# 内容：backend 源码 + sql + dist + .env + 部署脚本 + DEPLOY.md
# 已排除：node_modules、.venv、__pycache__、.git、uploads 里的实际媒体文件

set -e
cd "$(dirname "$0")/.."

STAMP=$(date +%Y%m%d-%H%M)
OUT="dist-shangxue-${STAMP}.zip"

if [ ! -d "frontend/dist" ]; then
  echo "[!] frontend/dist 不存在，请先 cd frontend && npm run build" >&2
  exit 1
fi

if [ ! -f "backend/.env" ]; then
  echo "[!] backend/.env 不存在，请先按 .env.example 创建" >&2
  exit 1
fi

# 清理 __pycache__
find backend -name "__pycache__" -type d -prune -exec rm -rf {} +

zip -r "$OUT" \
  DEPLOY.md \
  backend/app \
  backend/sql \
  backend/scripts \
  backend/requirements.txt \
  backend/.env \
  backend/.env.example \
  backend/uploads/.keep \
  frontend/dist \
  -x "backend/.venv/*" \
     "**/__pycache__/*" \
     "backend/uploads/magic_academy/*"

echo
echo "=== 打包完成：$OUT ==="
unzip -l "$OUT" | tail -20
