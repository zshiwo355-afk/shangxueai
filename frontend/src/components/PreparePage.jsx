import {
  CheckCircleOutlined,
  LeftOutlined,
  RobotOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Card, Empty, Space, Tag, Typography } from "antd";
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
        <span className="prepare-panel__meta">{options.length} 项</span>
      </div>
      <div className="prepare-options">
        {options.map((option) => (
          <button
            type="button"
            key={option}
            disabled={disabled}
            className={`prepare-option${value === option ? " prepare-option--active" : ""}`}
            onClick={() => onChange(option)}
          >
            {option}
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
  const [optionsMap, setOptionsMap] = useState({
    training_type: [],
    difficulty: [],
    customer_type: [],
  });
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

        const difficulties = data?.difficulty || [];
        setDifficulty(difficulties.includes("中等") ? "中等" : difficulties[0] || "");
        setCustomerType((data?.customer_type || [])[0] || "");
      } catch (error) {
        message.error(error?.message || "训练配置加载失败。");
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
      message.warning("请先选完整。");
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
    } catch (error) {
      message.error(error?.message || "启动失败。");
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
    return (
      <div className="prepare-screen">
        <div style={{ color: "var(--text-mute)" }}>加载中...</div>
      </div>
    );
  }

  return (
    <div className="prepare-screen prepare-screen--workspace">
      <div className="prepare-workspace prepare-workspace--minimal">
        <section className="prepare-workspace__hero prepare-workspace__hero--lined">
          <div>
            <Button
              type="text"
              icon={<LeftOutlined />}
              className="prepare-workspace__back"
              onClick={() => navigate("/workspace/training")}
            >
              销售对练
            </Button>
            <Tag bordered={false} className="workspace-stage__eyebrow">开始训练</Tag>
            <Title level={1} className="prepare-workspace__title">
              先选训练参数
            </Title>
            <Paragraph className="prepare-workspace__subtitle">
              选好后直接进入对话。
            </Paragraph>
            <Space size={[8, 8]} wrap>
              <Tag bordered={false}>可随时结束</Tag>
              <Tag bordered={false}>自动复盘</Tag>
            </Space>
          </div>

          <Card className="prepare-brief-card prepare-brief-card--minimal" bordered={false}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              <div className="prepare-brief-card__icon">
                <RobotOutlined />
              </div>
              <div>
                <Title level={4} style={{ marginBottom: 6 }}>本次训练</Title>
                <Text type="secondary">系统会生成场景与客户。</Text>
              </div>
              <Space size={[8, 8]} wrap>
                {selectedTags.length
                  ? selectedTags.map((item) => <Tag bordered={false} color="blue" key={item}>{item}</Tag>)
                  : <Tag bordered={false}>待选择</Tag>}
              </Space>
              <div className="prepare-brief-card__steps">
                <div><CheckCircleOutlined /> 生成场景</div>
                <div><UserOutlined /> 进入对话</div>
                <div><CheckCircleOutlined /> 输出复盘</div>
              </div>
            </Space>
          </Card>
        </section>

        {noOptions ? (
          <Card className="prepare-panel prepare-panel--minimal" bordered={false}>
            <Empty description="训练选项暂未配置。" />
          </Card>
        ) : (
          <section className="prepare-workspace__content prepare-workspace__content--lined">
            <Card className="prepare-panel prepare-panel--minimal" bordered={false}>
              <Space direction="vertical" size={24} style={{ width: "100%" }}>
                <OptionGroup
                  label="训练类型"
                  options={optionsMap.training_type || []}
                  value={trainingType}
                  onChange={setTrainingType}
                  disabled={loading}
                />
                <OptionGroup
                  label="难度"
                  options={optionsMap.difficulty || []}
                  value={difficulty}
                  onChange={setDifficulty}
                  disabled={loading}
                />
                <OptionGroup
                  label="客户类型"
                  options={optionsMap.customer_type || []}
                  value={customerType}
                  onChange={setCustomerType}
                  disabled={loading}
                />
              </Space>
            </Card>

            <Card className="prepare-side-card prepare-side-card--minimal" bordered={false}>
              <Space direction="vertical" size={18} style={{ width: "100%" }}>
                <div>
                  <Title level={4} style={{ marginBottom: 6 }}>确认</Title>
                  <Paragraph type="secondary" style={{ marginBottom: 0 }}>
                    会话会自动保存。
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
                  随时可以结束。
                </div>

                <Button type="primary" size="large" loading={loading} onClick={handleSubmit} block>
                  {loading ? "准备中..." : "开始训练"}
                </Button>
              </Space>
            </Card>
          </section>
        )}
      </div>
    </div>
  );
}
