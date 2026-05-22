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
          map[a.id] = {
            score: a.manual_score ?? 0,
            comment: a.comment || "",
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
      const answers = Object.entries(drafts).map(([id, v]) => ({
        answer_id: Number(id),
        manual_score: Number(v.score) || 0,
        comment: v.comment || "",
      }));
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

  const isReadOnly = sub?.status === "graded";

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={920}
      title={paper ? `${paper.title} · 第 ${sub?.attempt_no || 1} 次提交` : "提交详情"}
      destroyOnHidden
      footer={
        isReadOnly ? null : (
          <Space style={{ float: "right" }}>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={submit}>提交评分</Button>
          </Space>
        )
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
                  ) : <Tag color="gold">需人工评分</Tag>}
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

              {!a.is_objective ? (
                <Space direction="vertical" style={{ width: "100%" }}>
                  <Space>
                    <Text>人工打分（0 ~ {a.score}）：</Text>
                    <InputNumber
                      min={0}
                      max={a.score}
                      step={0.5}
                      disabled={isReadOnly}
                      value={drafts[a.id]?.score ?? a.manual_score ?? 0}
                      onChange={(v) => setDrafts((d) => ({ ...d, [a.id]: { ...(d[a.id] || {}), score: v } }))}
                    />
                  </Space>
                  <Input.TextArea
                    rows={2}
                    placeholder="评语（可选）"
                    disabled={isReadOnly}
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
              disabled={isReadOnly}
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
