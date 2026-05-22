import { ReloadOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Empty, Space, Table, Tag } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";
import { listPendingSubmissions } from "../../../lib/api.papers";
import GradeSubmissionDrawer from "./GradeSubmissionDrawer";

export default function PendingReviewPanel() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [gradingId, setGradingId] = useState(null);

  const reload = async () => {
    setLoading(true);
    try {
      const data = await listPendingSubmissions();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const columns = [
    { title: "提交ID", dataIndex: "id", width: 90 },
    { title: "试卷", dataIndex: "paper_title", ellipsis: true },
    { title: "应试者", dataIndex: "user_display_name", width: 160 },
    { title: "次数", dataIndex: "attempt_no", width: 60 },
    {
      title: "AI 分",
      dataIndex: "auto_score",
      width: 90,
      render: (v) => v == null ? "—" : Math.round(v),
    },
    {
      title: "提交时间",
      dataIndex: "submitted_at",
      width: 180,
      render: (v) => v ? dayjs(v).format("YYYY-MM-DD HH:mm") : "—",
    },
    {
      title: "操作",
      key: "action",
      width: 100,
      render: (_, row) => (
        <Button size="small" type="primary" onClick={() => setGradingId(row.id)}>
          去评分
        </Button>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between" }}>
        <Space>
          <Tag color="gold" bordered={false}>待复核 {items.length}</Tag>
          <Button size="small" icon={<ReloadOutlined />} onClick={reload}>刷新</Button>
        </Space>
      </div>

      {items.length ? (
        <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ pageSize: 20 }} />
      ) : (
        <Empty description={loading ? "加载中…" : "暂无待复核记录"} />
      )}

      <GradeSubmissionDrawer
        submissionId={gradingId}
        open={!!gradingId}
        onClose={() => setGradingId(null)}
        onGraded={reload}
      />
    </>
  );
}
