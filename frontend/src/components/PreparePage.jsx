import { Button, Empty, App as AntdApp } from "antd";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchOptions } from "../lib/api.options";
import { startTraining } from "../lib/api.training";
import { saveActiveSession } from "../lib/storage";

function OptionGroup({ label, options, value, onChange, disabled }) {
  return (
    <div className="prepare-section">
      <span className="prepare-section__label">{label}</span>
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
        // 默认选第一个
        setTrainingType((data?.training_type || [])[0] || "");
        const diffs = data?.difficulty || [];
        setDifficulty(diffs.includes("中等") ? "中等" : diffs[0] || "");
        setCustomerType((data?.customer_type || [])[0] || "");
      } catch (err) {
        message.error(err?.message || "下拉项加载失败。");
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
      message.warning("请先选择全部三项参数。");
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

  if (optionsLoading) {
    return <div className="prepare-screen"><div style={{ color: "var(--text-mute)" }}>加载选项中…</div></div>;
  }

  const noOptions =
    (optionsMap.training_type || []).length === 0 ||
    (optionsMap.difficulty || []).length === 0 ||
    (optionsMap.customer_type || []).length === 0;

  return (
    <div className="prepare-screen">
      <div className="prepare-hero">
        <div className="prepare-emblem">商</div>
        <h1 className="prepare-title">立即训练</h1>
        <p className="prepare-subtitle">
          自由选择训练类型与客户画像，AI 客户将与你进行至少 10 轮模拟对话。
          <br />
          完成后给出维度评分、关键转折点与更优话术建议。
        </p>
      </div>

      {noOptions ? (
        <Empty description="管理员尚未配置任何训练选项，请联系管理员" />
      ) : (
        <div className="prepare-form">
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

          <div className="prepare-cta">
            <Button type="primary" size="large" loading={loading} onClick={handleSubmit}>
              {loading ? "AI 正在准备训练包…" : "开始训练"}
            </Button>
          </div>
          <div style={{ textAlign: "center", marginTop: 12 }}>
            <Button type="link" onClick={() => navigate("/home")}>返回首页</Button>
          </div>
        </div>
      )}
    </div>
  );
}
