"""积分服务：所有加分/扣分都走 grant_points()，避免业务侧自行写入流水。

设计要点：
  1. 同一事件多次回调时，依赖 dedupe_key 的 UNIQUE 约束兜底，不重复入账。
  2. daily_limit 在事务内 SELECT 当日同 (user, rule) 数量再判断，避免并发超额发分。
  3. 所有写入与 user_point_summary 更新在调用方事务内完成，不单独 commit；
     由调用方决定 commit 时机，保证业务-积分原子性（业务回滚则积分也回滚）。
  4. category 跟随规则定义，便于汇总（training/course/reading/paper/exam/manual）。
  5. 历史数据不补算：只在新事件触发时调用本服务。
"""
from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .models import PointRule, PointTransaction, UserPointSummary

logger = logging.getLogger("app.points_service")


# 类别 → summary 字段名
_CATEGORY_FIELDS: dict[str, str] = {
    "training": "training_points",
    "course": "course_points",
    "reading": "reading_points",
    "paper": "paper_points",
    "exam": "exam_points",
    "manual": "manual_points",
}


async def _load_rule(db: AsyncSession, code: str) -> PointRule | None:
    result = await db.execute(select(PointRule).where(PointRule.code == code))
    return result.scalar_one_or_none()


async def _ensure_summary(db: AsyncSession, user_id: int) -> UserPointSummary:
    row = await db.get(UserPointSummary, user_id)
    if row is None:
        row = UserPointSummary(user_id=user_id)
        db.add(row)
        await db.flush()
    return row


async def _count_today(db: AsyncSession, user_id: int, rule_code: str) -> int:
    """统计该用户当天该规则已成功入账次数（不含失败/重复）。"""
    today_start = datetime.combine(date.today(), datetime.min.time())
    stmt = select(func.count(PointTransaction.id)).where(
        PointTransaction.user_id == user_id,
        PointTransaction.rule_code == rule_code,
        PointTransaction.created_at >= today_start,
    )
    result = await db.execute(stmt)
    return int(result.scalar() or 0)


async def grant_points(
    db: AsyncSession,
    *,
    user_id: int,
    rule_code: str,
    business_type: str = "",
    business_id: int | None = None,
    dedupe_extra: str = "",
    remark: str = "",
    points_override: int | None = None,
    operator_id: int | None = None,
) -> dict[str, Any]:
    """统一加分入口。

    返回 {"granted": bool, "points": int, "reason": str, "transaction_id": int | None}。
    granted=False 时表示因规则禁用 / 重复 dedupe / 超日上限 而跳过；调用方一般无需关心。
    """
    rule = await _load_rule(db, rule_code)
    if rule is None:
        return {"granted": False, "points": 0, "reason": "rule_not_found", "transaction_id": None}
    if not rule.enabled and rule_code != "manual_adjust":
        # manual_adjust 即使禁用也允许（但通常我们不会禁用 manual_adjust）
        return {"granted": False, "points": 0, "reason": "rule_disabled", "transaction_id": None}

    points = int(points_override) if points_override is not None else int(rule.points or 0)
    if points == 0 and rule_code != "manual_adjust":
        return {"granted": False, "points": 0, "reason": "zero_points", "transaction_id": None}

    # 日上限校验（仅对自动入账有意义；手动调分不限）
    if rule.daily_limit and rule.daily_limit > 0 and rule_code != "manual_adjust":
        already = await _count_today(db, user_id, rule_code)
        if already >= rule.daily_limit:
            return {"granted": False, "points": 0, "reason": "daily_limit", "transaction_id": None}

    dedupe_parts = [rule_code, f"u{user_id}"]
    if business_id is not None:
        dedupe_parts.append(f"b{int(business_id)}")
    if dedupe_extra:
        dedupe_parts.append(dedupe_extra)
    dedupe_key = ":".join(dedupe_parts)[:255]

    # 先用 SELECT 探一次：避免 INSERT 冲突后污染外层事务（外层 commit 还要继续走业务）
    existed = await db.execute(
        select(PointTransaction.id).where(PointTransaction.dedupe_key == dedupe_key)
    )
    if existed.scalar_one_or_none() is not None:
        logger.debug("grant_points dedupe hit user=%s rule=%s key=%s", user_id, rule_code, dedupe_key)
        return {"granted": False, "points": 0, "reason": "duplicate", "transaction_id": None}

    category = (rule.category or "").strip().lower()

    tx = PointTransaction(
        user_id=int(user_id),
        rule_code=rule_code,
        category=category,
        points=points,
        business_type=business_type or "",
        business_id=int(business_id) if business_id is not None else None,
        dedupe_key=dedupe_key,
        remark=remark or "",
        operator_id=int(operator_id) if operator_id is not None else None,
    )
    db.add(tx)
    try:
        # 用 SAVEPOINT 包裹 flush，防止极偶发的并发冲突把外层业务事务搞坏
        async with db.begin_nested():
            await db.flush()
    except IntegrityError:
        logger.debug(
            "grant_points concurrent dedupe user=%s rule=%s key=%s",
            user_id, rule_code, dedupe_key,
        )
        return {"granted": False, "points": 0, "reason": "duplicate", "transaction_id": None}

    summary = await _ensure_summary(db, user_id)
    summary.total_points = int(summary.total_points or 0) + points
    field_name = _CATEGORY_FIELDS.get(category)
    if field_name:
        setattr(summary, field_name, int(getattr(summary, field_name) or 0) + points)
    summary.last_event_at = datetime.now()
    await db.flush()

    return {"granted": True, "points": points, "reason": "ok", "transaction_id": int(tx.id)}


async def record_reading_streak(db: AsyncSession, *, user_id: int, checkin_date: date) -> dict[str, Any]:
    """记录读书打卡 streak：若达到 7/30/60... 给奖励规则发放积分。

    返回 {"streak_days": int, "rewarded": ["reading_streak_7", ...]}。
    一天多次调用幂等（基于 last_checkin_date 比较）。
    """
    summary = await _ensure_summary(db, user_id)
    last = summary.last_checkin_date
    if last == checkin_date:
        return {"streak_days": int(summary.streak_days or 0), "rewarded": []}

    if last is not None and (checkin_date - last).days == 1:
        new_streak = int(summary.streak_days or 0) + 1
    else:
        new_streak = 1
    summary.streak_days = new_streak
    summary.last_checkin_date = checkin_date
    if new_streak > int(summary.max_streak_days or 0):
        summary.max_streak_days = new_streak
    await db.flush()

    rewarded: list[str] = []
    # 7 天 / 30 天奖励：达到时一次性发放（用 dedupe_extra 保证同次连续仅一次）
    streak_milestones = [(7, "reading_streak_7"), (30, "reading_streak_30")]
    for milestone, code in streak_milestones:
        if new_streak == milestone:
            res = await grant_points(
                db,
                user_id=user_id,
                rule_code=code,
                business_type="reading_streak",
                business_id=None,
                dedupe_extra=f"streak{milestone}-end{checkin_date.isoformat()}",
                remark=f"连续打卡 {milestone} 天",
            )
            if res.get("granted"):
                rewarded.append(code)

    return {"streak_days": new_streak, "rewarded": rewarded}


async def get_user_total(db: AsyncSession, user_id: int) -> int:
    row = await db.get(UserPointSummary, user_id)
    return int(row.total_points) if row else 0
