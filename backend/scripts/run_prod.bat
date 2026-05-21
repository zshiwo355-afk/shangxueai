@echo off
REM 生产启动脚本（Windows 服务器）
REM 默认监听 0.0.0.0:8000，4 个 worker。前端 dist 由 FastAPI 静态托管。
REM
REM 用法：
REM   1) 首次运行先：python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
REM   2) 检查并修改同目录下的 .env（特别是 JWT_SECRET、DB_DSN）
REM   3) scripts\run_prod.bat

cd /d %~dp0\..

if not defined HOST    set HOST=0.0.0.0
if not defined PORT    set PORT=8000
if not defined WORKERS set WORKERS=4

if not exist uploads\magic_academy\videos mkdir uploads\magic_academy\videos
if not exist uploads\magic_academy\audios mkdir uploads\magic_academy\audios

if exist .venv\Scripts\python.exe (
  .venv\Scripts\python.exe -m uvicorn app.main:app --host %HOST% --port %PORT% --workers %WORKERS% --proxy-headers --forwarded-allow-ips=*
) else (
  echo [warn] backend\.venv not found, falling back to system Python.
  python -m uvicorn app.main:app --host %HOST% --port %PORT% --workers %WORKERS% --proxy-headers --forwarded-allow-ips=*
)
