import { App as AntdApp, Button, Card, Popconfirm, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteTrainingRecord, fetchTrainingRecord } from "../lib/api.training";
import ChatHistoryView from "./ChatHistoryView";
import ReviewView from "./ReviewView";

const { Text } = Typography;

function resultColor(result) {
  if (result === "成交") return "success";
  if (result === "意向客户") return "processing";
  return "default";
}

export default function TrainingRecordDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchTrainingRecord(id);
        if (alive) setRecord(data);
      } catch (error) {
        if (alive) message.error(error?.message || "训练详情加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, message]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTrainingRecord(id);
      message.success("记录已删除。");
      navigate("/training/records", { replace: true });
    } catch (error) {
      message.error(error?.message || "删除失败。");
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="page-shell"><p style={{ color: "var(--text-mute)" }}>加载中…</p></div>;
  }

  if (!record || !record.review) {
    return (
      <div className="page-shell">
        <Button onClick={() => navigate("/training/records")}>返回训练记录</Button>
        <p style={{ color: "var(--text-mute)", marginTop: 16 }}>这条记录暂时没有可查看的复盘数据。</p>
      </div>
    );
  }

  return (
    <div className="page-shell page-shell--wide">
      <div className="page-toolbar page-toolbar--stack">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/training/records")}>返回训练记录</Button>
          <div>
            <h2 style={{ margin: 0 }}>训练复盘详情</h2>
            <Text type="secondary">这里保留单次训练的完整结果和对话回放，适合做复盘和二次练习。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate("/workspace/training")}>回到销售对练</Button>
          <Popconfirm
            title="确认删除这条训练记录？"
            description="删除后将无法恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleDelete}
          >
            <Button danger loading={deleting}>删除记录</Button>
          </Popconfirm>
        </Space>
      </div>

      <Card className="exam-hero-card" bordered={false}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Space size={[8, 8]} wrap>
            <Tag color="blue">{record.training_type}</Tag>
            <Tag>{record.difficulty}</Tag>
            <Tag color={resultColor(record.result)}>{record.result || "待定"}</Tag>
            <Tag color={record.is_pass ? "success" : "error"}>{record.is_pass ? "合格" : "待提升"}</Tag>
          </Space>
          <div className="exam-metric-grid">
            <div className="exam-metric-card">
              <span>训练得分</span>
              <strong>{Math.round(record.score || 0)}</strong>
            </div>
            <div className="exam-metric-card">
              <span>客户类型</span>
              <strong>{record.customer_type || "未标记"}</strong>
            </div>
            <div className="exam-metric-card">
              <span>训练时间</span>
              <strong>{record.created_at?.slice(0, 16).replace("T", " ") || "-"}</strong>
            </div>
          </div>
        </Space>
      </Card>

      <Card className="journey-tip-card" bordered={false}>
        <Space direction="vertical" size={8}>
          <Text strong>返回建议</Text>
          <Text type="secondary">如果你只是回看单次表现，回到训练记录最顺手；如果准备继续练下一场，直接回销售对练工作台会更高效。</Text>
        </Space>
      </Card>

      <ReviewView review={record.review} createdAt={record.created_at} />
      <ChatHistoryView messages={record.chat_history} />

      <div className="journey-actions">
        <Button onClick={() => navigate("/training/records")}>回到训练记录</Button>
        <Button type="primary" onClick={() => navigate("/workspace/training")}>回到销售对练</Button>
      </div>
    </div>
  );
}
