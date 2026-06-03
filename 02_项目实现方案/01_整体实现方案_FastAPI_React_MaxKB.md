# 整体实现方案：FastAPI + React + MaxKB

> 本文档反映当前仓库实际形态，已不再是"第一版"。系统已扩展为多业务、多端、与企业微信深度对接的怀仁商学院综合平台。

## 一、最终架构

本项目采用：

- **MaxKB**：销售知识库、训练规则中心、Prompt 配置中心。
- **FastAPI**：流程执行器、多业务 API（训练 / 通关 / 试卷 / 魔学院 / 用户 / 推送）、规则加载器、JSON 校验器、企业微信对接层。
- **React + Vite + Ant Design**：用户端学习/考试页、管理端后台、企业微信内嵌登录回调页。
- **MySQL**：业务数据持久化（用户、试卷、提交、训练记录、推送日志、企微同步批次等）。
- **LLM**：执行知识库 Prompt，生成训练包、客户回复、每轮评分、最终复盘、AI 评分。
- **企业微信**：扫码登录、应用消息推送、通讯录同步。

核心原则：

> 业务规则、提示词、评分规则全部放知识库；后端只做执行、校验、状态机推进与数据落库。

## 二、系统模块

### 1. MaxKB 知识库

只导入 `01_MaxKB知识库文档_全部导入` 里的 Markdown 文件（销售知识、训练规则、判分规则、成交判断规则、Prompt 模板、JSON 输出规则）。后端启动时 `RuleLoader` 按 `RULE_ID` 预热到内存。

### 2. FastAPI 后端

后端目录：[backend/app](backend/app)

主要模块（路由聚合在 [backend/app/main.py](backend/app/main.py)）：

| 模块 | 职责 |
| --- | --- |
| [auth.py](backend/app/auth.py) | 账号密码登录 + 企业微信 OAuth 登录，签发 JWT |
| [users_api.py](backend/app/users_api.py) | 用户 CRUD、批量导入/删除、员工同步预览/执行 |
| [training_api.py](backend/app/training_api.py) | 销售训练 start/chat/finish/reset |
| [exams_api.py](backend/app/exams_api.py) | 场景通关创建、批量派发、复核 |
| [papers_api.py](backend/app/papers_api.py) | 题库试卷管理（草稿/发布/批量改状态） |
| [paper_assignments_api.py](backend/app/paper_assignments_api.py) | 试卷派发、提交、评分、企微推送 |
| [question_bank_api.py](backend/app/question_bank_api.py) | 题库 CRUD |
| [magic_academy_api/](backend/app/magic_academy_api) | 魔学院视频 / 读物 / 音频打卡 / 测验 |
| [materials_api.py](backend/app/materials_api.py) | 素材库 |
| [training_records_api.py](backend/app/training_records_api.py) | 训练历史与管理端记录查询 |
| [notifications_api.py](backend/app/notifications_api.py) | 推送监控（列表/详情/统计/批量删除） |
| [notification_service.py](backend/app/notification_service.py) | 业务通知统一入口（试卷派发/截止/通关派发等） |
| [wecom_client.py](backend/app/wecom_client.py) / [wecom_auth.py](backend/app/wecom_auth.py) / [wecom_push.py](backend/app/wecom_push.py) | 企业微信基础调用 / 登录 / 推送 |
| [wecom_push_bulk.py](backend/app/wecom_push_bulk.py) | 批量推送编排 |
| [employee_sync.py](backend/app/employee_sync.py) / [employee_open_client.py](backend/app/employee_open_client.py) | 第三方 HR 通讯录拉取与本地用户绑定（含 `wecom_sync_batches` / `wecom_sync_entries` 审计） |
| [deadline_reminder_worker.py](backend/app/deadline_reminder_worker.py) | 试卷/通关临近截止提醒后台任务 |
| [paper_ai_worker.py](backend/app/paper_ai_worker.py) | 主观题 AI 评分后台任务 |
| [magic_push_service.py](backend/app/magic_push_service.py) / [magic_auto_actions.py](backend/app/magic_auto_actions.py) | 魔学院推送与自动动作 |
| [rule_loader.py](backend/app/rule_loader.py) / [rules_api.py](backend/app/rules_api.py) | MaxKB 规则缓存与 `/api/rules/reload` |
| [chat_pipeline.py](backend/app/chat_pipeline.py) / [state_machine.py](backend/app/state_machine.py) / [session_store.py](backend/app/session_store.py) | 训练状态机与会话存储（DB） |
| [llm.py](backend/app/llm.py) / [maxkb.py](backend/app/maxkb.py) | LLM 与 MaxKB HTTP 客户端 |
| [config.py](backend/app/config.py) | 全局 `Settings`（含企微/MaxKB/LLM/JWT 等） |

启动时还会拉起 4 个常驻后台任务：试卷 AI 评分、魔学院读物推送、截止提醒、魔学院自动动作。员工同步走管理端"预览 → 执行"按需触发，不再有定时同步进程。

### 3. React 前端

前端目录：[frontend/src](frontend/src)

主要页面（路由见 [frontend/src/App.jsx](frontend/src/App.jsx)）：

| 路径 | 页面 | 用途 |
| --- | --- | --- |
| `/login` | LoginPage | 账号密码登录，可探测企微跳转 |
| `/auth/wecom/callback` | WecomCallbackPage | 企微 OAuth 回调，写 token 后跳目标页 |
| `/home` | HomePage | 用户首页 |
| `/workspace/training` | TrainingWorkspacePage | 我的训练工作台 |
| `/train/prepare` | PreparePage | 训练准备页（手动训练入口） |
| `/chat/:sid` | ChatPage | 模拟聊天 |
| `/review/:sid` | ReviewPage | 训练复盘 |
| `/training/records` `/:id` | TrainingHistoryPage / Detail | 训练历史 |
| `/training/challenges` | ChallengeHistoryPage | 通关挑战记录 |
| `/exam/:examId/intro` `/result` | ExamIntroPage / ExamResultPage | 场景通关 |
| `/workspace/magic` | MagicWorkspacePage | 魔学院工作台 |
| `/magic-academy` | MagicAcademyPage | 魔学院学习页 |
| `/papers` | UserPapersListPage | 我的试卷 |
| `/papers/:assignmentId/take` | UserPaperTakePage | 答题 |
| `/papers/submissions/:submissionId` | UserPaperResultPage | 提交结果 |
| `/admin/*` | AdminLayout | 管理后台（用户/题库/试卷/派发/通关/魔学院/素材/选项/推送监控/白名单/训练记录） |

管理端 Tab 集中在 [frontend/src/components/admin/](frontend/src/components/admin/) 与 [frontend/src/components/admin/papers/](frontend/src/components/admin/papers/)，魔学院专项面板在 [frontend/src/components/magicAcademy/](frontend/src/components/magicAcademy/)。

### 4. 企业微信

接入要点：

- 登录：`/api/auth/wecom/start` → 企微授权 → `/api/auth/wecom/callback`，签发系统 JWT 后跳 `/auth/wecom/callback`。
- 推送：`notification_service` 统一入口 + `wecom_push` 发应用消息，所有发送都落 `notification_logs` 留痕。
- 同步：第三方 HR 系统通讯录通过 `employee_sync` 拉取，管理端"预览 → 执行"。HR 数据中已带 `wecom_userid`，因此本地无需再单独跑企微通讯录定时同步。

### 5. 数据库

主表概览（见 [backend/app/models.py](backend/app/models.py)、[backend/sql/full_install.sql](backend/sql/full_install.sql)）：

- 用户与企微：`users`、`user_whitelist`、`wecom_sync_batches`、`wecom_sync_entries`
- 训练与通关：`training_sessions`、`training_records`、`exams`、`exam_attempts`
- 题库与试卷：`question_bank`、`papers`、`paper_questions`、`paper_assignments`、`paper_submissions`、`paper_answers`、`question_import_jobs`
- 魔学院：`magic_videos`、`magic_video_series` / `_items` / `_targets`、`magic_video_quiz_points`、`magic_questions`、`magic_video_progress`、`magic_quiz_answers`、`magic_quiz_point_pass_records`、`magic_video_watch_confirm_settings` / `_logs`、`magic_video_whitelist`、`magic_audio_uploads`、`magic_audio_makeup_settings`、`magic_reading_series` / `_targets`、`magic_reading_contents` / `_targets`、`magic_auto_actions`
- 推送：`notification_logs`、`magic_push_batches`、`magic_push_entries`
- 素材与配置：`material_projects`、`material_assets`、`config_options`

## 三、核心流程

### 3.1 销售训练（mode=training）

1. 用户在准备页选择训练类型 / 难度 / 客户类型。
2. `POST /api/training/start` → 调 MaxKB 拉规则 → LLM 生成 `visible_brief / hidden_training_pack / first_customer_message` → 落 `training_sessions`。
3. 每轮 `POST /api/training/chat`：评分 Prompt + 客户回复 Prompt，更新情绪、阶段、`completed_actions`、`round_count`。
4. `POST /api/training/finish`：复盘 Prompt → JSON 校验 + 成交硬规则 → 落 `training_records`。

### 3.2 场景通关（mode=exam）

1. 管理员批量创建 `exams` 并按用户/部门派发。
2. 用户在 `/exam/:examId/intro` 开始 → 创建 `exam_attempts` → 进入对练。
3. 用户结束后 LLM 生成复盘；管理员可在待复核列表评分。

### 3.3 试卷考试

1. 题库出题 → 组卷 → 发布。
2. `paper_assignments` 给用户派发，可选企微推送。
3. 用户作答 → `paper_submissions` + `paper_answers`。
4. 客观题自动判分；主观题进 `paper_ai_worker` 走 AI 评分；必要时管理员复核。
5. 评分完成通知用户。

### 3.4 魔学院

视频课、视频系列、读物、读物系列、音频打卡、题点测验，按全员 / 部门 / 岗位 / 在职状态 / 指定员工派发；自动动作（如新人入职自动派发）由 `magic_auto_actions` 维护。

### 3.5 企业微信通知

`notification_service` 暴露 `notify_paper_assignment / notify_paper_deadline_reminder / notify_submission_received / notify_exam_assigned / notify_exam_deadline_reminder` 等入口；魔学院相关推送在 `magic_push_service`。所有落 `notification_logs` 后再调 `wecom_push` 发送。

## 四、后端必须硬校验

虽然业务规则在知识库，后端仍坚持工程级硬校验：

1. `round_count` 只能由后端计算，不信任 LLM。
2. 训练未满 `MIN_ROUNDS`（默认 10）不能成交。
3. `result` 只能是 "成交" 或 "未成交"。
4. LLM 输出必须能解析为合法 JSON（`json_repair` 兜底）。
5. session 不存在 / 已结束的请求要拒绝。
6. 严重合规风险一律不能成交。
7. 前端永远不能拿到 `hidden_training_pack`。
8. 试卷成绩、考试结果由后端依规则计算，不接受前端覆盖。
9. 推送和同步动作落库前先做幂等校验，避免重复触达。

## 五、当前已完成与未完成

已完成：

- 完整的销售训练 / 场景通关 / 试卷考试 / 魔学院四条业务线。
- 用户 / 题库 / 试卷 / 派发 / 通关 / 魔学院 / 素材 / 选项 / 推送监控 / 白名单 / 训练记录管理端。
- 企业微信登录、应用消息推送、通讯录同步、推送监控（含批量删除）。
- AI 主观题评分 worker、截止提醒 worker、魔学院读物推送 worker。

后续可继续打磨：

- 多系统统一 SSO（参见 `07_企业微信接入开发文档.md` 第 10 节）。
- 推送策略灰度 / 重试编排 / 退避策略升级。
- 跨业务的统一报表与数据看板。
