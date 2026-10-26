import { GiftFilled, HistoryOutlined, ReloadOutlined, TrophyFilled } from "@ant-design/icons";
import { Alert, Button, Empty, Pagination, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";

import { getPublicLotteryDraws } from "../../../lib/api.lottery";
import { LOTTERY_PAGE_SIZE_OPTIONS, lotteryPageChange, lotteryPageFromResponse } from "../lottery-pagination-utils";
import { getPublicHistoryDisplayState } from "./lottery-public-utils";

const { Text } = Typography;

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export default function LotteryPublicHistory({ code, latestDrawSequence, refreshVersion = 0, busy = false }) {
  const [page, setPage] = useState({ current: 1, pageSize: 10, reload: 0 });
  const [history, setHistory] = useState({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const drawSequenceRef = useRef(latestDrawSequence);
  const refreshRef = useRef(refreshVersion);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const displayState = getPublicHistoryDisplayState({ busy, error });

  useEffect(() => {
    if (busy) return;
    if (latestDrawSequence !== drawSequenceRef.current) {
      drawSequenceRef.current = latestDrawSequence;
      // A completed/recovered draw should be visible at the start of history.
      setPage((previous) => ({ ...previous, current: 1, reload: previous.reload + 1 }));
    }
  }, [latestDrawSequence, busy]);

  useEffect(() => {
    if (busy) return;
    if (refreshVersion !== refreshRef.current) {
      refreshRef.current = refreshVersion;
      setPage((previous) => ({ ...previous, reload: previous.reload + 1 }));
    }
  }, [refreshVersion, busy]);

  useEffect(() => {
    // Stop both new requests and already-in-flight responses during the spin.
    if (busy) return undefined;
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    getPublicLotteryDraws(code, { page: page.current, pageSize: page.pageSize, signal: controller.signal })
      .then((data) => {
        if (!active || busyRef.current) return;
        const next = lotteryPageFromResponse(data, page.current, page.pageSize);
        if (next.current !== page.current) {
          setPage((previous) => ({ ...previous, current: next.current }));
          return;
        }
        setHistory({ items: next.items, total: next.total });
      })
      .catch((cause) => {
        if (active && !busyRef.current && cause?.code !== "REQUEST_ABORTED") setError(cause?.message || "抽奖记录加载失败，请重试。");
      })
      .finally(() => { if (active && !busyRef.current) setLoading(false); });
    return () => { active = false; controller.abort(); };
  }, [code, page.current, page.pageSize, page.reload, busy]);

  return (
    <section className="lottery-history-card" aria-label="我的完整抽奖记录">
      <div className="lottery-section-heading">
        <div><HistoryOutlined /><span>我的抽奖记录</span></div>
        <Button size="small" type="text" icon={<ReloadOutlined />} disabled={loading || busy} onClick={() => setPage((previous) => ({ ...previous, reload: previous.reload + 1 }))}>刷新</Button>
      </div>
      {displayState === "drawing" ? (
        <div role="status"><Spin size="small" /> <Text type="secondary">好运揭晓中，转盘停止后显示抽奖记录。</Text></div>
      ) : displayState === "error" ? (
        <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={() => setPage((previous) => ({ ...previous, reload: previous.reload + 1 }))}>重试</Button>} />
      ) : (
        <Spin spinning={loading}>
          {history.items.length ? (
            <div className="lottery-history-list">
              {history.items.map((item) => {
                const won = item.result_type === "win" || (item.prize_id && item.result_type !== "no_win");
                return (
                  <div key={item.id}>
                    <span className={won ? "is-win" : ""}>{won ? <TrophyFilled /> : <GiftFilled />}</span>
                    <p><strong>{won ? item.prize_name || "幸运好礼" : "历史未中奖记录"}</strong><small>第 {item.draw_sequence} 次 · {formatDateTime(item.created_at)}</small></p>
                  </div>
                );
              })}
            </div>
          ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={loading ? "正在读取记录" : "还没有抽奖记录"} />}
        </Spin>
      )}
      {displayState !== "drawing" ? <div className="lottery-history-pagination">
        <Text>共 {history.total} 条记录</Text>
        {history.total > 0 ? <Pagination
          size="small"
          simple
          current={page.current}
          pageSize={page.pageSize}
          total={history.total}
          disabled={loading || Boolean(error)}
          showSizeChanger
          pageSizeOptions={LOTTERY_PAGE_SIZE_OPTIONS}
          onChange={(current, pageSize) => setPage((previous) => lotteryPageChange(previous, current, pageSize))}
        /> : null}
      </div> : null}
    </section>
  );
}
