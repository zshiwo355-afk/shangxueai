#!/usr/bin/env bash
# 生产启动脚本（Linux）
# 用法：
#   1) cd 到 backend 目录
#   2) 首次运行先：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
#   3) 检查并修改同目录下的 .env（特别是 JWT_SECRET、DB_DSN）
#   4) bash scripts/run_prod.sh
#
# 默认监听 0.0.0.0:8000，4 个 worker。前端 dist 由 FastAPI 静态托管，无需 nginx 也能跑。

set -e
cd "$(dirname "$0")/.."

HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-4}"

if [ -x ".venv/bin/python" ]; then
  PY=".venv/bin/python"
else
  echo "[warn] backend/.venv 不存在，回退到系统 Python。建议先：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt" >&2
  PY="python3"
fi

mkdir -p uploads/magic_academy/videos uploads/magic_academy/audios

exec "$PY" -m uvicorn app.main:app \
  --host "$HOST" \
  --port "$PORT" \
  --workers "$WORKERS" \
  --proxy-headers \
  --forwarded-allow-ips='*'
