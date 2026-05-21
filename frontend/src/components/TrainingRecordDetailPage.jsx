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

function scoreTone(score) {
  const value = Number(score || 0);
  if (value >= 85) return { color: "var(--accent-deep, #426f9f)", label: "优" };
  if (value >= 70) return { color: "#16a34a", label: "良" };
  if (value >= 60) return { color: "#f59e0b", label: "中" };
  return { color: "#dc2626", label: "待提升" };
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
    return <div className="page-shell"><p style={{ color: "var(--text-mute)" }}>加载中...</p></div>;
  }

  if (!record || !record.review) {
    return (
      <div className="page-shell">
        <Button onClick={() => navigate("/training/records")}>返回训练记录</Button>
        <p style={{ color: "var(--text-mute)", marginTop: 16 }}>这条记录暂时没有可查看的数据。</p>
      </div>
    );
  }

  return (
    <div className="page-shell page-shell--wide page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/training/records")}>训练记录</Button>
          <div>
            <h2 style={{ margin: 0 }}>复盘详情</h2>
            <Text type="secondary">查看结果与回放。</Text>
          </div>
        </div>
        <Space wrap>
          <Button onClick={() => navigate("/workspace/training")}>销售对练</Button>
          <Popconfirm
            title="确认删除这条记录？"
            description="删除后无法恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleDelete}
          >
            <Button danger loading={deleting}>删除记录</Button>
          </Popconfirm>
        </Space>
      </div>

      <Card className="exam-hero-card exam-hero-card--minimal" bordered={false}>
        <Space direction="vertical" size={14} style={{ width: "100%" }}>
          <Space size={[8, 8]} wrap>
            <Tag bordered={false} color="blue">{record.training_type}</Tag>
            <Tag bordered={false}>{record.difficulty}</Tag>
            <Tag bordered={false} color={resultColor(record.result)}>{record.result || "待定"}</Tag>
            <Tag bordered={false} color={record.is_pass ? "success" : "error"}>{record.is_pass ? "合格" : "待提升"}</Tag>
          </Space>
          <div className="exam-metric-grid">
            <div className="exam-metric-card">
              <span>得分</span>
              <strong style={{ color: scoreTone(record.score).color }}>{Math.round(record.score || 0)}</strong>
            </div>
            <div className="exam-metric-card">
              <span>客户类型</span>
              <strong style={{ color: "var(--accent-deep, #426f9f)" }}>{record.customer_type || "未标记"}</strong>
            </div>
            <div className="exam-metric-card">
              <span>时间</span>
              <strong>{record.created_at?.slice(0, 16).replace("T", " ") || "-"}</strong>
            </div>
          </div>
        </Space>
      </Card>

      <ReviewView review={record.review} createdAt={record.created_at} />
      <ChatHistoryView messages={record.chat_history} />

      <div className="journey-actions journey-actions--spread">
        <Button onClick={() => navigate("/training/records")}>训练记录</Button>
        <Button type="primary" onClick={() => navigate("/workspace/training")}>销售对练</Button>
      </div>
    </div>
  );
}
