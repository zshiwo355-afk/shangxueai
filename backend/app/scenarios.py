"""场景种子：每次 start 时随机抽一份，喂给 LLM 让 hidden_training_pack 拉开差异。

不依赖 DB —— 都是内置维度。后期可以放到 config_options 里让管理员维护。
"""
from __future__ import annotations

import random


GENDERS = ["男", "女"]

AGE_RANGES = [
    "28-32 岁",
    "33-38 岁",
    "38-45 岁",
    "45-55 岁",
    "55-65 岁",
]

OCCUPATIONS = [
    "私企老板",
    "国企中层管理",
    "公务员",
    "事业单位中层",
    "个体户老板",
    "餐饮店老板",
    "酒店采购",
    "婚庆策划",
    "工程项目经理",
    "工厂主",
    "贸易公司高管",
    "退休干部",
    "中学教师",
    "医生",
    "律师",
    "金融从业者",
    "互联网公司中层",
    "媒体从业者",
    "建材老板",
    "汽贸销售经理",
    "物流公司老板",
    "快消品代理商",
]

CITIES = [
    "北京",
    "上海",
    "广州",
    "深圳",
    "成都",
    "重庆",
    "杭州",
    "南京",
    "苏州",
    "武汉",
    "长沙",
    "西安",
    "郑州",
    "济南",
    "青岛",
    "天津",
    "厦门",
    "福州",
    "合肥",
    "南昌",
    "昆明",
    "南宁",
    "石家庄",
    "贵阳",
    "兰州",
    "太原",
    "沈阳",
    "大连",
]

APPROACH_SOURCES = [
    "朋友介绍",
    "朋友圈看到广告",
    "微信群推荐",
    "现场路过门店",
    "婚宴现场被介绍",
    "上次商务接待用过这款",
    "短视频被种草",
    "公司团购名单里看到",
    "代理渠道朋友推荐",
    "客户在电话里咨询",
]

PAIN_POINTS = [
    "更看重健康（少添加、低度、对身体负担小）",
    "更看重送礼面子（包装、品牌、档次）",
    "更看重性价比（要折扣、要赠品）",
    "更看重正品保证（怕假货）",
    "更看重品牌历史与文化沉淀",
    "更看重口感与香型",
    "更看重酒桌仪式感和敬酒话题",
    "更看重未来升值潜力（藏酒）",
]

BUDGETS = [
    "200-300 元/瓶",
    "300-500 元/瓶",
    "500-800 元/瓶",
    "800-1500 元/瓶",
    "1500-3000 元/瓶",
    "3000-5000 元/瓶",
    "整箱采购、单瓶 300-500 元",
    "整箱采购、单瓶 600-1000 元",
    "整箱采购、单瓶 1000-2000 元",
]

PERSONALITIES = [
    "比较内敛、问得多、话不多",
    "性子比较急、说话直",
    "热情但反复砍价",
    "比较挑剔、要求专业回答",
    "决策快、要面子、不愿被还价",
    "犹豫纠结、需要反复确认",
    "嘴硬心软、需要被说服",
    "讲究原则、不喜欢被推销",
    "喜欢聊酒文化、聊天为主",
    "懂行、懂酒、问的都是行家问题",
]

# 场景：使用场景的具体情境（让客户更有"故事"）
OCCASIONS = [
    "下个月女儿婚宴，要订 6-10 桌的酒",
    "公司答谢老客户，年底要发 30 份礼盒",
    "陪老婆给丈母娘过 70 大寿，要带两瓶过去",
    "下周接待外地总公司领导，准备一桌酒席用",
    "朋友圈看到推荐，先买一两瓶自己喝喝看",
    "公司订单回款庆祝，想犒劳一下团队",
    "回老家走亲戚，给二爷和大伯各买几瓶",
    "重要客户来谈合作，桌上要拿得出手的酒",
    "自己一个人晚上偶尔小酌一两口",
    "和高中同学聚会，AA 制每人凑一瓶",
    "丈母娘退休，老婆叮嘱必须买点像样的",
    "朋友开了新店，过去捧场要带两瓶硬通货",
]


def random_scenario_seed() -> dict:
    """为本次训练 / 考试生成一份独立的场景种子。

    8 个维度的笛卡尔积约 ~150 万种组合，配合 LLM 自由发挥，
    实际场景重复率接近 0。"""
    return {
        "gender": random.choice(GENDERS),
        "age_range": random.choice(AGE_RANGES),
        "occupation": random.choice(OCCUPATIONS),
        "city": random.choice(CITIES),
        "approach": random.choice(APPROACH_SOURCES),
        "pain_focus": random.choice(PAIN_POINTS),
        "budget": random.choice(BUDGETS),
        "personality": random.choice(PERSONALITIES),
        "occasion": random.choice(OCCASIONS),
    }


def format_scenario_block(seed: dict) -> str:
    """把种子格式化成一段 prompt 文本，可以直接拼到 user_prompt 里。"""
    if not seed:
        return ""
    return (
        "【本次训练独立生成的场景种子（每次都会变，用于避免训练同质化，必须严格遵循）】\n"
        f"- 客户性别：{seed.get('gender', '')}\n"
        f"- 年龄段：{seed.get('age_range', '')}\n"
        f"- 职业身份：{seed.get('occupation', '')}\n"
        f"- 所在城市：{seed.get('city', '')}\n"
        f"- 接触你的方式：{seed.get('approach', '')}\n"
        f"- 个性风格：{seed.get('personality', '')}\n"
        f"- 主要关注点：{seed.get('pain_focus', '')}\n"
        f"- 预算区间：{seed.get('budget', '')}\n"
        f"- 真实使用场景：{seed.get('occasion', '')}\n"
        "请把以上种子完整、自然地融入 hidden_training_pack（customer_profile、budget、objection_pool 等），"
        "并在 first_customer_message 里隐含体现（不要把『种子』二字直接说出来）。"
        "训练全程客户的语气、细节、关心的点都必须与种子一致，不可漂移。"
    )
