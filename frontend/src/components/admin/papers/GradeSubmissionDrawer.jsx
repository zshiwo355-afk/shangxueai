import {
  App as AntdApp,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  InputNumber,
  Space,
  Tag,
  Typography,
} from "antd";
import { useEffect, useState } from "react";
import { getSubmissionDetail, gradeSubmission } from "../../../lib/api.papers";

const { Text, Paragraph } = Typography;

const TYPE_COLOR = {
  single: "blue",
  multiple: "purple",
  judge: "cyan",
  blank: "gold",
  short_answer: "orange",
};

function formatAnswer(answer) {
  if (!answer || !answer.length) return "—";
  return answer.join("、");
}

export default function GradeSubmissionDrawer({ submissionId, open, onClose, onGraded }) {
  const { message } = AntdApp.useApp();
  const [detail, setDetail] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [overall, setOverall] = useState("");
  const [saving, setSaving] = useState(false);

  const reload = async () => {
    if (!submissionId) return;
    try {
      const data = await getSubmissionDetail(submissionId);
      setDetail(data);
      const map = {};
      (data.answers || []).forEach((a) => {
        if (!a.is_objective) {
          // 默认值：人工分 > AI 分 > 0；不动则保留当前态（AI 分仍是终评，
          // 真正写入 manual_score 只在 admin 主动改后）
          map[a.id] = {
            score: a.manual_score ?? a.ai_score ?? 0,
            comment: a.comment || "",
            // 记录初始值用于判断 admin 是否真的改过分数
            initial_score: a.manual_score ?? null,
          };
        }
      });
      setDrafts(map);
      setOverall(data.submission?.comment || "");
    } catch (err) {
      message.error(err?.message || "加载失败。");
    }
  };

  useEffect(() => {
    if (open) reload();
    else { setDetail(null); setDrafts({}); }
  }, [open, submissionId]);

  const submit = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      // 只把"管理员改过的题"作为 manual 评分送上去：
      //   - initial_score 是从 detail 读到的当前 manual_score（可能是 null）
      //   - 如果 v.score 跟 initial_score 相同，说明 admin 没动 → 不发，让 AI 分继续作为终评
      //   - admin 改了 → 发 manual_score 覆盖
      // 评语任何变动都发（这样能保留 AI 评语之外的额外说明）
      const answers = [];
      Object.entries(drafts).forEach(([id, v]) => {
        const newScore = Number(v.score) || 0;
        const initial = v.initial_score;
        const scoreChanged = initial == null ? true : Number(initial) !== newScore;
        // 情况 1：admin 改了分数 → 发 manual_score
        // 情况 2：题原本已有 manual_score（initial != null），但 admin 没改 → 重发原值（避免空 patch 把它清掉）
        // 情况 3：admin 没改，且原本就是 AI 分 → 不发（保留 ai_score 为终评）
        if (scoreChanged || initial != null) {
          answers.push({
            answer_id: Number(id),
            manual_score: newScore,
            comment: v.comment || "",
          });
        } else if ((v.comment || "").trim()) {
          // 仅评语变动也算介入（admin 加了批注）
          answers.push({
            answer_id: Number(id),
            manual_score: newScore,
            comment: v.comment || "",
          });
        }
      });
      await gradeSubmission(submissionId, {
        answers,
        overall_comment: overall,
      });
      message.success("已保存评分。");
      onGraded?.();
      onClose?.();
    } catch (err) {
      message.error(err?.message || "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const sub = detail?.submission;
  const paper = detail?.paper;
  const answers = detail?.answers || [];

  // AI 判分默认即终评，admin 进 drawer 是抽查 + 可选覆盖。
  // graded 状态也允许编辑（覆盖现有人工分），不再 readonly。
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={920}
      title={paper ? `${paper.title} · 第 ${sub?.attempt_no || 1} 次提交` : "提交详情"}
      destroyOnHidden
      footer={
        <Space style={{ float: "right" }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={submit}>提交评分</Button>
        </Space>
      }
    >
      {detail ? (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Space wrap>
            <Tag bordered={false} color="blue">总分 {paper?.total_score || 0}</Tag>
            <Tag bordered={false}>及格 {paper?.pass_score || 0}</Tag>
            <Tag bordered={false} color="purple">AI 分 {sub?.auto_score == null ? "—" : Math.round(sub.auto_score)}</Tag>
            <Tag bordered={false} color="orange">人工分 {sub?.manual_score == null ? "—" : Math.round(sub.manual_score)}</Tag>
            {sub?.final_score != null ? (
              <Tag bordered={false} color="green">最终 {Math.round(sub.final_score)}</Tag>
            ) : null}
            {sub?.is_pass != null ? (
              sub.is_pass ? <Tag color="success">合格</Tag> : <Tag color="error">不合格</Tag>
            ) : null}
          </Space>

          {answers.map((a, idx) => (
            <Card
              key={a.id}
              size="small"
              title={
                <Space>
                  <Text strong>第 {idx + 1} 题</Text>
                  <Tag bordered={false} color={TYPE_COLOR[a.question_type]}>{a.question_type_label}</Tag>
                  <Text type="secondary">本题 {a.score} 分</Text>
                  {a.is_objective ? (
                    a.is_correct ? <Tag color="success">答对</Tag> : <Tag color="error">答错</Tag>
                  ) : a.manual_score != null ? (
                    <Tag color="orange">人工已评</Tag>
                  ) : a.ai_score != null ? (
                    <Tag color="purple">🤖 AI 已评</Tag>
                  ) : (
                    <Tag color="gold">待人工评分</Tag>
                  )}
                </Space>
              }
            >
              <Paragraph style={{ marginBottom: 8, whiteSpace: "pre-wrap" }}>{a.stem}</Paragraph>
              {a.options?.length ? (
                <Space direction="vertical" size={4} style={{ marginBottom: 8 }}>
                  {a.options.map((opt, i) => (
                    <Text key={i}>{String.fromCharCode("A".charCodeAt(0) + i)}. {opt}</Text>
                  ))}
                </Space>
              ) : null}
              <div style={{ display: "flex", gap: 24, marginBottom: 8, flexWrap: "wrap" }}>
                <div>
                  <Text type="secondary">参考答案：</Text>
                  <Text strong>{formatAnswer(a.correct_answer)}</Text>
                </div>
                <div>
                  <Text type="secondary">学员作答：</Text>
                  <Text strong>{formatAnswer(a.user_answer)}</Text>
                </div>
                {a.is_objective ? (
                  <div>
                    <Text type="secondary">自动得分：</Text>
                    <Text strong>{a.auto_score == null ? "—" : a.auto_score}</Text>
                  </div>
                ) : null}
              </div>

              {!a.is_objective && a.ai_score != null ? (
                <div style={{
                  background: "#f5f0ff",
                  border: "1px solid #d3adf7",
                  borderRadius: 6,
                  padding: "10px 12px",
                  marginBottom: 12,
                }}>
                  <Space size={8} style={{ marginBottom: 4 }}>
                    <Text strong style={{ color: "#722ed1" }}>🤖 AI 预评分</Text>
                    <Text strong>{Math.round((a.ai_score + Number.EPSILON) * 10) / 10} / {a.score}</Text>
                  </Space>
                  {a.ai_comment ? (
                    <Paragraph style={{ marginBottom: 0, whiteSpace: "pre-wrap", color: "#1f1f1f", fontSize: 13 }}>
                      {a.ai_comment}
                    </Paragraph>
                  ) : null}
                </div>
              ) : null}

              {!a.is_objective ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space>
                    <Text>人工打分（0 ~ {a.score}）：</Text>
                    <InputNumber
                      min={0}
                      max={a.score}
                      step={0.5}
                      value={drafts[a.id]?.score ?? a.manual_score ?? a.ai_score ?? 0}
                      onChange={(v) => setDrafts((d) => ({ ...d, [a.id]: { ...(d[a.id] || {}), score: v } }))}
                    />
                    {a.ai_score != null && drafts[a.id]?.initial_score == null ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>不改即采纳 AI 分</Text>
                    ) : null}
                  </Space>
                  <Input.TextArea
                    rows={2}
                    placeholder="评语（可选）"
                    value={drafts[a.id]?.comment ?? a.comment ?? ""}
                    onChange={(e) => setDrafts((d) => ({ ...d, [a.id]: { ...(d[a.id] || {}), comment: e.target.value } }))}
                  />
                </Space>
              ) : (
                a.comment ? <Text type="secondary">评语：{a.comment}</Text> : null
              )}
            </Card>
          ))}

          <Card size="small" title="整卷评语">
            <Input.TextArea
              rows={3}
              value={overall}
              onChange={(e) => setOverall(e.target.value)}
              placeholder="整体反馈（可选）"
            />
          </Card>
        </Space>
      ) : (
        <Empty description="加载中" />
      )}
    </Drawer>
  );
}
