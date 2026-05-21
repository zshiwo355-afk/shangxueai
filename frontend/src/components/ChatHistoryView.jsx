import { Empty, Tag } from "antd";
import ChatMessage from "./ChatMessage";

const STAGE_LABELS = {
  opening: "开场",
  need_probe: "探需",
  brand_trust: "信任",
  product_intro: "产品",
  price_discuss: "价格",
  objection: "异议",
  closing: "促成",
  after_sale: "跟进",
  finished: "结束",
};

export default function ChatHistoryView({ messages }) {
  const list = Array.isArray(messages) ? messages : [];

  if (!list.length) {
    return (
      <section className="review-section review-section--minimal review-section--history">
        <div className="review-section__header review-section__header--compact">
          <h3>对话回放</h3>
        </div>
        <Empty
          description="暂无对话内容。"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </section>
    );
  }

  let lastStage = null;
  const items = [];

  list.forEach((entry, index) => {
    const stage = entry.stage || "";
    if (stage && stage !== lastStage) {
      items.push(
        <div key={`stage-${index}`} className="history-stage-sep">
          <Tag>{STAGE_LABELS[stage] || stage}</Tag>
        </div>,
      );
      lastStage = stage;
    }

    items.push(
      <ChatMessage
        key={`msg-${index}`}
        role={entry.role}
        content={entry.content}
      />,
    );
  });

  return (
    <section className="review-section review-section--minimal review-section--history">
      <div className="review-section__header review-section__header--compact">
        <h3>对话回放</h3>
        <span>{list.length} 条</span>
      </div>
      <div className="history-stream history-stream--lined">{items}</div>
    </section>
  );
}
