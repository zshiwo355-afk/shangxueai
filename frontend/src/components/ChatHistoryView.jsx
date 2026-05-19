import { Card, Empty, Tag } from "antd";
import ChatMessage from "./ChatMessage";

const STAGE_LABELS = {
  opening: "开场",
  need_probe: "需求探询",
  brand_trust: "品牌信任",
  product_intro: "产品介绍",
  price_discuss: "价格洽谈",
  objection: "异议处理",
  closing: "促成",
  after_sale: "售后",
  finished: "已结束",
};

/**
 * 复盘 / 历史详情里展示完整对话。
 * messages: list[{round, role: 'customer' | 'trainee', content, stage}]
 */
export default function ChatHistoryView({ messages, defaultOpen = true }) {
  const list = Array.isArray(messages) ? messages : [];
  if (list.length === 0) {
    return (
      <Card title="对话回放" variant="outlined">
        <Empty description="该次训练未保存对话历史" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      </Card>
    );
  }

  // 按轮次分组（每轮 customer 在前 / trainee 在后），并用阶段标签作为分隔
  let lastStage = null;
  const items = [];
  list.forEach((m, idx) => {
    const stage = m.stage || "";
    if (stage && stage !== lastStage) {
      items.push(
        <div key={`stage-${idx}`} style={{ display: "flex", justifyContent: "center", margin: "12px 0 4px" }}>
          <Tag color="blue" style={{ borderRadius: 999, fontSize: 12 }}>
            {STAGE_LABELS[stage] || stage}
          </Tag>
        </div>,
      );
      lastStage = stage;
    }
    items.push(<ChatMessage key={`msg-${idx}`} role={m.role} content={m.content} />);
  });

  return (
    <Card
      title={`对话回放（共 ${list.length} 条）`}
      variant="outlined"
      defaultActiveKey={defaultOpen ? "panel" : undefined}
      styles={{ body: { padding: 16 } }}
    >
      <div className="history-stream">{items}</div>
    </Card>
  );
}
