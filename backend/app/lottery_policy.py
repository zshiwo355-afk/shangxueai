"""Current lottery policy, without rewriting historical allocations or outcomes."""
from __future__ import annotations

import re

from .models import LotteryInviteLink


SINGLE_DRAW_LIMIT = 1


def remaining_link_chances(link: LotteryInviteLink) -> int:
    """A legacy allocation never authorizes a second draw under today's policy."""
    allocated = max(int(link.chance_total or 0), 0)
    used = max(int(link.chance_used or 0), 0)
    return max(min(allocated, SINGLE_DRAW_LIMIT) - used, 0)


# Only recognize short Chinese names/titles; never publish free-form customer
# notes, phone numbers, company names or identifiers as a supposed nickname.
_SHORT_NAME = re.compile(r"^([\u4e00-\u9fff]{1,4}?)(先生|女士)?$")
_NON_PERSON_LABEL_PARTS = ("公司", "商行", "酒业", "集团", "客户", "门店", "中心", "团队", "测试", "店")
_COMPOUND_SURNAMES = frozenset({
    "欧阳", "司马", "上官", "诸葛", "夏侯", "东方", "皇甫", "尉迟", "公孙", "慕容",
    "令狐", "司徒", "司空", "长孙", "宇文", "端木", "独孤", "南宫", "闻人",
})
_SURNAMES = frozenset(
    "赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜"
    "戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳酆鲍史唐"
    "费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄"
    "和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁"
    "杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍"
    "虞万支柯昝管卢莫经房裘缪干解应宗丁宣邓郁单杭洪包左石崔吉龚程邢裴"
    "陆荣翁荀羊甄封芮储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗"
    "班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿"
    "白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴胥能苍双闻莘党翟谭贡劳逄姬申扶"
    "堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹"
    "习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃"
    "利蔚越夔隆师巩厍聂晁勾敖融冷辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯"
    "相查后荆红游竺权逯盖益桓公"
)


def winner_display_name(customer_name: str | None) -> str:
    text = (customer_name or "").strip()
    if any(part in text for part in _NON_PERSON_LABEL_PARTS):
        return "幸运客户"
    match = _SHORT_NAME.fullmatch(text)
    if not match:
        return "幸运客户"
    name, title = match.groups()
    surname = name[:2] if name[:2] in _COMPOUND_SURNAMES else name[:1]
    if surname not in _COMPOUND_SURNAMES and surname not in _SURNAMES:
        return "幸运客户"
    return f"{surname}{title or '先生'}"
