# MaxKB 接入与规则加载方案

## 一、知识库导入

将 `01_MaxKB知识库文档_全部导入` 中所有 Markdown 文件导入同一个 MaxKB 知识库。

建议分段：
- 按 Markdown 标题分段；
- 单段 800-1200 字；
- 重叠 100-200 字；
- 召回数量 8-15；
- 相似度阈值 0.3-0.5 起步。

## 二、按 RULE_ID 检索

后端 RuleLoader 使用统一查询：

```text
请从知识库中检索 RULE_ID: {rule_id} 的完整文档。
必须返回该规则的完整内容，尤其是 PROMPT_TEMPLATE 或规则正文。
不要总结，不要改写。
```

## 三、建议启动时加载的规则

应用启动时或第一次请求时加载：

- KB_INDEX
- SALES_SOP_STANDARD
- KNOWLEDGE_FIRST_PURCHASE
- KNOWLEDGE_REPURCHASE
- KNOWLEDGE_BRAND_PRODUCT_CULTURE
- KNOWLEDGE_OBJECTION_HANDLING
- RULE_TRAINING_FLOW
- RULE_AI_CUSTOMER_SIMULATION
- RULE_EMOTION_UPDATE
- RULE_STAGE_MACHINE
- RULE_DEAL_DECISION
- RULE_SCORING_RUBRIC
- RULE_REVIEW_OUTPUT
- RULE_COMPLIANCE
- RULE_CUSTOMER_PROFILE_QUESTION_BANK
- PROMPT_PREPARE_TRAINING_PACK
- PROMPT_CUSTOMER_CHAT
- PROMPT_ROUND_SCORING
- PROMPT_FINAL_REVIEW
- PROMPT_JSON_OUTPUT_FORMAT
- PROMPT_RULE_EXECUTOR

## 四、缓存策略

推荐：
- 后端启动加载规则到内存；
- 每个 RULE_ID 缓存一份；
- 知识库更新后调用 `/api/rules/reload`；
- 对话过程中不要每轮重新加载规则。

## 五、业务知识召回策略

训练开始时，根据训练类型召回：

初购：
- SALES_SOP_STANDARD
- KNOWLEDGE_FIRST_PURCHASE
- KNOWLEDGE_OBJECTION_HANDLING
- KNOWLEDGE_BRAND_PRODUCT_CULTURE

复购：
- SALES_SOP_STANDARD
- KNOWLEDGE_REPURCHASE
- KNOWLEDGE_OBJECTION_HANDLING
- KNOWLEDGE_BRAND_PRODUCT_CULTURE

全链路：
- 全部销售知识。

## 六、不要让 MaxKB 直接管所有状态

MaxKB 负责规则和知识，不负责：
- session；
- round_count；
- chat_history；
- completed_actions；
- final hard check。

这些由 FastAPI 管理。
