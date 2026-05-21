import { Empty, Space, Tag, Typography } from "antd";
import { useMemo } from "react";

const { Paragraph, Title, Text } = Typography;

const DIMENSION_LABELS = {
  opening: "开场",
  need_probe: "探需",
  needs_analysis: "分析",
  relationship_building: "关系",
  brand_trust: "信任",
  brand_value: "价值",
  product_intro: "产品",
  product_recommendation: "推荐",
  presentation: "讲解",
  price_discuss: "价格",
  price_negotiation: "谈判",
  objection: "异议",
  objection_handling: "异议",
  emotion_control: "情绪",
  empathy: "同理",
  closing: "促成",
  attempted_close: "试探",
  after_sale: "售后",
  follow_up: "跟进",
  compliance: "合规",
  professionalism: "专业",
  listening: "倾听",
};

function dimensionLabel(key) {
  return DIMENSION_LABELS[key] || key;
}

function resultMeta(result) {
  if (result === "成交") return { text: "成交", color: "success" };
  if (result === "意向客户") return { text: "意向", color: "processing" };
  return { text: "未成交", color: "default" };
}

function scoreTone(score) {
  const value = Number(score || 0);
  if (value >= 85) return { color: "var(--accent-deep, #426f9f)", label: "优" };
  if (value >= 70) return { color: "#16a34a", label: "良" };
  if (value >= 60) return { color: "#f59e0b", label: "中" };
  return { color: "#dc2626", label: "待提升" };
}

function dimensionTone(value) {
  const v = Number(value || 0);
  if (v >= 8.5) return "var(--accent-deep, #426f9f)";
  if (v >= 7) return "#16a34a";
  if (v >= 6) return "#f59e0b";
  return "#dc2626";
}

function TextList({ title, items, empty = "暂无内容。" }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  return (
    <section className="review-section review-section--minimal">
      <div className="review-section__header review-section__header--compact">
        <h3>{title}</h3>
      </div>
      {list.length ? (
        <ul className="review-list">
          {list.map((item, index) => (
            <li key={`${title}-${index}`}>
              {typeof item === "string" ? item : JSON.stringify(item)}
            </li>
          ))}
        </ul>
      ) : (
        <div className="review-empty">{empty}</div>
      )}
    </section>
  );
}

function SuggestedReplies({ items }) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) {
    return (
      <section className="review-section review-section--minimal">
        <div className="review-section__header review-section__header--compact">
          <h3>建议话术</h3>
        </div>
        <div className="review-empty">本次暂无更多建议。</div>
      </section>
    );
  }

  return (
    <section className="review-section review-section--minimal">
      <div className="review-section__header review-section__header--compact">
        <h3>建议话术</h3>
      </div>
      <div className="review-suggestion-list">
        {list.map((item, index) => {
          const turn = item?.round || item?.turn || index + 1;
          const original = item?.original || item?.from || "";
          const better = item?.better || item?.suggestion || (typeof item === "string" ? item : "");
          const reason = item?.reason || item?.why || "";

          return (
            <article key={`suggestion-${index}`} className="review-suggestion">
              <div className="review-suggestion__index">第 {turn} 轮</div>
              {original ? <p><span>原话</span>{original}</p> : null}
              {better ? <p><span>建议</span>{better}</p> : null}
              {reason ? <p><span>说明</span>{reason}</p> : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function ReviewView({ review, createdAt = "", showHero = true }) {
  const dimensionEntries = useMemo(
    () => Object.entries(review?.dimension_scores || {}),
    [review],
  );

  if (!review) return null;

  const result = resultMeta(review.result);
  const score = Math.round(review.score || 0);
  const createdLabel = createdAt ? createdAt.slice(0, 16).replace("T", " ") : "";

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {showHero ? (
        <section className="review-hero review-hero--minimal">
          <div className="review-hero__main">
            <Space size={[8, 8]} wrap>
              <Title level={2} style={{ margin: 0 }}>
                {result.text}
              </Title>
              <Tag bordered={false} color={result.color}>{result.text}</Tag>
              <Tag bordered={false} color={review.is_pass ? "success" : "default"}>
                {review.is_pass ? "合格" : "待提升"}
              </Tag>
            </Space>
            {review.deal_reason ? (
              <Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
                {review.deal_reason}
              </Paragraph>
            ) : null}
            {review.lost_reason && review.result === "未成交" ? (
              <Paragraph type="secondary" style={{ margin: "8px 0 0" }}>
                {review.lost_reason}
              </Paragraph>
            ) : null}
            {createdLabel ? (
              <Text type="secondary">{createdLabel}</Text>
            ) : null}
          </div>
          <div className="review-score-block" style={{ color: scoreTone(score).color }}>
            <span style={{ color: scoreTone(score).color, opacity: 0.78 }}>得分 · {scoreTone(score).label}</span>
            <strong style={{ color: scoreTone(score).color }}>{score}</strong>
          </div>
        </section>
      ) : null}

      {dimensionEntries.length ? (
        <section className="review-section review-section--minimal">
          <div className="review-section__header review-section__header--compact">
            <h3>维度得分</h3>
          </div>
          <div className="review-metric-grid">
            {dimensionEntries.map(([key, value]) => (
              <div key={key} className="review-metric">
                <span>{dimensionLabel(key)}</span>
                <strong style={{ color: dimensionTone(value) }}>{Number(value).toFixed(1)}</strong>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <TextList title="客户痛点" items={review.customer_pain_points} />
      <TextList title="做得好的地方" items={review.strengths} />
      <TextList title="需要改进的地方" items={review.weaknesses} />
      <TextList title="关键转折点" items={review.key_turning_points} />
      <TextList title="合规风险" items={review.compliance_risks} />
      <TextList title="下次训练重点" items={review.next_training_focus} />
      <SuggestedReplies items={review.suggested_better_replies} />

      {!dimensionEntries.length
      && !review.customer_pain_points?.length
      && !review.strengths?.length
      && !review.weaknesses?.length
      && !review.key_turning_points?.length
      && !review.compliance_risks?.length
      && !review.next_training_focus?.length
      && !review.suggested_better_replies?.length ? (
        <section className="review-section review-section--minimal">
          <Empty description="暂无复盘内容。" />
        </section>
        ) : null}
    </Space>
  );
}
