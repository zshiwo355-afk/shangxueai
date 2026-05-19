# ShangxueAI · 销售陪练

酒类销售陪练 AI 项目 V1。技术栈：FastAPI + React + MaxKB + LLM（OpenAI 兼容协议）。

## 项目结构

```
ShangxueAI/
├── 02_项目实现方案/      # 6 份方案 md（已有）
├── backend/              # FastAPI 后端
│   ├── app/
│   ├── requirements.txt
│   ├── .env.example
│   └── scripts/run.bat
└── frontend/             # React 前端（Ant Design 6 + Vite）
    ├── package.json
    ├── vite.config.js
    └── src/
```

## 前置条件

1. 在 MaxKB 后台创建知识库，导入 `01_MaxKB知识库文档_全部导入/` 下的 Markdown 文件（详见方案 05）。
2. 准备 LLM API Key（默认走 ofox 网关 OpenAI 兼容协议）。

## 启动后端

```powershell
cd backend
copy .env.example .env
# 编辑 .env：填好 MAXKB_BASE_URL / MAXKB_KB_ID / MAXKB_API_KEY / MAXKB_ADMIN_USERNAME / MAXKB_ADMIN_PASSWORD（或 MAXKB_SYSTEM_API_KEY）和 LLM_API_KEY
pip install -r requirements.txt
scripts\run.bat
```

后端启动后默认在 `http://127.0.0.1:8000`。

健康检查：`GET /api/health`
规则预热：启动时自动；手动触发 `POST /api/rules/reload`

## 启动前端

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://127.0.0.1:5173`。Vite 已经配置好 `/api` 代理到 `127.0.0.1:8000`。

## 接口

- `POST /api/training/start` 选训练类型 → 创建 session、生成训练包与客户首句
- `POST /api/training/chat` 单轮对话（评分 + 客户回复）
- `POST /api/training/finish` 复盘
- `POST /api/training/reset` 重置到开场
- `POST /api/rules/reload` 清缓存重新预热规则
- `GET /api/health`

## V1 不做

- 登录 / JWT / 用户表（占位字段已留 `AUTH_ENABLED`）
- 数据库持久化历史训练
- 多租户、后台管理
- SSE 流式（普通 JSON 响应即可）
- 移动端
