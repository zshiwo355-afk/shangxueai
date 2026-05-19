# 整体实现方案：FastAPI + React + MaxKB

## 一、最终架构

本项目采用：

- MaxKB：标准知识库、规则中心、Prompt 配置中心。
- FastAPI：流程执行器、状态管理器、规则加载器、JSON 校验器。
- React：训练配置页、模拟聊天页、复盘页。
- LLM：执行知识库中的 Prompt，生成训练包、客户回复、每轮评分和最终复盘。

核心原则：

> 业务规则、提示词、评分规则全部放知识库；后端只做执行和校验。

## 二、系统模块

### 1. MaxKB 知识库

只导入 `01_MaxKB知识库文档_全部导入` 里的 Markdown 文件。

不再导入原始 PDF/PPT/Excel。

知识库包含：
- 销售知识；
- 训练规则；
- 判分规则；
- 成交判断规则；
- Prompt 模板；
- JSON 输出规则。

### 2. FastAPI 后端

职责：
- 维护 session；
- 维护 round_count；
- 维护 chat_history；
- 维护 hidden_training_pack；
- 从 MaxKB 按 RULE_ID 加载规则；
- 缓存规则；
- 调用 LLM 执行 Prompt；
- 校验 JSON；
- 做工程级硬校验。

### 3. React 前端

页面：
- 训练准备页；
- 模拟聊天页；
- 最终复盘页。

不展示隐藏客户画像、预算、成交条件、完整评分标准。

## 三、核心流程

### 训练开始

1. 用户选择训练类型、难度、客户类型；
2. FastAPI 调 MaxKB 加载准备训练包相关规则；
3. FastAPI 召回对应销售知识；
4. LLM 生成 visible_brief、hidden_training_pack、first_customer_message；
5. 后端保存 session；
6. 前端进入聊天页。

### 每轮对话

1. 新人输入回复；
2. 后端记录；
3. LLM 按 PROMPT_ROUND_SCORING 打本轮分；
4. 后端更新情绪、阶段、已完成动作；
5. LLM 按 PROMPT_CUSTOMER_CHAT 生成客户下一句；
6. 后端 round_count + 1；
7. 前端展示客户回复。

### 训练结束

1. 前端调用 finish；
2. 后端检查 round_count；
3. 后端加载最终复盘规则；
4. LLM 生成复盘 JSON；
5. 后端执行硬校验；
6. 前端展示结果。

## 四、后端必须硬校验

虽然业务规则在知识库，但后端必须做以下工程级硬校验：

1. `round_count` 只能由后端计算；
2. 未满 10 轮不能成交；
3. `result` 只能是“成交”或“未成交”；
4. JSON 必须合法；
5. session 不存在要返回错误；
6. 严重合规风险必须不能成交；
7. 前端永远不能拿到 hidden_training_pack。

## 五、第一版不做的功能

第一版不做：
- 登录；
- 数据库；
- 历史训练记录；
- 用户上传资料；
- 多租户；
- 后台权限；
- 复杂报表。

第一版先完成：
- 单知识库；
- 单用户会话；
- 可训练 10 轮以上；
- 能复盘打分。
