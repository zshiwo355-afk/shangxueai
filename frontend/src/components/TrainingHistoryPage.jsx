import { DeleteOutlined, FilterOutlined, TrophyOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Popconfirm, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteTrainingRecord, fetchMyTrainingRecords } from "../lib/api.training";

const { Text, Title } = Typography;

function resultColor(result) {
  if (result === "成交") return "success";
  if (result === "意向客户") return "processing";
  return "default";
}

const FILTER_OPTIONS = [
  { key: "all", label: "全部" },
  { key: "passed", label: "已通过" },
  { key: "pending", label: "待提升" },
];

export default function TrainingHistoryPage() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterKey, setFilterKey] = useState("all");
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

  useEffect(() => {
    reload();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = async (row) => {
    try {
      await deleteTrainingRecord(row.id);
      message.success("已删除。");
      setRecords((prev) => prev.filter((item) => item.id !== row.id));
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const filteredRecords = useMemo(() => {
    if (filterKey === "passed") return records.filter((item) => item.is_pass);
    if (filterKey === "pending") return records.filter((item) => item.is_pass === false || !item.is_pass);
    return records;
  }, [filterKey, records]);

  const averageScore = records.length > 0
    ? Math.round(records.reduce((sum, item) => sum + Number(item.score || 0), 0) / records.length)
    : 0;

  return (
    <div className="page-shell page-shell--wide">
      <div className="page-toolbar page-toolbar--stack">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>返回销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>我的训练记录</h2>
            <Text type="secondary">用更轻的卡片视图回看最近每一次训练结果和复盘。</Text>
          </div>
        </div>
        <div className="history-summary">
          <Card className="history-summary__card" bordered={false}>
            <span>总记录数</span>
            <strong>{records.length}</strong>
          </Card>
          <Card className="history-summary__card" bordered={false}>
            <span>平均得分</span>
            <strong>{averageScore}</strong>
          </Card>
        </div>
      </div>

      <Card className="history-filter-card" bordered={false}>
        <Space align="center" size={[8, 8]} wrap>
          <FilterOutlined style={{ color: "var(--text-mute)" }} />
          {FILTER_OPTIONS.map((option) => (
            <Button
              key={option.key}
              type={filterKey === option.key ? "primary" : "default"}
              onClick={() => setFilterKey(option.key)}
            >
              {option.label}
            </Button>
          ))}
        </Space>
      </Card>

      {!loading && filteredRecords.length === 0 ? (
        <Card bordered={false}>
          <Empty description="当前筛选条件下还没有训练记录" />
        </Card>
      ) : (
        <div className="history-card-list">
          {filteredRecords.map((row) => (
            <Card key={row.id} className="history-record-card" loading={loading} bordered={false}>
              <div className="history-record-card__top">
                <div>
                  <Space size={[8, 8]} wrap>
                    <Tag color="blue">{row.training_type}</Tag>
                    <Tag>{row.difficulty}</Tag>
                    <Tag color={resultColor(row.result)}>{row.result || "待定"}</Tag>
                    {row.is_pass != null ? (
                      <Tag color={row.is_pass ? "success" : "error"}>
                        {row.is_pass ? "通过" : "待提升"}
                      </Tag>
                    ) : null}
                  </Space>
                  <Title level={5} style={{ margin: "10px 0 0" }}>
                    {row.customer_type || "未标记客户类型"}
                  </Title>
                </div>

                <div className="history-record-card__score">
                  <TrophyOutlined />
                  <strong>{Math.round(row.score || 0)}</strong>
                  <span>训练得分</span>
                </div>
              </div>

              <div className="history-record-card__meta">
                <span>{row.created_at ? row.created_at.slice(0, 16).replace("T", " ") : "暂无时间"}</span>
              </div>

              <div className="history-record-card__actions">
                <Button type="primary" onClick={() => navigate(`/training/records/${row.id}`)}>
                  查看复盘
                </Button>
                <Popconfirm
                  title="确认删除这条训练记录？"
                  description="删除后无法恢复。"
                  okText="删除"
                  cancelText="取消"
                  okButtonProps={{ danger: true }}
                  onConfirm={() => handleDelete(row)}
                >
                  <Button danger icon={<DeleteOutlined />}>删除</Button>
                </Popconfirm>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
