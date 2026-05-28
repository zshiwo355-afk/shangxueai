import { DeleteOutlined, FilterOutlined, TrophyOutlined } from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Popconfirm, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteTrainingRecord, fetchMyTrainingRecords } from "../lib/api.training";

const { Text, Title } = Typography;

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

function formatTime(value) {
  if (!value) return "暂无时间";
  return String(value).slice(0, 16).replace("T", " ");
}

function recordSummary(row) {
  const customer = row.customer_type || "随机客户";
  const difficulty = row.difficulty || "未标记难度";
  return `${customer} · ${difficulty} 场景复盘`;
}

function recordHint(row) {
  return row.is_pass
    ? "本轮已通过，可优先回看高分表达与亮点。"
    : "建议先看复盘再练一轮，把短板积累成稳定表达。";
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
    } catch (error) {
      message.error(error?.message || "训练记录加载失败。");
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
      message.success("记录已删除。");
      setRecords((prev) => prev.filter((item) => item.id !== row.id));
    } catch (error) {
      message.error(error?.message || "删除失败。");
    }
  };

  const filteredRecords = useMemo(() => {
    if (filterKey === "passed") return records.filter((item) => item.is_pass);
    if (filterKey === "pending") return records.filter((item) => item.is_pass === false || !item.is_pass);
    return records;
  }, [filterKey, records]);

  const averageScore =
    records.length > 0
      ? Math.round(records.reduce((sum, item) => sum + Number(item.score || 0), 0) / records.length)
      : 0;

  return (
    <div className="page-shell page-shell--wide page-shell--minimal">
      <div className="page-toolbar page-toolbar--stack page-toolbar--minimal">
        <div className="page-toolbar__leading">
          <Button onClick={() => navigate("/workspace/training")}>销售对练</Button>
          <div>
            <h2 style={{ margin: 0 }}>训练记录</h2>
            <Text type="secondary">查看最近结果与每次复盘留下来的变化。</Text>
          </div>
        </div>

        <div className="page-toolbar__actions">
          <Button onClick={() => navigate("/workspace/training")}>工作台</Button>
          <Button type="primary" onClick={() => navigate("/train/prepare")}>
            新训练
          </Button>
        </div>
      </div>

      <div className="history-summary history-summary--minimal">
        <Card className="history-summary__card" bordered={false}>
          <span>总数</span>
          <strong>{records.length}</strong>
        </Card>
        <Card className="history-summary__card" bordered={false}>
          <span>平均分</span>
          <strong style={{ color: scoreTone(averageScore).color }}>{averageScore}</strong>
        </Card>
      </div>

      <Card className="history-filter-card history-filter-card--minimal" bordered={false}>
        <div className="history-filter-card__content">
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
          <Text type="secondary">{filteredRecords.length} 条</Text>
        </div>
      </Card>

      {loading ? (
        <div className="history-card-list history-card-list--minimal">
          {[0, 1, 2].map((i) => (
            <Card key={i} className="history-record-card history-record-card--minimal" bordered={false}>
              <Skeleton active paragraph={{ rows: 3 }} />
            </Card>
          ))}
        </div>
      ) : filteredRecords.length === 0 ? (
        <Card bordered={false}>
          <Empty description="当前没有训练记录。" />
        </Card>
      ) : (
        <div className="history-card-list history-card-list--minimal">
          {filteredRecords.map((row) => {
            const tone = scoreTone(row.score);
            const score = Math.round(row.score || 0);

            return (
              <Card
                key={row.id}
                className="history-record-card history-record-card--minimal"
                bordered={false}
              >
                <div className="history-record-card__top">
                  <div className="history-record-card__content">
                    <Space size={[8, 8]} wrap>
                      <Tag bordered={false} color="blue">{row.training_type}</Tag>
                      <Tag bordered={false}>{row.difficulty || "未标记难度"}</Tag>
                      <Tag bordered={false} color={resultColor(row.result)}>{row.result || "待定"}</Tag>
                      {row.is_pass != null ? (
                        <Tag bordered={false} color={row.is_pass ? "success" : "default"}>
                          {row.is_pass ? "已通过" : "待提升"}
                        </Tag>
                      ) : null}
                    </Space>

                    <Title level={5} style={{ margin: "10px 0 0", color: "var(--accent-deep, #426f9f)" }}>
                      {row.customer_type || "未标记客户类型"}
                    </Title>

                    <Text type="secondary" className="history-record-card__summary">
                      {recordSummary(row)}
                    </Text>
                  </div>

                  <div className="history-record-card__score" style={{ color: tone.color }}>
                    <TrophyOutlined />
                    <strong style={{ color: tone.color }}>{score}</strong>
                    <span style={{ color: tone.color, opacity: 0.78 }}>{tone.label}</span>
                  </div>
                </div>

                <div className="history-record-card__meta">
                  <span>{formatTime(row.created_at)}</span>
                  <span>{recordHint(row)}</span>
                </div>

                <div className="history-record-card__actions">
                  <Space size={10} wrap>
                    <Button type="primary" onClick={() => navigate(`/training/records/${row.id}`)}>
                      查看复盘
                    </Button>
                    <Button onClick={() => navigate("/train/prepare")}>再练一轮</Button>
                  </Space>
                  <Popconfirm
                    title="确认删除这条记录？"
                    description="删除后无法恢复。"
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                    onConfirm={() => handleDelete(row)}
                  >
                    <Button danger type="text" icon={<DeleteOutlined />}>
                      删除
                    </Button>
                  </Popconfirm>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
