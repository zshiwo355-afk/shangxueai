import { CheckCircleOutlined, LeftOutlined, RobotOutlined, UserOutlined } from "@ant-design/icons";
import { Button, Card, Empty, App as AntdApp, Space, Tag, Typography } from "antd";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOptions } from "../lib/api.options";
import { startTraining } from "../lib/api.training";
import { saveActiveSession } from "../lib/storage";

const { Paragraph, Text, Title } = Typography;

function OptionGroup({ label, options, value, onChange, disabled }) {
  return (
    <div className="prepare-panel__group">
      <div className="prepare-panel__group-header">
        <span className="prepare-panel__label">{label}</span>
        <span className="prepare-panel__meta">{options.length} 项可选</span>
      </div>
      <div className="prepare-options">
        {options.map((opt) => (
          <button
            type="button"
            key={opt}
            disabled={disabled}
            className={`prepare-option${value === opt ? " prepare-option--active" : ""}`}
            onClick={() => onChange(opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function PreparePage() {
  const [trainingType, setTrainingType] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [customerType, setCustomerType] = useState("");
  const [optionsMap, setOptionsMap] = useState({ training_type: [], difficulty: [], customer_type: [] });
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchOptions();
        if (!alive) return;
        setOptionsMap(data || {});
        setTrainingType((data?.training_type || [])[0] || "");
        const diffs = data?.difficulty || [];
        setDifficulty(diffs.includes("中等") ? "中等" : diffs[0] || "");
        setCustomerType((data?.customer_type || [])[0] || "");
      } catch (err) {
        message.error(err?.message || "训练配置加载失败。");
      } finally {
        if (alive) setOptionsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [message]);

  const handleSubmit = async () => {
    if (!trainingType || !difficulty || !customerType) {
      message.warning("请先选择完整的训练参数。");
      return;
    }
    setLoading(true);
    try {
      const data = await startTraining({
        training_type: trainingType,
        difficulty,
        customer_type: customerType,
      });
      saveActiveSession({
        session_id: data.session_id,
        visible_brief: data.visible_brief,
        first_customer_message: data.first_customer_message,
        state: data.state,
        training_type: trainingType,
        difficulty,
        customer_type: customerType,
        mode: "training",
        chat_history: [{ role: "customer", content: data.first_customer_message }],
      });
      navigate(`/chat/${data.session_id}`);
    } catch (err) {
      message.error(err?.message || "训练启动失败。");
    } finally {
      setLoading(false);
    }
  };

  const noOptions =
    (optionsMap.training_type || []).length === 0
    || (optionsMap.difficulty || []).length === 0
    || (optionsMap.customer_type || []).length === 0;

  const selectedTags = useMemo(
    () => [trainingType, difficulty, customerType].filter(Boolean),
    [trainingType, difficulty, customerType],
  );

  if (optionsLoading) {
    return <div className="prepare-screen"><div style={{ color: "var(--text-mute)" }}>加载训练配置中…</div></div>;
  }

  return (
    <div className="prepare-screen prepare-screen--workspace">
      <div className="prepare-workspace">
        <section className="prepare-workspace__hero">
          <div>
            <Button type="text" icon={<LeftOutlined />} className="prepare-workspace__back" onClick={() => navigate("/workspace/training")}>
              返回销售对练
            </Button>
            <Tag bordered={false} className="workspace-hero__eyebrow">训练启动面板</Tag>
            <Title level={1} className="prepare-workspace__title">用一轮更清晰的配置，开始今天的销售对练</Title>
            <Paragraph className="prepare-workspace__subtitle">
              选择训练类型、难度和客户画像后，系统会立即生成对话上下文与首轮客户开场白，你可以直接进入实战模拟。
            </Paragraph>
            <Space size={[8, 8]} wrap>
              <Tag color="blue">至少 10 轮对话</Tag>
              <Tag color="gold">自动复盘评分</Tag>
              <Tag color="cyan">可沉淀训练记录</Tag>
            </Space>
          </div>

          <Card className="prepare-brief-card" bordered={false}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="prepare-brief-card__icon">
                <RobotOutlined />
              </div>
              <div>
                <Title level={4} style={{ marginBottom: 6 }}>本次训练摘要</Title>
                <Text type="secondary">确认好参数后，系统会根据选择生成一位对应画像的 AI 客户与你对练。</Text>
              </div>
              <Space size={[8, 8]} wrap>
                {selectedTags.length > 0 ? selectedTags.map((item) => <Tag key={item}>{item}</Tag>) : <Tag>待选择</Tag>}
              </Space>
              <div className="prepare-brief-card__steps">
                <div><CheckCircleOutlined /> AI 生成客户背景</div>
                <div><UserOutlined /> 进入模拟对话</div>
                <div><CheckCircleOutlined /> 输出复盘建议</div>
              </div>
            </Space>
          </Card>
        </section>

        {noOptions ? (
          <Card className="prepare-panel">
            <Empty description="管理员尚未配置训练选项，请先联系管理员完善训练参数。" />
          </Card>
        ) : (
          <section className="prepare-workspace__content">
            <Card className="prepare-panel" bordered={false}>
              <Space direction="vertical" size={24} style={{ width: "100%" }}>
                <OptionGroup
                  label="训练类型"
                  options={optionsMap.training_type || []}
                  value={trainingType}
                  onChange={setTrainingType}
                  disabled={loading}
                />
                <OptionGroup
                  label="难度等级"
                  options={optionsMap.difficulty || []}
                  value={difficulty}
                  onChange={setDifficulty}
                  disabled={loading}
                />
                <OptionGroup
                  label="客户画像"
                  options={optionsMap.customer_type || []}
                  value={customerType}
                  onChange={setCustomerType}
                  disabled={loading}
                />
              </Space>
            </Card>

            <Card className="prepare-side-card" bordered={false}>
              <Space direction="vertical" size={20} style={{ width: "100%" }}>
                <div>
                  <Title level={4} style={{ marginBottom: 6 }}>即将开始的训练</Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    确认以下组合后即可进入对练，会话将自动保存，方便稍后继续。
                  </Paragraph>
                </div>

                <div className="prepare-side-card__summary">
                  <div>
                    <span>训练类型</span>
                    <strong>{trainingType || "未选择"}</strong>
                  </div>
                  <div>
                    <span>难度</span>
                    <strong>{difficulty || "未选择"}</strong>
                  </div>
                  <div>
                    <span>客户类型</span>
                    <strong>{customerType || "未选择"}</strong>
                  </div>
                </div>

                <div className="prepare-side-card__tip">
                  建议先从熟悉的训练类型开始，再逐步提高难度，这样更容易看清复盘中的进步轨迹。
                </div>

                <Button type="primary" size="large" loading={loading} onClick={handleSubmit} block>
                  {loading ? "AI 正在准备训练包…" : "开始训练"}
                </Button>
              </Space>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
