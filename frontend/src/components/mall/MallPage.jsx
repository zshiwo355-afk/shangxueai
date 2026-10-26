import { CheckCircleOutlined, GiftOutlined, HistoryOutlined, ReloadOutlined, TrophyOutlined } from "@ant-design/icons";
import { Alert, Button, Drawer, Empty, Modal, Pagination, Spin, Tabs, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import {
  createMallRedemption, fetchMallLeaderboard, fetchMallProducts, fetchMallSummary, fetchMyMallRedemptions,
} from "../../lib/api.mall";
import {
  createRedemptionRequest, formatMallNumber as number, formatMallTime, newRedemptionRequestId, redemptionBlockReason,
} from "./mall-utils";
import "./mall.css";

const PAGE_SIZE = 9;

function LoadError({ error, onRetry }) {
  return <Alert type="error" showIcon title="加载失败" description={error} action={<Button size="small" onClick={onRetry}>重试</Button>} />;
}

function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.image_url]);
  return product.image_url && !failed
    ? <img src={product.image_url} alt={product.name || product.product_name} loading="lazy" onError={() => setFailed(true)} />
    : <span className="mall-product-placeholder" aria-label="暂无商品图片"><GiftOutlined /><span>积分好礼</span></span>;
}

function MyRedemptions({ open, onClose, revision }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setLoading(true);
    setError("");
    fetchMyMallRedemptions({ page, page_size: 8 })
      .then((result) => { if (active) setData(result); })
      .catch((err) => { if (active) setError(err.message || "兑换记录暂时无法加载，请重试。"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [open, page, retry, revision]);

  return (
    <Drawer title="我的兑换记录" open={open} onClose={onClose} size={540} className="mall-records-drawer">
      <div className="mall-records-note">兑换成功后，请出示领取码到前台领取。</div>
      {error ? <LoadError error={error} onRetry={() => setRetry((value) => value + 1)} /> : (
        <Spin spinning={loading}>
          {data?.items?.length ? <div className="mall-records">
            {data.items.map((item) => <article className="mall-record" key={item.id}>
              <div className="mall-record__heading"><h3>{item.product_name}</h3><Tag color={item.status === "redeemed" ? "default" : "processing"}>{item.status === "redeemed" ? "已领取" : "待领取"}</Tag></div>
              <p>¥{number(item.price_yuan)}<span> · {number(item.points_cost)} 积分 · 1 件</span></p>
              <div className="mall-record__code"><span>领取码</span><Typography.Text copyable>{item.code}</Typography.Text></div>
              <small>兑换时间：{formatMallTime(item.created_at)}</small>
              {item.redeemed_at ? <small>领取时间：{formatMallTime(item.redeemed_at)}</small> : null}
            </article>)}
          </div> : !loading ? <Empty description="还没有兑换记录，去挑选一份好礼吧" /> : <div className="mall-loading-space" />}
          {data?.total > 8 ? <Pagination current={page} pageSize={8} total={data.total} showSizeChanger={false} onChange={setPage} align="center" /> : null}
        </Spin>
      )}
    </Drawer>
  );
}

function Leaderboard({ data, loading, error, onRetry }) {
  const rows = data?.items?.slice(0, 10) || [];
  return <aside className="mall-leaderboard" aria-labelledby="mall-leaderboard-title">
    <header><span className="mall-section-kicker"><TrophyOutlined /> 荣誉榜</span><h2 id="mall-leaderboard-title">积分排行榜 <span>TOP 10</span></h2><p>按累计获得积分排名，兑换不影响名次</p></header>
    {error ? <LoadError error={error} onRetry={onRetry} /> : <Spin spinning={loading}>
      <div className="mall-leaderboard__labels" aria-hidden="true"><span>排名 / 姓名</span><span>累计积分</span></div>
      <ol className="mall-leaderboard__list">
        {Array.from({ length: 10 }, (_, index) => {
          const item = rows[index];
          return item ? <li key={item.user_id} className={index < 3 ? "mall-leaderboard__top" : undefined}>
            <span className="mall-leaderboard__rank">{String(item.rank).padStart(2, "0")}</span>
            <div className="mall-leaderboard__person"><strong>{item.name}</strong><span>{item.department || "—"}</span></div>
            <b>{number(item.total_points)}</b>
          </li> : <li className="mall-leaderboard__vacant" key={`vacant-${index}`} aria-hidden="true"><span className="mall-leaderboard__rank">—</span>{index === rows.length ? <span>{loading ? "正在加载…" : "等待更多伙伴上榜"}</span> : null}</li>;
        })}
      </ol>
      <div className="mall-leaderboard__me" aria-label="我的积分">
        <div className="mall-leaderboard__me-title"><strong>我的积分</strong><span>{data?.me?.rank ? `第 ${data.me.rank} 名` : "暂无排名"}</span></div>
        <div className="mall-leaderboard__me-stats"><div><span>累计获得</span><strong>{number(data?.me?.total_points)}</strong></div><div><span>可用余额</span><strong>{number(data?.me?.balance_points)}</strong></div></div>
      </div>
    </Spin>}
  </aside>;
}

export default function MallPage() {
  const [filter, setFilter] = useState("affordable");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [summary, setSummary] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [products, setProducts] = useState(null);
  const [accountLoading, setAccountLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [leaderboardError, setLeaderboardError] = useState("");
  const [productsError, setProductsError] = useState("");
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [purchase, setPurchase] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [purchaseError, setPurchaseError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const refresh = () => setRevision((value) => value + 1);

  useEffect(() => {
    let active = true;
    setAccountLoading(true);
    setSummaryError("");
    setLeaderboardError("");
    Promise.allSettled([fetchMallSummary(), fetchMallLeaderboard()]).then(([account, rankings]) => {
      if (!active) return;
      if (account.status === "fulfilled") setSummary(account.value);
      else { setSummary(null); setSummaryError(account.reason?.message || "积分余额暂时无法加载，请重试。"); }
      if (rankings.status === "fulfilled") setLeaderboard(rankings.value);
      else setLeaderboardError(rankings.reason?.message || "排行榜暂时无法加载，请重试。");
      setAccountLoading(false);
    });
    return () => { active = false; };
  }, [revision]);

  useEffect(() => {
    let active = true;
    setProductsLoading(true);
    setProductsError("");
    fetchMallProducts({ filter, page, page_size: PAGE_SIZE })
      .then((result) => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(result.total / PAGE_SIZE));
        if (page > lastPage) setPage(lastPage);
        else setProducts(result);
      })
      .catch((error) => { if (active) setProductsError(error.message || "商品暂时无法加载，请重试。"); })
      .finally(() => { if (active) setProductsLoading(false); });
    return () => { active = false; };
  }, [filter, page, revision]);

  const openPurchase = (product) => {
    setReceipt(null);
    setPurchaseError("");
    setPurchase({ product, request: createRedemptionRequest(product, newRedemptionRequestId()) });
  };
  const closePurchase = () => {
    if (submitLock.current) return;
    setPurchase(null);
    setReceipt(null);
    setPurchaseError("");
  };
  const redeem = async () => {
    if (!purchase || submitLock.current || receipt) return;
    submitLock.current = true;
    setSubmitting(true);
    setPurchaseError("");
    try {
      const result = await createMallRedemption(purchase.request);
      setReceipt(result);
      refresh();
    } catch (error) {
      // Keep the confirmed request and its key for a safe retry after a lost response.
      setPurchaseError(error.message || "暂未确认兑换结果。请重试，系统会避免重复扣分。");
      refresh();
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  };
  const balance = accountLoading || summaryError ? null : summary?.balance_points;

  return <div className="mall-page">
    <header className="mall-heading"><div><span className="mall-section-kicker">每一份努力，都值得奖励</span><h1>积分商城</h1><p>用积累的积分，兑换心仪的好礼。</p></div><Button icon={<HistoryOutlined />} onClick={() => setRecordsOpen(true)}>我的兑换记录</Button></header>
    <section className="mall-balance" aria-label="我的商城积分" aria-busy={accountLoading}>
      <div className="mall-balance__primary"><span>可用积分</span><div><strong>{number(summary?.balance_points)}</strong><span>积分</span></div><p>可兑换价值 <b>¥{number(summary ? summary.balance_points * 20 : null)}</b> 的商品</p></div>
      <div className="mall-balance__secondary"><div><span>累计获得</span><strong>{number(summary?.total_points)}<small> 积分</small></strong></div><div><span>已兑换</span><strong>{number(summary?.redeemed_points)}<small> 积分</small></strong></div></div>
      <div className="mall-balance__rule"><GiftOutlined /><strong>1 积分 = 20 元</strong><span>管理员发放积分 · 兑换后前台领取</span></div>
    </section>
    {summaryError ? <LoadError error={summaryError} onRetry={refresh} /> : null}
    <div className="mall-content">
      <section className="mall-catalog" aria-label="兑换商品">
        <div className="mall-catalog__toolbar"><Tabs activeKey={filter} onChange={(value) => { setFilter(value); setPage(1); }} items={[{ key: "affordable", label: "可兑换" }, { key: "all", label: "全部" }]} /><Button type="text" icon={<ReloadOutlined />} onClick={refresh} loading={productsLoading || accountLoading} aria-label="刷新商品、余额和排行榜">刷新</Button></div>
        <p className="mall-catalog__hint">{filter === "affordable" ? "根据你的可用积分，挑选现在就能兑换的好礼" : "所有在售好礼，积攒积分即可兑换"}</p>
        {productsError ? <LoadError error={productsError} onRetry={refresh} /> : <Spin spinning={productsLoading}>
          {products?.items?.length ? <div className="mall-products">
            {products.items.map((product) => {
              const reason = redemptionBlockReason(product, balance);
              return <article className="mall-product" key={product.id}>
                <div className="mall-product__image"><ProductImage product={product} />{product.stock <= 0 ? <span className="mall-product__sold-out">暂时兑完</span> : null}</div>
                <div className="mall-product__body"><h2>{product.name}</h2><p className="mall-product__description">{product.description || "兑换后请到前台领取"}</p><div className="mall-product__price"><span>¥<strong>{number(product.price_yuan)}</strong></span><small>{number(product.points_cost)} 积分</small></div><div className="mall-product__stock">剩余 {number(product.stock)} 件</div><Button block type="primary" disabled={!!reason || productsLoading} onClick={() => openPurchase(product)} aria-label={`${reason || "兑换"}：${product.name}`}>{reason || "立即兑换"}</Button></div>
              </article>;
            })}
          </div> : !productsLoading ? <div className="mall-catalog__empty"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={filter === "affordable" ? "暂时没有可兑换的商品" : "好礼正在准备中，敬请期待"} />{filter === "affordable" ? <><p>可以先看看全部好礼，积分积累后再来兑换。</p><Button onClick={() => { setFilter("all"); setPage(1); }}>查看全部商品</Button></> : null}</div> : <div className="mall-loading-space" />}
          {products?.total > PAGE_SIZE ? <Pagination current={page} pageSize={PAGE_SIZE} total={products.total} onChange={setPage} showSizeChanger={false} align="center" className="mall-pagination" /> : null}
        </Spin>}
      </section>
      <Leaderboard data={leaderboard} loading={accountLoading} error={leaderboardError} onRetry={refresh} />
    </div>
    <MyRedemptions open={recordsOpen} onClose={() => setRecordsOpen(false)} revision={revision} />
    <Modal title={receipt ? "兑换成功" : "确认兑换"} open={!!purchase} onCancel={closePurchase} closable={!submitting} maskClosable={!submitting} keyboard={!submitting} footer={receipt ? <Button type="primary" onClick={closePurchase}>完成</Button> : <><Button disabled={submitting} onClick={closePurchase}>取消</Button><Button type="primary" loading={submitting} onClick={redeem}>{purchaseError ? "重试本次兑换" : "确认兑换"}</Button></>}>
      {receipt ? (
        <div className="mall-receipt" role="status">
          <CheckCircleOutlined />
          <h3>{receipt.status === "redeemed" ? "本次兑换已领取" : "好礼已为你预留"}</h3>
          <p>{receipt.product_name} · 1 件</p>
          <div className="mall-receipt__code"><span>领取码</span><Typography.Text copyable>{receipt.code}</Typography.Text></div>
          <strong>{receipt.status === "redeemed" ? `领取时间：${formatMallTime(receipt.redeemed_at)}` : "请到前台领取"}</strong>
          <p>{receipt.status === "redeemed" ? "此次重试未重复扣分。" : "向前台出示领取码，核销后即可领取商品。"}<br />可随时在「我的兑换记录」中查看。</p>
        </div>
      ) : purchase ? (
        <div className="mall-confirm">
          <h3>{purchase.product.name}</h3>
          <div className="mall-confirm__line"><span>商品金额</span><strong>¥{number(purchase.product.price_yuan)} / 1 件</strong></div>
          <div className="mall-confirm__line"><span>本次扣除</span><strong>{number(purchase.product.points_cost)} 积分</strong></div>
          <Alert type="info" showIcon title="兑换后请到前台领取" description="确认后立即扣除积分并预留商品，凭领取码到前台核销领取。兑换不影响累计积分排名。" />
          {purchaseError ? <Alert type="error" showIcon title="兑换尚未确认" description={<>{purchaseError}<br />重试会核对本次兑换结果，不会重复扣分。也可先到「我的兑换记录」查看。</>} /> : null}
        </div>
      ) : null}
    </Modal>
  </div>;
}
