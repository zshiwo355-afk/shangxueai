import { DeleteOutlined } from "@ant-design/icons";
import { Button, Empty, Popconfirm, Space, Table, Tag, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteTrainingRecord, fetchMyTrainingRecords } from "../lib/api.training";

export default function TrainingHistoryPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  const reload = async () => {
    setLoading(true);
    try {
      const data = await fetchMyTrainingRecords();
      setRecords(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "训练记录加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const handleDelete = async (row) => {
    try {
      await deleteTrainingRecord(row.id);
      message.success("已删除。");
      setRecords((prev) => prev.filter((r) => r.id !== row.id));
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const columns = [
    {
      title: "训练时间",
      dataIndex: "created_at",
      key: "created_at",
      render: (v) => v ? v.slice(0, 16).replace("T", " ") : "—",
    },
    { title: "训练类型", dataIndex: "training_type", render: (v) => <Tag color="blue">{v}</Tag> },
    { title: "难度", dataIndex: "difficulty" },
    { title: "客户类型", dataIndex: "customer_type" },
    {
      title: "结果",
      dataIndex: "result",
      render: (v, row) => (
        <Space size={4} wrap>
          <Tag color={v === "成交" ? "success" : v === "意向客户" ? "processing" : "default"}>
            {v || "—"}
          </Tag>
          {row.is_pass != null ? (
            <Tag color={row.is_pass ? "success" : "error"}>
              {row.is_pass ? "合格" : "不合格"}
            </Tag>
          ) : null}
        </Space>
      ),
    },
    {
      title: "分数",
      dataIndex: "score",
      render: (v) => <strong>{Math.round(v || 0)}</strong>,
    },
    {
      title: "操作",
      key: "action",
      width: 180,
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => navigate(`/training/records/${row.id}`)}>
            查看复盘
          </Button>
          <Popconfirm
            title="确认删除该训练记录？"
            description="删除后无法恢复。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(row)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-shell">
      <div className="page-toolbar">
        <Button onClick={() => navigate("/home")}>返回</Button>
        <h2 style={{ margin: 0 }}>我的训练记录</h2>
        <Space />
      </div>
      {!loading && records.length === 0 ? (
        <Empty description="还没有训练记录" />
      ) : (
        <Table
          rowKey="id"
          loading={loading}
          dataSource={records}
          columns={columns}
          pagination={{ pageSize: 20, showSizeChanger: false }}
        />
      )}
    </div>
  );
}
