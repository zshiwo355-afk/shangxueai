"""Real HTTP + MySQL checks, isolated from the configured business database.

MALL_TEST_DB_DSN=mysql+aiomysql://root@127.0.0.1:PORT/mall_test_integration \
  .venv/bin/python -m unittest discover -s tests -p test_mall_mysql.py -v

Only a local database whose name starts with mall_test_ is accepted. The test
tables in that database are cleared between cases. No background workers run.
"""
import asyncio
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path
import unittest
from unittest.mock import patch
from uuid import uuid4

import httpx
from fastapi import FastAPI
from sqlalchemy import create_engine, delete, func, select
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.auth import create_token
from app import mall_api
from app.db import get_db
from app.mall_api import admin_router, router
from app.models import (
    MallAccount, MallDanmaku, MallGrant, MallProduct, MallRedemption, User, UserPointSummary,
)


TEST_DSN = os.environ.get("MALL_TEST_DB_DSN", "")
MIGRATION = Path(__file__).resolve().parents[1] / "sql" / "points_mall.sql"
DANMAKU_MIGRATION = MIGRATION.with_name("mall_danmaku.sql")


@unittest.skipUnless(TEST_DSN, "Set MALL_TEST_DB_DSN to an isolated local MySQL database")
class MallMySQLTests(unittest.IsolatedAsyncioTestCase):
    @classmethod
    def setUpClass(cls):
        url = make_url(TEST_DSN)
        if url.host not in ("127.0.0.1", "localhost") or not (url.database or "").startswith("mall_test_"):
            raise RuntimeError("Refusing to run destructive test setup outside local mall_test_* database")
        if not url.database.replace("_", "").isalnum():
            raise RuntimeError("Invalid test database name")
        server = create_engine(url.set(drivername="mysql+pymysql", database=""))
        with server.begin() as connection:
            connection.exec_driver_sql(f"CREATE DATABASE IF NOT EXISTS `{url.database}` CHARACTER SET utf8mb4")
        server.dispose()
        engine = create_engine(url.set(drivername="mysql+pymysql"))
        with engine.begin() as connection:
            User.__table__.create(connection, checkfirst=True)
            UserPointSummary.__table__.create(connection, checkfirst=True)
            for migration in (MIGRATION, DANMAKU_MIGRATION):
                for statement in migration.read_text().split(";"):
                    if statement.strip():
                        connection.exec_driver_sql(statement)
        engine.dispose()

    async def asyncSetUp(self):
        self.engine = create_async_engine(TEST_DSN, pool_size=12, max_overflow=10)
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)
        async with self.sessions.begin() as db:
            for model in (MallDanmaku, MallRedemption, MallGrant, MallProduct, MallAccount, UserPointSummary, User):
                await db.execute(delete(model))
            for user_id in range(1, 15):
                db.add(User(
                    id=user_id, username=f"mall_test_{user_id}", password_md5="test-only",
                    display_name=f"测试员工{user_id}", department="测试部门",
                    role="admin" if user_id in (1, 14) else "user",
                    disabled=user_id == 13,
                ))
        self.app = FastAPI()
        self.app.include_router(router)
        self.app.include_router(admin_router)

        async def test_db():
            async with self.sessions() as db:
                try:
                    yield db
                    await db.commit()
                except Exception:
                    await db.rollback()
                    raise

        self.app.dependency_overrides[get_db] = test_db
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")

    async def asyncTearDown(self):
        await self.client.aclose()
        await self.engine.dispose()

    async def request(self, method, path, *, user=1, **kwargs):
        # Do not share auth cookies between identities in the same test client.
        self.client.cookies.clear()
        headers = {}
        if user is not None:
            token, _ = create_token(user, f"mall_test_{user}", "admin" if user in (1, 14) else "user")
            headers["Authorization"] = f"Bearer {token}"
        return await self.client.request(method, path, headers=headers, **kwargs)

    async def grant(self, user_id=2, points=10, *, request_id=None, admin=1):
        return await self.request("POST", "/api/admin/mall/grants", user=admin, json={
            "user_id": user_id, "points": points, "remark": "测试积分发放", "request_id": request_id or str(uuid4()),
        })

    async def product(self, *, price=100, stock=3, enabled=True, name="测试保温杯"):
        response = await self.request("POST", "/api/admin/mall/products", json={
            "name": name, "description": "请到前台领取", "image_url": "", "price_yuan": price,
            "stock": stock, "enabled": enabled, "request_id": str(uuid4()),
        })
        self.assertIn(response.status_code, (200, 201), response.text)
        return response.json()

    async def redeem(self, product, *, user=2, request_id=None, price=None):
        return await self.request("POST", "/api/mall/redemptions", user=user, json={
            "product_id": product["id"], "expected_price_yuan": product["price_yuan"] if price is None else price,
            "request_id": request_id or str(uuid4()),
        })

    async def summary(self, user=2):
        response = await self.request("GET", "/api/mall/summary", user=user)
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    async def test_danmaku_authentication_payload_and_server_identity(self):
        for user in (None, 13):
            self.assertEqual((await self.request("GET", "/api/mall/danmaku", user=user)).status_code, 401)
            self.assertEqual((await self.request("POST", "/api/mall/danmaku", user=user, json={"content": "加油"})).status_code, 401)
        for payload in ({"content": " "}, {"content": "字" * 51}, {"content": "加油", "user_id": 3}, {"content": "加油", "user_name": "他人"}):
            self.assertEqual((await self.request("POST", "/api/mall/danmaku", user=2, json=payload)).status_code, 422)
        sent = await self.request("POST", "/api/mall/danmaku", user=2, json={"content": "  " + "🎉" * 50 + "  "})
        self.assertEqual(sent.status_code, 200, sent.text)
        self.assertEqual(sent.json()["user_name"], "测试员工2")
        self.assertEqual(sent.json()["content"], "🎉" * 50)
        self.assertIs(sent.json()["is_mine"], True)
        shared = await self.request("GET", "/api/mall/danmaku", user=3)
        self.assertEqual(shared.json()["items"], [sent.json() | {"is_mine": False}])
        self.assertEqual(shared.json()["cooldown_seconds"], 0)
        refresh = await self.request("GET", "/api/mall/danmaku", user=2)
        self.assertEqual(refresh.json()["items"], [sent.json()])
        self.assertGreater(refresh.json()["cooldown_seconds"], 0)

    async def test_danmaku_ownership_uses_identity_even_when_employees_share_a_name(self):
        async with self.sessions.begin() as db:
            for user_id in (2, 3):
                (await db.get(User, user_id)).display_name = "同名员工"
        sent = [await self.request("POST", "/api/mall/danmaku", user=user_id,
                                   json={"content": "一起加油"}) for user_id in (2, 3)]
        self.assertTrue(all(response.status_code == 200 for response in sent))
        self.assertEqual(sent[0].json()["user_name"], sent[1].json()["user_name"])
        for user_id in (2, 3):
            refreshed = (await self.request("GET", "/api/mall/danmaku", user=user_id)).json()["items"]
            self.assertEqual([item["is_mine"] for item in refreshed], [user_id == 2, user_id == 3])
            self.assertEqual([item["id"] for item in refreshed], [response.json()["id"] for response in sent])

    async def test_danmaku_latest_hundred_preserves_history_points_and_migration(self):
        await self.grant(points=10)
        before = await self.summary()
        timestamp = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=10)
        async with self.sessions.begin() as db:
            db.add(UserPointSummary(user_id=2, total_points=123, training_points=123))
            db.add_all(MallDanmaku(user_id=2, user_name="历史署名", content=f"历史{i}", created_at=timestamp) for i in range(105))
        sent = await self.request("POST", "/api/mall/danmaku", user=2, json={"content": "积分不变"})
        self.assertEqual(sent.status_code, 200, sent.text)
        # Re-running the deploy migration must retain existing history.
        async with self.engine.begin() as connection:
            for statement in DANMAKU_MIGRATION.read_text().split(";"):
                if statement.strip():
                    await connection.exec_driver_sql(statement)
        data = (await self.request("GET", "/api/mall/danmaku", user=3)).json()
        self.assertEqual(len(data["items"]), 100)
        self.assertEqual(data["items"][0]["content"], "历史6")
        self.assertEqual(data["items"][-1], sent.json() | {"is_mine": False})
        self.assertEqual([item["id"] for item in data["items"]], sorted(item["id"] for item in data["items"]))
        self.assertEqual(await self.summary(), before)
        async with self.sessions() as db:
            self.assertEqual((await db.execute(select(func.count()).select_from(MallDanmaku))).scalar_one(), 106)
            self.assertEqual((await db.get(UserPointSummary, 2)).total_points, 123)
            self.assertEqual((await db.execute(select(func.count()).select_from(MallGrant))).scalar_one(), 1)
            self.assertEqual((await db.execute(select(func.count()).select_from(MallRedemption))).scalar_one(), 0)

    async def test_danmaku_concurrent_same_account_uses_current_read_for_cooldown(self):
        count = 0
        all_authenticated = asyncio.Event()
        original = mall_api._lock_users

        async def synchronized_lock(db, *user_ids):
            nonlocal count
            count += 1
            if count == 6:
                all_authenticated.set()
            await asyncio.wait_for(all_authenticated.wait(), timeout=5)
            return await original(db, *user_ids)

        # All requests first authenticate and open the old REPEATABLE READ
        # snapshot, then queue on the users row before the first insert commits.
        with patch("app.mall_api._lock_users", synchronized_lock):
            results = await asyncio.gather(*(
                self.request("POST", "/api/mall/danmaku", user=2, json={"content": f"并发{i}"}) for i in range(6)
            ))
        self.assertEqual(sum(item.status_code == 200 for item in results), 1, [item.text for item in results])
        self.assertEqual(sum(item.status_code == 429 for item in results), 5)
        for item in results:
            if item.status_code == 429:
                self.assertIn(int(item.headers["Retry-After"]), range(1, 6))
        async with self.sessions.begin() as db:
            row = (await db.execute(select(MallDanmaku))).scalar_one()
            row.created_at = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)
        next_send = await self.request("POST", "/api/mall/danmaku", user=2, json={"content": "五秒后可再次发送"})
        self.assertEqual(next_send.status_code, 200, next_send.text)

    async def test_danmaku_different_accounts_can_send_first_messages_concurrently(self):
        results = await asyncio.gather(*(
            self.request("POST", "/api/mall/danmaku", user=user, json={"content": "首次弹幕"}) for user in range(2, 10)
        ))
        self.assertTrue(all(item.status_code == 200 for item in results), [item.text for item in results])

    async def test_full_grant_exchange_pickup_and_audit_flow(self):
        self.assertEqual((await self.summary())["balance_points"], 0)
        self.assertEqual((await self.grant()).status_code, 200)
        product = await self.product()
        response = await self.redeem(product)
        self.assertEqual(response.status_code, 200, response.text)
        order = response.json()
        self.assertEqual(order["status"], "pending")
        self.assertTrue(order["code"])
        self.assertEqual(order["points_cost"], 5)
        balance = await self.summary()
        self.assertEqual((balance["total_points"], balance["balance_points"], balance["redeemed_points"]), (10, 5, 5))
        history = await self.request("GET", "/api/mall/redemptions", user=2)
        self.assertEqual(history.json()["items"][0]["id"], order["id"])
        first = await self.request("POST", f"/api/admin/mall/redemptions/{order['id']}/verify", json={})
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["status"], "redeemed")
        again = await self.request("POST", f"/api/admin/mall/redemptions/{order['id']}/verify", user=14, json={})
        self.assertEqual(again.status_code, 200, again.text)
        self.assertEqual(again.json()["redeemed_at"], first.json()["redeemed_at"])
        self.assertEqual(again.json()["redeemed_by_name"], first.json()["redeemed_by_name"])
        self.assertEqual((await self.summary())["balance_points"], 5)
        audit = await self.request("GET", "/api/admin/mall/redemptions", params={"keyword": order["code"], "status": "redeemed"})
        self.assertEqual(audit.json()["total"], 1)
        grants = await self.request("GET", "/api/admin/mall/grants", params={"keyword": "测试员工2"})
        self.assertEqual(grants.json()["total"], 1)
        self.assertEqual(grants.json()["items"][0]["operator_name"], "测试员工1")

    async def test_authorization_and_private_history(self):
        for path in ("/api/mall/summary", "/api/mall/products", "/api/mall/leaderboard", "/api/mall/redemptions"):
            self.assertEqual((await self.request("GET", path, user=None)).status_code, 401)
            self.assertEqual((await self.request("GET", path, user=13)).status_code, 401)
        for path in ("products", "grants", "redemptions", "users/2/summary"):
            self.assertEqual((await self.request("GET", f"/api/admin/mall/{path}", user=2)).status_code, 403)
        forbidden = await self.grant(admin=2)
        self.assertEqual(forbidden.status_code, 403)
        await self.grant()
        product = await self.product()
        order = (await self.redeem(product)).json()
        other = await self.request("GET", "/api/mall/redemptions", user=3, params={"user_id": 2})
        self.assertEqual(other.json()["total"], 0)
        response = await self.request("POST", f"/api/admin/mall/redemptions/{order['id']}/verify", user=2, json={})
        self.assertEqual(response.status_code, 403)

    async def test_learning_points_do_not_create_spendable_balance(self):
        async with self.sessions.begin() as db:
            db.add(UserPointSummary(user_id=2, total_points=1000, training_points=1000, manual_points=300))
        balance = await self.summary()
        self.assertEqual(balance["total_points"], 0)
        self.assertEqual(balance["balance_points"], 0)
        product = await self.product()
        self.assertIn((await self.redeem(product)).status_code, (400, 409))

    async def test_retries_do_not_double_grant_or_exchange(self):
        key = str(uuid4())
        results = await asyncio.gather(*(self.grant(request_id=key) for _ in range(6)))
        self.assertTrue(all(r.status_code == 200 for r in results), [r.text for r in results])
        self.assertEqual(len({r.json()["id"] for r in results}), 1)
        self.assertEqual((await self.summary())["balance_points"], 10)
        mismatch = await self.grant(points=11, request_id=key)
        self.assertEqual(mismatch.status_code, 409)
        product = await self.product()
        key = str(uuid4())
        responses = await asyncio.gather(*(self.redeem(product, request_id=key) for _ in range(6)))
        self.assertTrue(all(r.status_code == 200 for r in responses), [r.text for r in responses])
        self.assertEqual(len({r.json()["id"] for r in responses}), 1)
        self.assertEqual((await self.summary())["balance_points"], 5)
        second = await self.product(name="测试笔记本")
        self.assertEqual((await self.redeem(second, request_id=key)).status_code, 409)
        async with self.sessions() as db:
            self.assertEqual((await db.get(MallProduct, product["id"])).stock, 2)

    async def test_concurrent_redemptions_cannot_overspend(self):
        await self.grant(points=5)
        product = await self.product(stock=20)
        responses = await asyncio.gather(*(self.redeem(product) for _ in range(8)))
        self.assertEqual(sum(r.status_code == 200 for r in responses), 1, [r.text for r in responses])
        self.assertTrue(all(r.status_code in (200, 400, 409) for r in responses))
        self.assertEqual((await self.summary())["balance_points"], 0)
        async with self.sessions() as db:
            self.assertEqual((await db.get(MallProduct, product["id"])).stock, 19)

    async def test_different_users_cannot_oversell_last_item(self):
        await self.grant(user_id=2)
        await self.grant(user_id=3)
        product = await self.product(stock=1)
        responses = await asyncio.gather(self.redeem(product, user=2), self.redeem(product, user=3))
        self.assertEqual(sum(r.status_code == 200 for r in responses), 1)
        self.assertEqual((await self.summary(2))["balance_points"] + (await self.summary(3))["balance_points"], 15)
        async with self.sessions() as db:
            self.assertEqual((await db.get(MallProduct, product["id"])).stock, 0)

    async def test_simultaneous_grants_and_exchange_preserve_account_totals(self):
        await self.grant(points=20)
        product = await self.product(stock=20)
        responses = await asyncio.gather(
            *(self.grant(points=1, admin=1 if i % 2 else 14) for i in range(8)),
            *(self.redeem(product) for _ in range(3)),
        )
        self.assertTrue(all(r.status_code == 200 for r in responses), [r.text for r in responses])
        balance = await self.summary()
        self.assertEqual((balance["total_points"], balance["balance_points"]), (28, 13))

    async def test_independent_users_can_receive_first_grants_concurrently(self):
        responses = await asyncio.gather(
            self.grant(user_id=2, admin=1), self.grant(user_id=3, admin=14),
        )
        self.assertTrue(all(r.status_code == 200 for r in responses), [r.text for r in responses])
        self.assertEqual((await self.summary(2))["balance_points"], 10)
        self.assertEqual((await self.summary(3))["balance_points"], 10)

    async def test_leaderboard_top_ten_my_true_rank_and_spending(self):
        for user_id in range(2, 13):
            await self.grant(user_id=user_id, points=100 - user_id)
        response = await self.request("GET", "/api/mall/leaderboard", user=12)
        board = response.json()
        self.assertEqual(len(board["items"]), 10)
        self.assertEqual(board["items"][0]["user_id"], 2)
        self.assertEqual(board["me"]["rank"], 11)
        self.assertEqual(board["me"]["user_id"], 12)
        before = await self.summary(2)
        await self.redeem(await self.product(), user=2)
        after = await self.summary(2)
        self.assertEqual(before["rank"], after["rank"])
        self.assertEqual(before["total_points"], after["total_points"])
        self.assertEqual(before["balance_points"] - 5, after["balance_points"])
        zero = await self.request("GET", "/api/mall/leaderboard", user=14)
        self.assertEqual(zero.json()["me"]["total_points"], 0)
        self.assertNotIn(13, [row["user_id"] for row in zero.json()["items"]])

    async def test_filters_out_of_stock_unlisted_and_price_changes(self):
        await self.grant(points=5)
        affordable = await self.product(stock=1)
        expensive = await self.product(price=200)
        empty = await self.product(stock=0)
        hidden = await self.product(enabled=False)
        response = await self.request("GET", "/api/mall/products", user=2, params={"filter": "affordable"})
        self.assertEqual([p["id"] for p in response.json()["items"]], [affordable["id"]])
        all_items = await self.request("GET", "/api/mall/products", user=2, params={"filter": "all"})
        self.assertEqual(all_items.json()["total"], 3)
        for unavailable in (expensive, empty, hidden):
            self.assertIn((await self.redeem(unavailable)).status_code, (400, 404, 409))
        changed = await self.request("PUT", f"/api/admin/mall/products/{affordable['id']}", json={
            "name": affordable["name"], "description": "", "image_url": "", "price_yuan": 120, "stock": 1, "enabled": True, "expected_version": affordable["version"],
        })
        self.assertEqual(changed.status_code, 200)
        self.assertEqual((await self.redeem(affordable)).status_code, 409)
        self.assertEqual((await self.summary())["balance_points"], 5)

    async def test_builtin_ranking_names_are_hidden_for_every_role_without_changing_points(self):
        async with self.sessions.begin() as db:
            (await db.get(User, 1)).username = "admin"
            (await db.get(User, 14)).username = "superadmin"
            db.add_all([
                MallAccount(user_id=1, balance_points=17, total_points=1000),
                MallAccount(user_id=14, balance_points=9, total_points=900),
                MallAccount(user_id=2, balance_points=8, total_points=100),
            ])
        for roles in (("admin", "super_admin"), ("user", "admin"), ("super_admin", "user")):
            with self.subTest(roles=roles):
                async with self.sessions.begin() as db:
                    (await db.get(User, 1)).role = roles[0]
                    (await db.get(User, 14)).role = roles[1]
                response = await self.request("GET", "/api/mall/leaderboard", user=2)
                self.assertEqual(response.status_code, 200, response.text)
                board = response.json()
                self.assertFalse({1, 14} & {item["user_id"] for item in board["items"]})
                self.assertEqual(board["items"][0]["user_id"], 2)
                self.assertEqual(board["me"]["rank"], 1)
                for user_id, balance, total in ((1, 17, 1000), (14, 9, 900)):
                    personal = await self.summary(user_id)
                    self.assertIsNone(personal["rank"])
                    self.assertEqual((personal["balance_points"], personal["total_points"]), (balance, total))
                    hidden_board = await self.request("GET", "/api/mall/leaderboard", user=user_id)
                    self.assertEqual(hidden_board.status_code, 200, hidden_board.text)
                    me = hidden_board.json()["me"]
                    self.assertIsNone(me["rank"])
                    self.assertEqual((me["balance_points"], me["total_points"]), (balance, total))
        async with self.sessions() as db:
            for user_id, balance, total in ((1, 17, 1000), (14, 9, 900), (2, 8, 100)):
                account = await db.get(MallAccount, user_id)
                self.assertEqual((account.balance_points, account.total_points), (balance, total))

    async def test_other_admin_roles_and_admin_display_name_fill_the_top_ten(self):
        expected_top = [1, 14, 4, 5, 6, 7, 8, 9, 10, 11]
        visible_order = [*expected_top, 12]
        async with self.sessions.begin() as db:
            # Prefixes and display names are not the two exact hidden usernames.
            (await db.get(User, 1)).username = "admin_operator"
            super_admin = await db.get(User, 14)
            super_admin.username = "superadmin_operator"
            super_admin.role = "super_admin"
            (await db.get(User, 2)).username = "admin"
            (await db.get(User, 3)).username = "superadmin"
            (await db.get(User, 4)).display_name = "admin"
            db.add_all([
                MallAccount(user_id=2, balance_points=1000, total_points=1000),
                MallAccount(user_id=3, balance_points=900, total_points=900),
            ])
            for index, user_id in enumerate(visible_order):
                points = 200 - index * 10
                db.add(MallAccount(user_id=user_id, balance_points=points, total_points=points))
        response = await self.request("GET", "/api/mall/leaderboard", user=12)
        self.assertEqual(response.status_code, 200, response.text)
        board = response.json()
        self.assertEqual([item["user_id"] for item in board["items"]], expected_top)
        self.assertEqual([item["rank"] for item in board["items"]], list(range(1, 11)))
        self.assertEqual(board["items"][2]["name"], "admin")
        self.assertEqual(board["me"]["rank"], 11)
        self.assertEqual((await self.summary(1))["rank"], 1)
        self.assertEqual((await self.summary(14))["rank"], 2)
        for hidden_id in (2, 3):
            response = await self.request("GET", f"/api/admin/mall/users/{hidden_id}/summary", user=1)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIsNone(response.json()["rank"])

    async def test_hidden_ranking_names_do_not_take_tied_score_rank_positions(self):
        async with self.sessions.begin() as db:
            (await db.get(User, 1)).username = "admin"
            (await db.get(User, 2)).username = "superadmin"
            (await db.get(User, 14)).role = "super_admin"
            for user_id in range(1, 15):
                db.add(MallAccount(user_id=user_id, balance_points=7, total_points=10))
        response = await self.request("GET", "/api/mall/leaderboard", user=14)
        self.assertEqual(response.status_code, 200, response.text)
        board = response.json()
        self.assertEqual([item["user_id"] for item in board["items"]], list(range(3, 13)))
        self.assertEqual([item["rank"] for item in board["items"]], list(range(1, 11)))
        self.assertEqual(board["me"]["rank"], 11)
        for user_id, rank in ((3, 1), (8, 6), (12, 10), (14, 11)):
            personal = await self.summary(user_id)
            self.assertEqual(personal["rank"], rank)
            self.assertEqual((personal["balance_points"], personal["total_points"]), (7, 10))
        for user_id in (1, 2):
            self.assertIsNone((await self.summary(user_id))["rank"])

    async def test_stale_product_form_does_not_restore_sold_stock(self):
        await self.grant(points=10)
        product = await self.product(stock=2)
        order = (await self.redeem(product)).json()
        response = await self.request("PUT", f"/api/admin/mall/products/{product['id']}", json={
            "name": "改名后的杯子", "description": "", "image_url": "", "price_yuan": 100,
            "stock": 2, "enabled": True, "expected_version": product["version"],
        })
        self.assertEqual(response.status_code, 409)
        async with self.sessions() as db:
            current = await db.get(MallProduct, product["id"])
            self.assertEqual(current.stock, 1)
            self.assertEqual(current.name, product["name"])
        response = await self.request("PUT", f"/api/admin/mall/products/{product['id']}", json={
            "name": "改名后的杯子", "description": "", "image_url": "", "price_yuan": 120,
            "stock": 1, "enabled": True, "expected_version": product["version"] + 1,
        })
        self.assertEqual(response.status_code, 200)
        records = (await self.request("GET", "/api/mall/redemptions", user=2)).json()["items"]
        self.assertEqual(records[0]["product_name"], product["name"])
        self.assertEqual(records[0]["price_yuan"], 100)
        verified = await asyncio.gather(*(
            self.request("POST", f"/api/admin/mall/redemptions/{order['id']}/verify", user=1 if i % 2 else 14, json={})
            for i in range(6)
        ))
        self.assertTrue(all(r.status_code == 200 for r in verified), [r.text for r in verified])
        self.assertEqual(len({r.json()["redeemed_by_name"] for r in verified}), 1)
        self.assertEqual(len({r.json()["redeemed_at"] for r in verified}), 1)

    async def test_lost_edit_response_cannot_replenish_stock_on_retry(self):
        await self.grant()
        product = await self.product(stock=1)
        payload = {
            "name": product["name"], "description": product["description"], "image_url": "",
            "price_yuan": 100, "stock": 2, "enabled": True, "expected_version": product["version"],
        }
        first = await self.request("PUT", f"/api/admin/mall/products/{product['id']}", json=payload)
        self.assertEqual(first.status_code, 200)
        self.assertEqual((await self.redeem(product)).status_code, 200)
        retry = await self.request("PUT", f"/api/admin/mall/products/{product['id']}", json=payload)
        self.assertEqual(retry.status_code, 409)
        async with self.sessions() as db:
            current = await db.get(MallProduct, product["id"])
            self.assertEqual(current.stock, 1)
            self.assertEqual(current.version, product["version"] + 2)

    async def test_input_validation_and_disabled_recipient(self):
        for points in (0, -1, 1.5, True):
            response = await self.grant(points=points)
            self.assertIn(response.status_code, (400, 422), response.text)
        for user_id in (13, 99999):
            self.assertIn((await self.grant(user_id=user_id)).status_code, (400, 404))
        for changes in ({"price_yuan": 99}, {"price_yuan": 0}, {"price_yuan": 20.5}, {"stock": -1}, {"name": "   "}, {"image_url": "javascript:alert(1)"}):
            payload = {"name": "测试商品", "description": "", "image_url": "", "price_yuan": 100, "stock": 1, "enabled": True}
            payload.update(changes)
            response = await self.request("POST", "/api/admin/mall/products", json=payload)
            self.assertIn(response.status_code, (400, 422), response.text)

    async def test_migration_can_be_reapplied_without_losing_points(self):
        await self.grant(points=15)
        async with self.engine.begin() as connection:
            for statement in MIGRATION.read_text().split(";"):
                if statement.strip():
                    await connection.exec_driver_sql(statement)
        self.assertEqual((await self.summary())["balance_points"], 15)

    async def test_grant_history_survives_employee_and_operator_deletion(self):
        await self.grant(user_id=2, admin=1)
        async with self.sessions.begin() as db:
            await db.execute(delete(User).where(User.id.in_([1, 2])))
        response = await self.request("GET", "/api/admin/mall/grants", user=14, params={"keyword": "测试员工2"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total"], 1)
        record = response.json()["items"][0]
        self.assertEqual(record["user_name"], "测试员工2")
        self.assertEqual(record["operator_name"], "测试员工1")


if __name__ == "__main__":
    unittest.main()
