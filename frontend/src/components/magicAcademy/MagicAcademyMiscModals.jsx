import { Button, Card, Form, Input, InputNumber, Modal, Space, Switch, Typography } from "antd";
import { formatTime, renderQuestionAnswer } from "./magicAcademyShared";

const { Paragraph } = Typography;

export function WatchConfirmModal({ open, message, buttonText, onContinue }) {
  return (
    <Modal
      open={open}
      title="观看确认"
      closable={false}
      maskClosable={false}
      keyboard={false}
      footer={[
        <Button key="continue" type="primary" onClick={onContinue}>
          {buttonText || "继续学习"}
        </Button>,
      ]}
    >
      <Paragraph style={{ marginBottom: 0 }}>
        {message || "请确认你正在观看视频"}
      </Paragraph>
    </Modal>
  );
}

export function SeriesFormModal({ editing, form, onCancel, onOk }) {
  return (
    <Modal
      open={!!editing}
      title={editing?.id ? "编辑系列" : "新增系列"}
      onCancel={onCancel}
      onOk={onOk}
      okText="保存"
      cancelText="取消"
      destroyOnHidden={false}
      forceRender
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={editing || { enabled: true, sequential_unlock_enabled: true }}
      >
        <Form.Item label="系列名称" name="title" rules={[{ required: true, message: "请输入系列名称" }]}>
          <Input placeholder="例如：新人入职系列" />
        </Form.Item>
        <Form.Item label="系列描述" name="description">
          <Input.TextArea rows={3} placeholder="系列说明（选填）" />
        </Form.Item>
        <Form.Item label="启用顺序解锁" name="sequential_unlock_enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="启用系列" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function QuizPointFormModal({ editing, form, onCancel, onOk }) {
  return (
    <Modal
      open={!!editing}
      title={editing?.id ? "编辑答题节点" : "新增答题节点"}
      onCancel={onCancel}
      onOk={onOk}
      destroyOnHidden={false}
      forceRender
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        initialValues={editing || { trigger_second: 0, question_count: 0, pass_score: 100, enabled: true }}
      >
        <Form.Item label="触发时间（秒）" name="trigger_second" rules={[{ required: true, message: "请输入触发时间" }]}>
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="题目数量" name="question_count">
          <InputNumber min={0} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label="启用" name="enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function QuizAnswerModal({ state, setState, onSubmit }) {
  return (
    <Modal
      open={state.open}
      title={state.point ? `答题节点 ${formatTime(state.point.trigger_second)}` : "答题"}
      onCancel={() => {}}
      onOk={onSubmit}
      closable={false}
      maskClosable={false}
      okText="提交答案"
      cancelButtonProps={{ style: { display: "none" } }}
      width={720}
    >
      <Space direction="vertical" style={{ width: "100%" }} size={16}>
        {(state.point?.questions || []).map((question, index) => (
          <Card key={question.id} size="small" title={`${index + 1}. ${question.stem}`}>
            {renderQuestionAnswer(question, state.values[question.id], (value) => {
              setState((prev) => ({
                ...prev,
                values: { ...prev.values, [question.id]: value },
              }));
            })}
          </Card>
        ))}
      </Space>
    </Modal>
  );
}
