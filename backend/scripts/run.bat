@echo off
REM 自动用 backend\.venv 启动；如果 venv 不存在会回退到系统 Python（并提示）。
REM --reload-exclude .sessions/*：避免 session 落盘触发后端自重启
cd /d %~dp0\..
if exist .venv\Scripts\python.exe (
    .venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000 --reload-exclude ".sessions/*" --reload-exclude ".cache/*"
) else (
    echo [warn] backend\.venv 不存在，回退到系统 Python。建议先运行：python -m venv .venv ^&^& .venv\Scripts\pip install -r requirements.txt
    python -m uvicorn app.main:app --reload --port 8000 --reload-exclude ".sessions/*" --reload-exclude ".cache/*"
)
