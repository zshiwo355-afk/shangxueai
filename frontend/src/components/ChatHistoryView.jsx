import { Card, Empty, Tag } from "antd";
import ChatMessage from "./ChatMessage";

const STAGE_LABELS = {
  opening: "开场破冰",
  need_probe: "需求探询",
  brand_trust: "品牌信任",
  product_intro: "产品介绍",
  price_discuss: "价格沟通",
  objection: "异议处理",
  closing: "促成成交",
  after_sale: "售后跟进",
  finished: "已结束",
};

export default function ChatHistoryView({ messages }) {
  const list = Array.isArray(messages) ? messages : [];

  if (list.length === 0) {
    return (
      <Card title="对话回放" variant="outlined">
        <Empty description="这次记录里还没有保存对话内容" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  let lastStage = null;
  const items = [];

  list.forEach((message, index) => {
    const stage = message.stage || "";
    if (stage && stage !== lastStage) {
      items.push(
        <div key={`stage-${index}`} style={{ display: "flex", justifyContent: "center", margin: "12px 0 4px" }}>
          <Tag color="blue" style={{ borderRadius: 999, fontSize: 12 }}>
            {STAGE_LABELS[stage] || stage}
          </Tag>
        </div>,
      );
      lastStage = stage;
    }

    items.push(
      <ChatMessage
        key={`msg-${index}`}
        role={message.role}
        content={message.content}
      />,
    );
  });

  return (
    <Card
      title={`对话回放（共 ${list.length} 条）`}
      variant="outlined"
      styles={{ body: { padding: 16 } }}
    >
      <div className="history-stream">{items}</div>
    </Card>
  );
}
