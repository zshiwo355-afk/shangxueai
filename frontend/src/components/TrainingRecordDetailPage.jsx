import { DeleteOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Space, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { deleteTrainingRecord, fetchTrainingRecord } from "../lib/api.training";
import ChatHistoryView from "./ChatHistoryView";
import ReviewView from "./ReviewView";

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
      } catch (err) {
        if (alive) message.error(err?.message || "加载失败。");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, message]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteTrainingRecord(id);
      message.success("已删除。");
      navigate("/training/records", { replace: true });
    } catch (err) {
      message.error(err?.message || "删除失败。");
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="page-shell"><p style={{ color: "var(--text-mute)" }}>加载中…</p></div>;
  }
  if (!record || !record.review) {
    return (
      <div className="page-shell">
        <Button onClick={() => navigate("/training/records")}>返回列表</Button>
        <p style={{ color: "var(--text-mute)", marginTop: 16 }}>该记录暂无复盘数据。</p>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <Button onClick={() => navigate("/training/records")}>返回列表</Button>
        <h2 style={{ margin: 0 }}>训练复盘</h2>
        <Space>
          <Popconfirm
            title="确认删除该训练记录？"
            description="删除后无法恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={handleDelete}
          >
            <Button danger icon={<DeleteOutlined />} loading={deleting}>删除</Button>
          </Popconfirm>
          <Button onClick={() => navigate("/home")}>返回首页</Button>
        </Space>
      </div>
      <ReviewView review={record.review} createdAt={record.created_at} />
      <ChatHistoryView messages={record.chat_history} />
    </div>
  );
}
