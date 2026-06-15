# RULE_ID 索引与知识库总说明

RULE_ID: KB_INDEX  
DOC_TYPE: index  
VERSION: 2026-06-11  
PRIORITY: 100  
适用阶段: 全局  
关键词: 索引, RULE_ID, 知识库说明, MaxKB, 规则中心, Prompt中心

## 一、知识库定位

本知识库用于“白酒销售AI陪练系统”。

系统目标：AI 扮演合规的成年客户，新人作为销售进行多轮对话训练。系统基于新人表现、客户状态、成交证据和合规情况输出“成交”“意向客户”或“未成交”，并给出 0-100 分复盘。建议完整训练 10 轮，但 10 轮不是成交或复盘的硬性门槛。

本知识库同时承担三类职责：

1. 销售知识库：提供销售 SOP、初购、复购、品牌产品、白酒文化、异议处理知识。
2. 规则中心：提供训练流程、阶段状态机、情绪变化、成交判断、评分、复盘、合规规则。
3. Prompt 配置中心：提供准备训练包、AI客户对话、每轮评分、最终复盘、JSON输出格式等 Prompt 模板。

## 二、后端检索方式

后端应按 RULE_ID 精准检索规则文档，例如：

> 请返回 RULE_ID: PROMPT_PREPARE_TRAINING_PACK 的完整文档，尤其是 PROMPT_TEMPLATE 部分。不要总结，不要改写。

每个文档开头都包含：
- RULE_ID
- DOC_TYPE
- VERSION
- PRIORITY
- 适用阶段
- 关键词

## 三、RULE_ID 清单

### 销售知识类

- SALES_SOP_STANDARD：销售 SOP 标准流程
- KNOWLEDGE_FIRST_PURCHASE：初购转化训练知识
- KNOWLEDGE_REPURCHASE：复购转化训练知识
- KNOWLEDGE_BRAND_PRODUCT_CULTURE：品牌产品与白酒文化知识
- KNOWLEDGE_OBJECTION_HANDLING：客户异议处理知识

### 规则类

- RULE_TRAINING_FLOW：训练流程规则
- RULE_AI_CUSTOMER_SIMULATION：AI客户模拟规则
- RULE_EMOTION_UPDATE：客户情绪变化规则
- RULE_STAGE_MACHINE：阶段状态机规则
- RULE_DEAL_DECISION：成交与意向判断规则
- RULE_SCORING_RUBRIC：评分维度与分值规则
- RULE_REVIEW_OUTPUT：复盘输出规则
- RULE_COMPLIANCE：合规表达与禁用规则
- RULE_CUSTOMER_PROFILE_QUESTION_BANK：客户画像与题库生成规则

### Prompt 模板类

- PROMPT_PREPARE_TRAINING_PACK：准备训练包 Prompt
- PROMPT_CUSTOMER_CHAT：AI客户对话 Prompt
- PROMPT_ROUND_SCORING：每轮评分 Prompt
- PROMPT_FINAL_REVIEW：最终复盘 Prompt
- PROMPT_JSON_OUTPUT_FORMAT：JSON输出格式规则
- PROMPT_RULE_EXECUTOR：知识库规则执行器 Prompt

## 四、冲突优先级

当知识库规则出现冲突时，按以下优先级执行：

1. 合规规则 RULE_COMPLIANCE
2. 成交与意向判断 RULE_DEAL_DECISION
3. 评分规则 RULE_SCORING_RUBRIC
4. 训练流程 RULE_TRAINING_FLOW
5. Prompt 模板
6. 销售知识

## 五、成年人合规边界

本系统仅用于成年人销售员工内部培训。AI 客户必须为成年人。训练中不得鼓励未成年人购买或饮酒，不得诱导过量饮酒，不得承诺酒有医疗、保健、养生、治疗功效，不得鼓励酒驾或不安全饮酒。 
