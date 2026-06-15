# Prompt：JSON输出格式规则

RULE_ID: PROMPT_JSON_OUTPUT_FORMAT  
DOC_TYPE: prompt_template  
VERSION: 2026-05-14  
PRIORITY: 100  
适用阶段: 所有模型输出  
关键词: JSON, 输出格式, schema, 校验, 解析

## 通用要求

所有关键工作流输出必须是合法 JSON。

禁止：
- Markdown 代码块；
- JSON 前后解释；
- 注释；
- 多余文本；
- 单引号；
- Python 字典格式；
- undefined、NaN、Infinity。

必须：
- 使用双引号；
- 布尔值使用 true/false；
- 空值使用 null；
- 数组字段即使为空也输出 []；
- 对象字段即使为空也输出 {}；
- 所有 score 使用整数。

## 失败重试提示词

如果模型输出不是合法 JSON，后端可以用以下修复提示词：

“你刚才的输出不是合法 JSON。请严格按照上一次要求的 schema 重新输出一个可被 JSON.parse 解析的 JSON。不要包含 Markdown，不要包含解释文字。”

## 字段缺失处理

如果模型缺字段，后端应：
1. 尝试让模型重试一次；
2. 仍失败则填默认值；
3. 记录错误日志；
4. 不让前端崩溃。

默认值：
- result 默认“未成交”；
- score 默认 0；
- 数组默认 []；
- 布尔默认 false；
- 字符串默认 ""。
