import { App as AntdApp, Button, Checkbox, Form, Input, Modal, Radio, Select, Space, Typography } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { useEffect, useRef } from "react";

import {
  applyQuestionTypeDefaults,
  buildQuestionFormValues,
  buildQuestionPayload,
  normalizeQuestionType,
  QUESTION_TYPE_OPTIONS,
} from "./magicAcademyShared";

const { Text: TypographyText } = Typography;

export default function QuestionFormModal({ open, editing, pointId, onCancel, onSubmit }) {
  const [form] = Form.useForm();
  const { message } = AntdApp.useApp();
  const questionType = Form.useWatch("question_type", form);
  const correctIndexes = Form.useWatch("correct_indexes", form);
  const previousTypeRef = useRef(null);

  useEffect(() => {
    if (!open) {
      previousTypeRef.current = null;
      return;
    }
    const initialValues = buildQuestionFormValues(editing);
    form.setFieldsValue(initialValues);
    previousTypeRef.current = initialValues.question_type;
  }, [editing, form, open]);

  useEffect(() => {
    if (!open || !questionType) return;
    if (previousTypeRef.current == null) {
      previousTypeRef.current = questionType;
      return;
    }
    if (previousTypeRef.current === questionType) return;
    applyQuestionTypeDefaults(form, questionType);
    previousTypeRef.current = questionType;
  }, [form, open, questionType]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      await onSubmit(pointId, buildQuestionPayload(values, editing), editing);
    } catch (error) {
      if (!error?.errorFields) {
        message.error(error?.message || "请检查题目配置后再保存。");
      }
    }
  };

  const handleRemoveOption = (index, remove) => {
    const currentType = normalizeQuestionType(form.getFieldValue("question_type"));
    const currentValue = form.getFieldValue("correct_indexes");
    if (currentType === "multiple") {
      const nextValue = (Array.isArray(currentValue) ? currentValue : [])
        .map((item) => Number(item))
        .filter((item) => item !== index)
        .map((item) => (item > index ? item - 1 : item));
      remove(index);
      form.setFieldValue("correct_indexes", nextValue);
      return;
    }
    const selectedIndex = Number(currentValue);
    remove(index);
    if (!Number.isInteger(selectedIndex)) {
      form.setFieldValue("correct_indexes", undefined);
      return;
    }
    if (selectedIndex === index) {
      form.setFieldValue("correct_indexes", undefined);
      return;
    }
    form.setFieldValue("correct_indexes", selectedIndex > index ? selectedIndex - 1 : selectedIndex);
  };

  const renderQuestionConfig = () => {
    if (questionType === "fill") {
      return (
        <>
          <TypographyText type="secondary">支持多个可接受答案，每行一项，学员填写任意一项即视为正确。</TypographyText>
          <Form.List name="correct_answers">
            {(fields, { add, remove }) => (
              <Space direction="vertical" style={{ display: "flex", marginTop: 12 }}>
                {fields.map((field) => (
                  <Space key={field.key} align="start" style={{ display: "flex" }}>
                    <Form.Item
                      name={[field.name, "value"]}
                      rules={[{
                        validator: async (_, value) => {
                          if (String(value || "").trim()) return;
                          throw new Error("请输入可接受答案");
                        },
                      }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <Input placeholder="请输入一个可接受答案" />
                    </Form.Item>
                    <Button danger onClick={() => remove(field.name)} disabled={fields.length <= 1}>删除</Button>
                  </Space>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add({ value: "" })}>添加答案</Button>
              </Space>
            )}
          </Form.List>
        </>
      );
    }

    if (questionType === "short") {
      return (
        <>
          <TypographyText type="secondary">简答题可填写参考答案，后续用于人工批改或关键字判断。</TypographyText>
          <Form.Item label="参考答案" name="reference_answer" style={{ marginTop: 12, marginBottom: 0 }}>
            <Input.TextArea rows={4} placeholder="可选填写参考答案" />
          </Form.Item>
        </>
      );
    }

    return (
      <>
        <Form.List name="options">
          {(fields, { add, remove }) => (
            <Space direction="vertical" style={{ display: "flex" }}>
              {fields.map((field, index) => {
                const selectedSet = new Set(Array.isArray(correctIndexes) ? correctIndexes.map((item) => Number(item)) : []);
                const isRadioChecked = Number(correctIndexes) === index;
                const isJudge = questionType === "judge";
                return (
                  <Space key={field.key} align="start" style={{ display: "flex" }}>
                    {questionType === "multiple" ? (
                      <Checkbox
                        checked={selectedSet.has(index)}
                        onChange={(event) => {
                          const current = Array.isArray(correctIndexes) ? correctIndexes.map((item) => Number(item)) : [];
                          const next = event.target.checked
                            ? Array.from(new Set([...current, index])).sort((a, b) => a - b)
                            : current.filter((item) => item !== index);
                          form.setFieldValue("correct_indexes", next);
                        }}
                      />
                    ) : (
                      <Radio checked={isRadioChecked} onChange={() => form.setFieldValue("correct_indexes", index)} />
                    )}
                    <Form.Item
                      name={[field.name, "value"]}
                      rules={[{
                        validator: async (_, value) => {
                          if (String(value || "").trim()) return;
                          throw new Error("请输入选项内容");
                        },
                      }]}
                      style={{ flex: 1, marginBottom: 0 }}
                    >
                      <Input placeholder={isJudge ? "请输入判断选项文本" : `请输入选项 ${index + 1}`} />
                    </Form.Item>
                    {!isJudge ? (
                      <Button danger onClick={() => handleRemoveOption(field.name, remove)} disabled={fields.length <= 2}>删除</Button>
                    ) : null}
                  </Space>
                );
              })}
              {!questionType || questionType === "judge" ? null : (
                <Button icon={<PlusOutlined />} onClick={() => add({ value: "" })}>添加选项</Button>
              )}
            </Space>
          )}
        </Form.List>
        <Form.Item noStyle shouldUpdate>
          {() => (
            <Form.Item
              name="correct_indexes"
              style={{ marginTop: 12, marginBottom: 0 }}
              rules={[{
                validator: async (_, value) => {
                  if (questionType === "multiple") {
                    if (Array.isArray(value) && value.length > 0) return;
                    throw new Error("请至少选择一个正确答案");
                  }
                  if (Number.isInteger(Number(value))) return;
                  throw new Error("请选择正确答案");
                },
              }]}
            >
              <Input type="hidden" />
            </Form.Item>
          )}
        </Form.Item>
      </>
    );
  };

  return (
    <Modal open={open} title={editing ? "编辑题目" : "新增题目"} onCancel={onCancel} onOk={handleOk} destroyOnHidden>
      <Form form={form} layout="vertical" preserve={false}>
        <Form.Item label="题型" name="question_type" rules={[{ required: true, message: "请选择题型" }]}>
          <Select options={QUESTION_TYPE_OPTIONS} />
        </Form.Item>
        <Form.Item label="题目内容" name="stem" rules={[{ required: true, message: "请输入题目内容" }]}>
          <Input.TextArea rows={3} placeholder="请输入题目内容" />
        </Form.Item>
        <Form.Item
          label={questionType === "fill" ? "正确答案列表" : questionType === "short" ? "参考答案配置" : "选项配置"}
          style={{ marginBottom: 0 }}
        >
          {renderQuestionConfig()}
        </Form.Item>
      </Form>
    </Modal>
  );
}
