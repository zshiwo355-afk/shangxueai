# MaxKB 接入与规则加载方案

> 规则与提示词全部存放在 MaxKB 知识库；后端只在 `RuleLoader` 中按 `RULE_ID` 检索、缓存与召回。代码入口：[backend/app/rule_loader.py](backend/app/rule_loader.py)、[backend/app/maxkb.py](backend/app/maxkb.py)。

## 一、知识库导入

将 `01_MaxKB知识库文档_全部导入` 中所有 Markdown 文件导入同一个 MaxKB 知识库。

建议分段：

- 按 Markdown 标题分段。
- 单段 800-1200 字。
- 重叠 100-200 字。
- 召回数量 8-15。
- 相似度阈值 0.3-0.5 起步（生效配置见 `MAXKB_RULE_TOP_K` / `MAXKB_RULE_SIMILARITY` / `MAXKB_KNOWLEDGE_TOP_K` / `MAXKB_KNOWLEDGE_SIMILARITY`）。

环境变量（`backend/.env`，默认值见 [backend/app/config.py](backend/app/config.py)）：

```env
MAXKB_BASE_URL=
MAXKB_API_KEY=
MAXKB_KB_ID=
MAXKB_WORKSPACE_ID=default
MAXKB_TIMEOUT_SECONDS=60
MAXKB_RULE_TOP_K=8
MAXKB_RULE_SIMILARITY=0.3
MAXKB_KNOWLEDGE_TOP_K=12
MAXKB_KNOWLEDGE_SIMILARITY=0.3
```

## 二、按 RULE_ID 检索

`RuleLoader.get(rule_id)` 使用统一查询语：

```text
请从知识库中检索 RULE_ID: {rule_id} 的完整文档。
必须返回该规则的完整内容，尤其是 PROMPT_TEMPLATE 或规则正文。
不要总结，不要改写。
```

命中段落按相似度排序后拼接 `content` 返回；命中段落为空会打 warning，但不阻塞流程。

## 三、启动时预热的 RULE_ID

代码常量 `KNOWN_RULE_IDS`（与本节内容一致）：

- `KB_INDEX`
- `SALES_SOP_STANDARD`
- `KNOWLEDGE_FIRST_PURCHASE`
- `KNOWLEDGE_REPURCHASE`
- `KNOWLEDGE_BRAND_PRODUCT_CULTURE`
- `KNOWLEDGE_OBJECTION_HANDLING`
- `RULE_TRAINING_FLOW`
- `RULE_AI_CUSTOMER_SIMULATION`
- `RULE_EMOTION_UPDATE`
- `RULE_STAGE_MACHINE`
- `RULE_DEAL_DECISION`
- `RULE_SCORING_RUBRIC`
- `RULE_REVIEW_OUTPUT`
- `RULE_COMPLIANCE`
- `RULE_CUSTOMER_PROFILE_QUESTION_BANK`
- `PROMPT_PREPARE_TRAINING_PACK`
- `PROMPT_CUSTOMER_CHAT`
- `PROMPT_ROUND_SCORING`
- `PROMPT_FINAL_REVIEW`
- `PROMPT_JSON_OUTPUT_FORMAT`
- `PROMPT_RULE_EXECUTOR`

应用启动钩子在 [backend/app/main.py](backend/app/main.py) `_preload_rules()` 中调用 `rule_loader.reload_all()`，并打印加载条数。

## 四、缓存策略

- 后端启动时一次性预热全部 `KNOWN_RULE_IDS`。
- 每个 `RULE_ID` 进程内缓存一份字符串。
- 知识库更新后调用 `POST /api/rules/reload` 清缓存并重新拉取。
- 对话过程中不重复加载规则，确保单轮延迟可控。
- 多 worker 部署时各进程各自缓存，无需共享。

## 五、业务知识召回策略

按训练类型召回（`KNOWLEDGE_RULES_BY_TRAINING`）：

| 训练类型 | 召回的知识 RULE_ID |
| --- | --- |
| 初购转化 | `SALES_SOP_STANDARD`、`KNOWLEDGE_FIRST_PURCHASE`、`KNOWLEDGE_OBJECTION_HANDLING`、`KNOWLEDGE_BRAND_PRODUCT_CULTURE` |
| 复购转化 | `SALES_SOP_STANDARD`、`KNOWLEDGE_REPURCHASE`、`KNOWLEDGE_OBJECTION_HANDLING`、`KNOWLEDGE_BRAND_PRODUCT_CULTURE` |
| 全链路成交 | 上述全部 |

通用知识召回走 `RuleLoader.retrieve_knowledge(query)`，参数 `top_k` / `similarity` 对应 `MAXKB_KNOWLEDGE_TOP_K` / `MAXKB_KNOWLEDGE_SIMILARITY`。

## 六、不要让 MaxKB 直接管所有状态

MaxKB 只负责规则与销售知识，不负责：

- session、`round_count`、`chat_history`、`completed_actions`；
- 试卷 / 通关 / 派发 / 推送 / 同步等业务持久化；
- 工程级硬校验（成交阈值、最小轮次、结果合法性）。

这些一律由 FastAPI 管理，落库表和接口见 [02_后端接口设计.md](02_后端接口设计.md) 与 [03_后端状态机与数据结构.md](03_后端状态机与数据结构.md)。

## 七、常见排查

- `MAXKB_KB_ID` 未配置：`RuleLoader.get` 抛 `MaxKBError("未配置 MAXKB_KB_ID...")`，前端会拿到 503。
- 命中段落为空：日志打 `rule_loader: {rid} 在 MaxKB 中没有命中任何段落`，需要检查 KB 内是否真的存在 `RULE_ID`，或者相似度阈值是否过高。
- 接口超时：调大 `MAXKB_TIMEOUT_SECONDS` 或检查 MaxKB 服务连通性；`MaxKBClient` 使用共享 httpx，超时由 `Settings` 控制。
- 调试单条规则：`POST /api/rules/reload` 后看日志 `rule_loader preloaded N rules`，以及对应规则的命中段落数。
