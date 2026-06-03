"""批量推送加速：按"同一份消息"分组，一次企微 API 调用群发给 N 个收件人。

为什么需要它：
  原来的 push_assignment / notify_paper_assignment 是"一个 assignment 一条消息"，
  300 条派发 = 300 次 HTTP 调用，串行下来要分钟级。企微 message/send 本身支持
  touser="u1|u2|..." 一次最多 1000 人，魔学院推送就是这么用的（毫秒级完成全员）。

边界：
  - 单条 push（管理端列表里那个"推"按钮 / wecom_push.push_assignment）保持原路径，
    不受这里影响。
  - 每条 assignment 仍然各自有 wecom_push_status / wecom_push_error / 独立的
    notification_log，便于监控页定位失败。
  - 企微返回的 invaliduser 会被精确映射回对应 assignment，标 failed；其余标 sent。
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from .config import get_settings
from .db import session_scope
from .models import Exam, Paper, PaperAssignment, User
from .notification_service import _frontend_url
from .wecom_client import WecomApiError, WecomClient, WecomPartialFailure
from .notification_service import _create_log, _finalize_log

logger = logging.getLogger("app.wecom_push_bulk")
_settings = get_settings()
_wecom_client = WecomClient()


# ---------------- 试卷批量推送 ----------------


def _paper_message(paper: Paper, deadline: datetime | None) -> tuple[str, str, str]:
    deadline_text = deadline.strftime("%Y-%m-%d %H:%M") if deadline else "不限"
    description = (
        '<div class="gray">试卷任务通知</div>'
        f'<div class="normal">试卷：{paper.title}</div>'
        f'<div class="normal">截止：{deadline_text}</div>'
    )
    return ("你有新的试卷任务", description, _frontend_url("/papers?filter=todo"))


async def bulk_push_paper_assignments(assignment_ids: list[int]) -> dict[str, int]:
    """对一批派发任务做"按试卷 + 截止时间分组"的群发。

    分组键：(paper_id, deadline_at) —— 同一份试卷且截止时间一致的派发，
    消息 title/description 完全一样，可合并成一次企微 API 调用。

    每组流程：
      1. 一次性把分组里所有 user 拼成 touser，一次 send_app_message
      2. 企微返回 invaliduser → 标记对应 assignment 为 failed；其余 sent
      3. 每条 assignment 各自写一条 notification_log（独立事务）

    结果统计：返回 {"sent": x, "failed": y, "skipped": z}
      - sent: 成功的 assignment 数
      - failed: 推送失败的 assignment 数（含 60020 / invaliduser / 网络等）
      - skipped: 跳过的 assignment 数（如离职 / 未绑 wecom_userid / 试卷已删）
    """
    if not assignment_ids:
        return {"sent": 0, "failed": 0, "skipped": 0}
    if not _settings.wecom_push_ready:
        # 整体没启用：把传进来的全部置为 failed 状态写回，方便监控页可见
        return await _mark_all_failed(assignment_ids, error="企业微信推送未启用或配置不完整。")

    sent_total = 0
    failed_total = 0
    skipped_total = 0

    async with session_scope() as db:
        rows = (
            await db.execute(
                select(PaperAssignment).where(PaperAssignment.id.in_(assignment_ids))
            )
        ).scalars().all()
        if not rows:
            return {"sent": 0, "failed": 0, "skipped": len(assignment_ids)}

        paper_ids = sorted({int(r.paper_id) for r in rows})
        user_ids = sorted({int(r.user_id) for r in rows})
        papers = (
            await db.execute(select(Paper).where(Paper.id.in_(paper_ids)))
        ).scalars().all()
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        paper_map = {int(p.id): p for p in papers}
        user_map = {int(u.id): u for u in users}

        # 分组 key：(paper_id, deadline iso) —— 同一封消息内容
        groups: dict[tuple[int, str], list[PaperAssignment]] = {}
        # 离职 / 未绑 / 试卷不存在等，先在分组阶段筛掉，后面单独 finalize
        prefilter_failed: list[tuple[PaperAssignment, str]] = []
        prefilter_skipped: list[PaperAssignment] = []

        for assignment in rows:
            paper = paper_map.get(int(assignment.paper_id))
            user = user_map.get(int(assignment.user_id))
            if paper is None or user is None:
                prefilter_failed.append((assignment, "派发数据不完整（试卷或接收人已删除）。"))
                continue
            if bool(user.disabled):
                # 离职 / 禁用：跟单条 notify_paper_assignment 行为一致——静默跳过
                prefilter_skipped.append(assignment)
                continue
            wecom_userid = (user.wecom_userid or "").strip()
            if not wecom_userid:
                prefilter_failed.append((assignment, "接收人尚未绑定企业微信 userid。"))
                continue
            key = (
                int(assignment.paper_id),
                assignment.deadline_at.isoformat() if assignment.deadline_at else "",
            )
            groups.setdefault(key, []).append(assignment)

        # 1. 处理 prefilter
        for assignment, error in prefilter_failed:
            await _finalize_paper_assignment(db, assignment, status="failed", error=error)
            user = user_map.get(int(assignment.user_id))
            await _write_log_for_assignment(
                assignment=assignment,
                user=user,
                paper=paper_map.get(int(assignment.paper_id)),
                status="failed",
                error=error,
            )
            failed_total += 1

        for assignment in prefilter_skipped:
            # 静默跳过——既不算成功也不算失败，明确写一行日志便于排查
            user = user_map.get(int(assignment.user_id))
            await _finalize_paper_assignment(
                db,
                assignment,
                status="failed",
                error="接收人已离职或被禁用，未推送。",
            )
            await _write_log_for_assignment(
                assignment=assignment,
                user=user,
                paper=paper_map.get(int(assignment.paper_id)),
                status="failed",
                error="接收人已离职或被禁用，未推送。",
            )
            skipped_total += 1

        # 2. 按组群发
        for (paper_id, _deadline_iso), group_assignments in groups.items():
            paper = paper_map[paper_id]
            # 同组的 deadline 一致，用任意一条的即可
            deadline = group_assignments[0].deadline_at
            title, description, url = _paper_message(paper, deadline)

            # touser 去重 + 建立 wecom_userid -> [assignments] 反查表
            userid_to_assignments: dict[str, list[PaperAssignment]] = {}
            ordered_userids: list[str] = []
            for assignment in group_assignments:
                user = user_map[int(assignment.user_id)]
                userid = (user.wecom_userid or "").strip()
                normalized = userid.lower()
                if normalized not in userid_to_assignments:
                    userid_to_assignments[normalized] = []
                    ordered_userids.append(userid)
                userid_to_assignments[normalized].append(assignment)

            # 写 pending 日志（每条 assignment 一条，独立事务）
            log_ids: list[tuple[int, PaperAssignment]] = []
            for assignment in group_assignments:
                user = user_map[int(assignment.user_id)]
                log_id = await _create_log(
                    event_type="paper_assigned",
                    recipient_user_id=int(user.id),
                    recipient_wecom_userid=(user.wecom_userid or "").strip() or None,
                    business_type="paper_assignment",
                    business_id=int(assignment.id),
                    payload={"title": title, "description": description, "url": url},
                )
                log_ids.append((log_id, assignment))

            # 一次群发
            try:
                response = await _wecom_client.send_app_message(
                    touser=ordered_userids,
                    title=title,
                    description=description,
                    url=url,
                )
            except WecomPartialFailure as exc:
                failed_set = {item.lower() for item in exc.failed_userids}
                # 把每个 assignment 按其 userid 是否落在 failed_set 来判定
                for log_id, assignment in log_ids:
                    user = user_map[int(assignment.user_id)]
                    normalized = (user.wecom_userid or "").strip().lower()
                    if normalized in failed_set:
                        await _finalize_log(log_id, status="failed", error=str(exc))
                        await _finalize_paper_assignment(
                            db, assignment, status="failed", error=str(exc)
                        )
                        failed_total += 1
                    else:
                        await _finalize_log(log_id, status="sent", response=exc.detail)
                        await _finalize_paper_assignment(db, assignment, status="sent")
                        sent_total += 1
                continue
            except WecomApiError as exc:
                for log_id, assignment in log_ids:
                    await _finalize_log(log_id, status="failed", error=str(exc))
                    await _finalize_paper_assignment(
                        db, assignment, status="failed", error=str(exc)
                    )
                    failed_total += 1
                logger.warning(
                    "[bulk_paper_push] group send failed paper_id=%s recipients=%d err=%s",
                    paper_id, len(ordered_userids), exc,
                )
                continue
            except Exception as exc:  # noqa: BLE001
                for log_id, assignment in log_ids:
                    await _finalize_log(log_id, status="failed", error=str(exc))
                    await _finalize_paper_assignment(
                        db, assignment, status="failed", error=str(exc)
                    )
                    failed_total += 1
                logger.exception(
                    "[bulk_paper_push] unexpected error paper_id=%s", paper_id,
                )
                continue

            # 全部成功
            for log_id, assignment in log_ids:
                await _finalize_log(log_id, status="sent", response=response)
                await _finalize_paper_assignment(db, assignment, status="sent")
                sent_total += 1

    return {"sent": sent_total, "failed": failed_total, "skipped": skipped_total}


async def _finalize_paper_assignment(
    db: AsyncSession,
    assignment: PaperAssignment,
    *,
    status: str,
    error: str | None = None,
) -> None:
    """更新 paper_assignments 自身的推送状态字段，便于前端列表回显。"""
    assignment.wecom_push_status = status
    assignment.wecom_push_error = error
    assignment.wecom_pushed_at = datetime.now()
    await db.flush()


async def _write_log_for_assignment(
    *,
    assignment: PaperAssignment,
    user: User | None,
    paper: Paper | None,
    status: str,
    error: str,
) -> None:
    """prefilter 阶段把日志补上（独立事务），监控页可见。"""
    title_text = "你有新的试卷任务"
    description_text = ""
    url_text = ""
    if paper:
        deadline = assignment.deadline_at.strftime("%Y-%m-%d %H:%M") if assignment.deadline_at else "不限"
        description_text = (
            '<div class="gray">试卷任务通知</div>'
            f'<div class="normal">试卷：{paper.title}</div>'
            f'<div class="normal">截止：{deadline}</div>'
        )
        url_text = _frontend_url("/papers?filter=todo")
    log_id = await _create_log(
        event_type="paper_assigned",
        recipient_user_id=int(user.id) if user else None,
        recipient_wecom_userid=(user.wecom_userid or "").strip() or None if user else None,
        business_type="paper_assignment",
        business_id=int(assignment.id),
        payload={"title": title_text, "description": description_text, "url": url_text},
    )
    await _finalize_log(log_id, status=status, error=error)


async def _mark_all_failed(assignment_ids: list[int], *, error: str) -> dict[str, int]:
    """整体推送未启用时，把全部 assignment 标 failed 并写日志。"""
    async with session_scope() as db:
        rows = (
            await db.execute(select(PaperAssignment).where(PaperAssignment.id.in_(assignment_ids)))
        ).scalars().all()
        for assignment in rows:
            await _finalize_paper_assignment(db, assignment, status="failed", error=error)
    return {"sent": 0, "failed": len(assignment_ids), "skipped": 0}


# ---------------- AI 通关批量推送 ----------------


def _exam_message(exam: Exam) -> tuple[str, str, str]:
    deadline_text = exam.deadline_at.strftime("%Y-%m-%d %H:%M") if exam.deadline_at else "不限"
    description = (
        '<div class="gray">AI通关任务通知</div>'
        f'<div class="normal">任务：{exam.title}</div>'
        f'<div class="normal">最多尝试：{exam.max_attempts} 次</div>'
        f'<div class="normal">截止：{deadline_text}</div>'
    )
    return ("你有新的AI通关任务", description, _frontend_url("/training/challenges?filter=pending"))


async def bulk_push_exams(exam_ids: Iterable[int]) -> dict[str, int]:
    """AI 通关派发的批量推送。

    分组键：(title, max_attempts, deadline_at) —— 同一批 batch 派发出来的
    通常这三个字段都一样，于是一组 = 一次群发。

    没有 wecom_push_status 字段（exams 表不带这套），所以只写
    notification_logs，结果靠监控页可见。
    """
    ids = sorted({int(i) for i in exam_ids})
    if not ids:
        return {"sent": 0, "failed": 0, "skipped": 0}
    if not _settings.wecom_push_ready:
        # exams 表没有 push_status，直接写 N 条 failed 日志即可
        return await _exam_mark_all_failed(ids, error="企业微信推送未启用或配置不完整。")

    sent_total = 0
    failed_total = 0
    skipped_total = 0

    async with session_scope() as db:
        rows = (
            await db.execute(select(Exam).where(Exam.id.in_(ids)))
        ).scalars().all()
        if not rows:
            return {"sent": 0, "failed": 0, "skipped": len(ids)}

        user_ids = sorted({int(r.user_id) for r in rows})
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        user_map = {int(u.id): u for u in users}

        groups: dict[tuple[str, int, str], list[Exam]] = {}
        prefilter_failed: list[tuple[Exam, str]] = []
        prefilter_skipped: list[Exam] = []

        for exam in rows:
            user = user_map.get(int(exam.user_id))
            if user is None:
                prefilter_failed.append((exam, "派发数据不完整（接收人已删除）。"))
                continue
            if bool(user.disabled):
                prefilter_skipped.append(exam)
                continue
            wecom_userid = (user.wecom_userid or "").strip()
            if not wecom_userid:
                prefilter_failed.append((exam, "接收人尚未绑定企业微信 userid。"))
                continue
            key = (
                exam.title or "",
                int(exam.max_attempts or 0),
                exam.deadline_at.isoformat() if exam.deadline_at else "",
            )
            groups.setdefault(key, []).append(exam)

        for exam, error in prefilter_failed:
            user = user_map.get(int(exam.user_id))
            await _write_log_for_exam(exam=exam, user=user, status="failed", error=error)
            failed_total += 1

        for exam in prefilter_skipped:
            user = user_map.get(int(exam.user_id))
            await _write_log_for_exam(
                exam=exam,
                user=user,
                status="failed",
                error="接收人已离职或被禁用，未推送。",
            )
            skipped_total += 1

        for _key, group_exams in groups.items():
            sample = group_exams[0]
            title, description, url = _exam_message(sample)

            ordered_userids: list[str] = []
            seen: set[str] = set()
            log_ids: list[tuple[int, Exam]] = []
            for exam in group_exams:
                user = user_map[int(exam.user_id)]
                userid = (user.wecom_userid or "").strip()
                normalized = userid.lower()
                if normalized not in seen:
                    seen.add(normalized)
                    ordered_userids.append(userid)
                log_id = await _create_log(
                    event_type="exam_assigned",
                    recipient_user_id=int(user.id),
                    recipient_wecom_userid=userid or None,
                    business_type="exam",
                    business_id=int(exam.id),
                    payload={"title": title, "description": description, "url": url},
                )
                log_ids.append((log_id, exam))

            try:
                response = await _wecom_client.send_app_message(
                    touser=ordered_userids,
                    title=title,
                    description=description,
                    url=url,
                )
            except WecomPartialFailure as exc:
                failed_set = {item.lower() for item in exc.failed_userids}
                for log_id, exam in log_ids:
                    user = user_map[int(exam.user_id)]
                    normalized = (user.wecom_userid or "").strip().lower()
                    if normalized in failed_set:
                        await _finalize_log(log_id, status="failed", error=str(exc))
                        failed_total += 1
                    else:
                        await _finalize_log(log_id, status="sent", response=exc.detail)
                        sent_total += 1
                continue
            except WecomApiError as exc:
                for log_id, _exam in log_ids:
                    await _finalize_log(log_id, status="failed", error=str(exc))
                    failed_total += 1
                logger.warning(
                    "[bulk_exam_push] group send failed recipients=%d err=%s",
                    len(ordered_userids), exc,
                )
                continue
            except Exception as exc:  # noqa: BLE001
                for log_id, _exam in log_ids:
                    await _finalize_log(log_id, status="failed", error=str(exc))
                    failed_total += 1
                logger.exception("[bulk_exam_push] unexpected error")
                continue

            for log_id, _exam in log_ids:
                await _finalize_log(log_id, status="sent", response=response)
                sent_total += 1

    return {"sent": sent_total, "failed": failed_total, "skipped": skipped_total}


async def _write_log_for_exam(
    *,
    exam: Exam,
    user: User | None,
    status: str,
    error: str,
) -> None:
    title_text = "你有新的AI通关任务"
    deadline = exam.deadline_at.strftime("%Y-%m-%d %H:%M") if exam.deadline_at else "不限"
    description_text = (
        '<div class="gray">AI通关任务通知</div>'
        f'<div class="normal">任务：{exam.title}</div>'
        f'<div class="normal">最多尝试：{exam.max_attempts} 次</div>'
        f'<div class="normal">截止：{deadline}</div>'
    )
    url_text = _frontend_url("/training/challenges?filter=pending")
    log_id = await _create_log(
        event_type="exam_assigned",
        recipient_user_id=int(user.id) if user else None,
        recipient_wecom_userid=(user.wecom_userid or "").strip() or None if user else None,
        business_type="exam",
        business_id=int(exam.id),
        payload={"title": title_text, "description": description_text, "url": url_text},
    )
    await _finalize_log(log_id, status=status, error=error)


async def _exam_mark_all_failed(exam_ids: list[int], *, error: str) -> dict[str, int]:
    async with session_scope() as db:
        rows = (
            await db.execute(select(Exam).where(Exam.id.in_(exam_ids)))
        ).scalars().all()
        user_ids = sorted({int(r.user_id) for r in rows})
        users = (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
        user_map = {int(u.id): u for u in users}
        for exam in rows:
            await _write_log_for_exam(
                exam=exam,
                user=user_map.get(int(exam.user_id)),
                status="failed",
                error=error,
            )
    return {"sent": 0, "failed": len(exam_ids), "skipped": 0}
