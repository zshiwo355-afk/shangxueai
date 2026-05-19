/** 复盘视图：训练复盘 / 考试复盘 / 详情页共用。 */
import { Card, Descriptions, Empty, Space, Tag, Typography } from "antd";
import { useMemo } from "react";

const { Title, Paragraph } = Typography;

// LLM 返回的维度键统一映射成中文标签。覆盖了销售陪练常见的全部 8-10 维。
const DIMENSION_LABELS = {
  opening: "开场破冰",
  need_probe: "需求探询",
  needs_analysis: "需求分析",
  relationship_building: "关系建立",
  brand_trust: "品牌信任",
  brand_value: "品牌价值",
  product_intro: "产品介绍",
  product_recommendation: "产品推荐",
  presentation: "方案讲解",
  price_discuss: "价格谈判",
  price_negotiation: "价格谈判",
  objection: "异议处理",
  objection_handling: "异议处理",
  emotion_control: "情绪掌控",
  empathy: "同理心",
  closing: "促单成交",
  attempted_close: "尝试促成",
  after_sale: "售后跟进",
  follow_up: "客户跟进",
  compliance: "合规规范",
  professionalism: "专业表达",
  listening: "倾听质量",
};

function dimensionLabel(key) {
  return DIMENSION_LABELS[key] || key;
}

function resultBadge(result) {
  if (result === "成交") return { icon: "✓", text: "成交", tone: "success" };
  if (result === "意向客户") return { icon: "◇", text: "意向客户", tone: "processing" };
  return { icon: "✗", text: "未成交", tone: "error" };
}

function ListBlock({ title, items, color }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 style={{ margin: "8px 0", color: "var(--text-mute)" }}>{title}</h4>
      <Space size={[8, 8]} wrap>
        {items.map((item, idx) =>
          typeof item === "string"
            ? <Tag key={idx} color={color}>{item}</Tag>
            : <Tag key={idx} color={color}>{JSON.stringify(item)}</Tag>,
        )}
      </Space>
    </div>
  );
}

function SuggestedReplies({ items }) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <h4 style={{ margin: "8px 0", color: "var(--text-mute)" }}>更优话术建议</h4>
      <Space direction="vertical" size={12} style={{ width: "100%" }}>
        {items.map((item, idx) => {
          const turn = item?.round || item?.turn || idx + 1;
          const original = item?.original || item?.from || "";
          const better = item?.better || item?.suggestion || (typeof item === "string" ? item : "");
          const reason = item?.reason || item?.why || "";
          return (
            <Card key={idx} size="small" variant="outlined">
              <div style={{ fontWeight: 600, marginBottom: 4 }}>第 {turn} 轮</div>
              {original ? <Paragraph type="secondary" style={{ marginBottom: 4 }}>原话：{original}</Paragraph> : null}
              {better ? <Paragraph style={{ marginBottom: reason ? 4 : 0 }}>建议：{better}</Paragraph> : null}
              {reason ? <Paragraph type="secondary" style={{ marginBottom: 0 }}>说明：{reason}</Paragraph> : null}
            </Card>
          );
        })}
      </Space>
    </div>
  );
}

export default function ReviewView({ review, createdAt = "", showHero = true }) {
  const dimensionEntries = useMemo(() => Object.entries(review?.dimension_scores || {}), [review]);
  if (!review) return null;
  const badge = resultBadge(review.result);
  const isPass = !!review.is_pass;

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      {showHero ? (
        <div className="review-hero">
          <div>
            <Title level={2} style={{ marginBottom: 4 }}>
              {badge.icon} {badge.text}
            </Title>
            <Space size={[8, 8]} wrap>
              <Tag color={badge.tone}>{badge.text}</Tag>
              <Tag color={isPass ? "success" : "error"}>{isPass ? "合格" : "不合格"}</Tag>
            </Space>
            {review.deal_reason ? (
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>{review.deal_reason}</Paragraph>
            ) : null}
            {review.lost_reason && review.result === "未成交" ? (
              <Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>{review.lost_reason}</Paragraph>
            ) : null}
            {createdAt ? (
              <div style={{ marginTop: 8, color: "var(--text-faint)", fontSize: 12 }}>
                {createdAt.slice(0, 16).replace("T", " ")}
              </div>
            ) : null}
          </div>
          <div className="score">{Math.round(review.score || 0)}</div>
        </div>
      ) : null}

      {dimensionEntries.length > 0 ? (
        <Card title="维度得分" variant="outlined">
          <Descriptions column={{ xs: 1, sm: 2, md: 3 }}>
            {dimensionEntries.map(([k, v]) => (
              <Descriptions.Item key={k} label={dimensionLabel(k)}>
                {Number(v).toFixed(1)}
              </Descriptions.Item>
            ))}
          </Descriptions>
        </Card>
      ) : null}

      <Card title="客户与表现" variant="outlined">
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <ListBlock title="客户痛点" items={review.customer_pain_points} color="blue" />
          <ListBlock title="做得好的地方" items={review.strengths} color="success" />
          <ListBlock title="不足之处" items={review.weaknesses} color="orange" />
          <ListBlock title="关键转折点" items={review.key_turning_points} color="purple" />
          <ListBlock title="合规风险" items={review.compliance_risks} color="error" />
          <ListBlock title="下次训练建议" items={review.next_training_focus} color="gold" />
          {!review.customer_pain_points?.length &&
          !review.strengths?.length &&
          !review.weaknesses?.length &&
          !review.key_turning_points?.length &&
          !review.compliance_risks?.length &&
          !review.next_training_focus?.length ? <Empty description="暂无信息" /> : null}
        </Space>
      </Card>

      <Card title="更优话术建议" variant="outlined">
        <SuggestedReplies items={review.suggested_better_replies} />
        {(!review.suggested_better_replies || review.suggested_better_replies.length === 0) ? (
          <Empty description="本次训练暂无更优话术建议" />
        ) : null}
      </Card>
    </Space>
  );
}
