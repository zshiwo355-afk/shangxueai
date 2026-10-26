"""Explicit repair of legacy winning draws without a claim registration.

From backend/: python -m app.lottery_maintenance [--campaign-id 4]
Apply only after backing up the printed IDs:
  python -m app.lottery_maintenance --campaign-id 4 --draw-ids 12 \
      --apply --expected-count 1 --operator-id 1

Dry-run is the default. No schema changes, probability updates or chance
deductions are performed. Existing claim records are never overwritten.
"""
from __future__ import annotations

import argparse
import asyncio
import json
from typing import Sequence

from sqlalchemy.ext.asyncio import AsyncSession

from .access import is_admin_like
from .db import SessionLocal, engine
from .lottery_service import backfill_missing_lottery_claims, find_missing_lottery_claims
from .models import LotteryAuditLog, User


def parse_args(argv: Sequence[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--campaign-id", type=int)
    parser.add_argument("--draw-ids", type=int, nargs="+", help="Exact draw IDs reviewed and backed up before apply")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--expected-count", type=int)
    parser.add_argument("--operator-id", type=int, help="Enabled administrator responsible for the repair audit")
    args = parser.parse_args(argv)
    if args.apply and (args.expected_count is None or not args.draw_ids or args.operator_id is None):
        parser.error("--apply requires --draw-ids, --expected-count and --operator-id")
    if args.expected_count is not None and args.expected_count < 0:
        parser.error("--expected-count cannot be negative")
    if any(value <= 0 for value in (args.draw_ids or [])) or (args.campaign_id is not None and args.campaign_id <= 0):
        parser.error("IDs must be positive integers")
    return args


async def repair_claims(db: AsyncSession, args: argparse.Namespace) -> dict:
    candidates = await find_missing_lottery_claims(db, campaign_id=args.campaign_id)
    if args.draw_ids:
        requested = set(args.draw_ids)
        candidates = [item for item in candidates if item["draw_id"] in requested]
    report = {"mode": "apply" if args.apply else "dry-run", "missing_count": len(candidates), "missing": candidates, "created_draw_ids": []}
    if not args.apply:
        return report
    if len(candidates) != args.expected_count:
        raise ValueError(f"Missing count changed: expected {args.expected_count}, found {len(candidates)}; run dry-run and review again")
    if {item["draw_id"] for item in candidates} != set(args.draw_ids):
        raise ValueError("The exact draw IDs no longer match missing registrations; run dry-run and review again")
    operator = await db.get(User, args.operator_id)
    if not operator or operator.disabled or not is_admin_like(operator):
        raise ValueError("--operator-id must identify an enabled administrator")
    created = await backfill_missing_lottery_claims(db, candidates=candidates)
    by_id = {item["draw_id"]: item for item in candidates}
    for draw_id in created:
        item = by_id[draw_id]
        db.add(LotteryAuditLog(
            campaign_id=item["campaign_id"], entity_type="draw", entity_id=draw_id,
            action="backfill_claim", operator_id=args.operator_id,
            after_json=json.dumps({"draw_id": draw_id, "invite_link_id": item["invite_link_id"], "claim_status": "pending"}),
        ))
    await db.flush()
    report["created_draw_ids"] = created
    return report


async def main(args: argparse.Namespace) -> None:
    try:
        async with SessionLocal() as db:
            try:
                report = await repair_claims(db, args)
                if args.apply:
                    await db.commit()
                else:
                    await db.rollback()
                print(json.dumps(report, ensure_ascii=False, indent=2))
            except Exception:
                await db.rollback()
                raise
    finally:
        await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main(parse_args()))
