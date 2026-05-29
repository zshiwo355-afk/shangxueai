import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  FolderOpenOutlined,
  InboxOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App as AntdApp,
  Badge,
  Button,
  Col,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Steps,
  Table,
  Tabs,
  Tag,
  Upload,
} from "antd";
import { useState } from "react";

import {
  commitMagicQuizImportJob,
  getMagicQuizImportJob,
  updateMagicQuizImportRow,
  uploadMagicQuizImportFile,
} from "../../lib/api.magic";
import MaterialAssetPickerModal, { fetchMaterialAssetAsFile } from "../common/MaterialAssetPickerModal";

const { Step } = Steps;
const { Dragger } = Upload;

const QUESTION_TYPES = [
  { value: "single", label: "单选" },
  { value: "multiple", label: "多选" },
  { value: "judge", label: "判断" },
  { value: "blank", label: "填空" },
];

function letterFor(idx) {
  return String.fromCharCode("A".charCodeAt(0) + idx);
}

export default function QuizImportModal({ open, pointId, source = "upload", onClose, onCommitted }) {
  const { message } = AntdApp.useApp();
  const [step, setStep] = useState(0);
  const [job, setJob] = useState(null);
  const [editingRow, setEditingRow] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const reset = () => {
    setStep(0);
    setJob(null);
    setEditingRow(null);
    setPickerOpen(false);
  };

  const handleClose = () => {
    onClose?.();
    window.setTimeout(reset, 300);
  };

  const onUpload = async (file) => {
    if (!pointId) {
      message.error("请先选择答题节点。");
      return false;
    }
    setUploading(true);
    try {
      const data = await uploadMagicQuizImportFile(pointId, file);
      setJob(data);
      setStep(1);
      message.success(`已解析 ${data?.summary?.total ?? 0} 题，合法 ${data?.summary?.valid ?? 0} / 异常 ${data?.summary?.invalid ?? 0}。`);
    } catch (err) {
      message.error(err?.message || "解析失败。");
    } finally {
      setUploading(false);
    }
    return false;
  };

  const onPickFromMaterial = async (asset) => {
    try {
      const file = await fetchMaterialAssetAsFile(asset);
      setPickerOpen(false);
      await onUpload(file);
    } catch (err) {
      message.error(err?.message || "从素材库导入失败。");
    }
  };

  const refreshJob = async () => {
    if (!job?.job_id) return;
    try {
      const data = await getMagicQuizImportJob(job.job_id);
      setJob(data);
    } catch (err) {
      message.error(err?.message || "刷新失败。");
    }
  };

  const doCommit = async () => {
    if (!pointId || !job?.job_id) return;
    try {
      const data = await commitMagicQuizImportJob(pointId, job.job_id);
      setJob(data);
      setStep(2);
      message.success(`已成功导入 ${data?.committed_count ?? 0} 题。`);
      onCommitted?.();
    } catch (err) {
      message.error(err?.message || "导入失败。");
    }
  };

  const validRows = (job?.rows || []).filter((row) => row.ok);
  const invalidRows = (job?.rows || []).filter((row) => !row.ok);

  const baseColumns = [
    { title: "行号", dataIndex: "idx", width: 60, render: (v) => v + 2 },
    {
      title: "状态",
      dataIndex: "ok",
      width: 80,
      render: (v) => v ? <Tag icon={<CheckCircleOutlined />} color="success">合法</Tag> : <Tag icon={<CloseCircleOutlined />} color="error">异常</Tag>,
    },
    {
      title: "题型",
      width: 80,
      render: (_, row) => {
        const type = row.data?.question_type || row.raw?.question_type;
        return QUESTION_TYPES.find((item) => item.value === type)?.label || type || "-";
      },
    },
    {
      title: "题干",
      ellipsis: true,
      render: (_, row) => row.data?.stem || row.raw?.stem || "",
    },
    {
      title: "正确答案",
      width: 180,
      ellipsis: true,
      render: (_, row) => {
        const answers = row.data?.correct_answer;
        if (Array.isArray(answers)) return answers.join(", ");
        return row.raw?.correct_answer || "";
      },
    },
    { title: "分值", width: 70, render: (_, row) => row.data?.default_score ?? row.raw?.score ?? "-" },
    {
      title: "操作",
      width: 100,
      render: (_, row) => <Button size="small" onClick={() => setEditingRow(row)}>编辑</Button>,
    },
  ];

  const errorsCol = {
    title: "错误",
    render: (_, row) => row.errors?.length ? (
      <Space direction="vertical" size={0}>
        {row.errors.map((item, index) => <Tag key={index} color="red" bordered={false}>{item}</Tag>)}
      </Space>
    ) : "-",
  };

  return (
    <Modal
      open={open}
      title={source === "material" ? "从素材库导入视频题目" : "Excel导入视频题目"}
      onCancel={handleClose}
      width={1000}
      footer={null}
      destroyOnHidden
    >
      <Steps current={step} style={{ marginBottom: 16 }}>
        <Step title="上传文件" />
        <Step title="预览校验" />
        <Step title="确认导入" />
      </Steps>

      {step === 0 ? (
        <div>
          <Alert
            type="info"
            showIcon
            message={
              source === "material"
                ? "支持 .xlsx 和 .docx；仅允许单选、多选、判断、填空题。请先按模板填写并上传到素材库，再从素材库选择导入。"
                : "支持 .xlsx 和 .docx；仅允许单选、多选、判断、填空题。可直接上传本地 Excel/Word 文件导入。"
            }
            style={{ marginBottom: 16 }}
          />
          {source === "material" ? (
            <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
              <Button
                icon={<FolderOpenOutlined />}
                onClick={() => setPickerOpen(true)}
                disabled={uploading}
              >
                从素材库选择
              </Button>
            </div>
          ) : null}
          <Dragger
            multiple={false}
            accept=".xlsx,.docx"
            beforeUpload={onUpload}
            showUploadList={false}
            disabled={uploading}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{source === "material" ? "也支持直接上传本地文件到此区域" : "点击或拖拽文件到此区域"}</p>
            <p className="ant-upload-hint">
              {source === "material"
                ? "仅接受 .xlsx / .docx；也可点击右上角从素材库选择已上传的文件"
                : "仅接受 .xlsx / .docx"}
            </p>
          </Dragger>
        </div>
      ) : null}

      {step === 1 && job ? (
        <div>
          <Space style={{ marginBottom: 12 }}>
            <span>共 <strong>{job.summary.total}</strong> 题，</span>
            <Tag color="success">合法 {job.summary.valid}</Tag>
            <Tag color="error">异常 {job.summary.invalid}</Tag>
            <Button size="small" icon={<ReloadOutlined />} onClick={refreshJob}>刷新</Button>
          </Space>
          <Tabs
            items={[
              {
                key: "valid",
                label: <Badge count={validRows.length} offset={[8, 0]} color="green">合法</Badge>,
                children: (
                  <Table
                    rowKey="idx"
                    size="small"
                    dataSource={validRows}
                    columns={baseColumns}
                    pagination={{ pageSize: 8 }}
                  />
                ),
              },
              {
                key: "invalid",
                label: <Badge count={invalidRows.length} offset={[8, 0]} color="red">异常</Badge>,
                children: (
                  <Table
                    rowKey="idx"
                    size="small"
                    dataSource={invalidRows}
                    columns={[...baseColumns, errorsCol]}
                    pagination={{ pageSize: 8 }}
                  />
                ),
              },
            ]}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
            <Space>
              <Button onClick={handleClose}>取消</Button>
              <Button onClick={() => setStep(0)}>重新上传</Button>
              <Button type="primary" disabled={!validRows.length} onClick={doCommit}>
                确认导入（{validRows.length} 题）
              </Button>
            </Space>
          </div>
        </div>
      ) : null}

      {step === 2 && job ? (
        <Alert
          type="success"
          showIcon
          message={`已成功导入 ${job.committed_count} 题。`}
          description="可关闭弹窗，回到视频答题节点查看。"
          action={<Button type="primary" onClick={handleClose}>关闭</Button>}
        />
      ) : null}

      {editingRow ? (
        <EditRowModal
          key={editingRow.idx}
          row={editingRow}
          jobId={job?.job_id}
          onCancel={() => setEditingRow(null)}
          onSaved={(updatedJob) => {
            setJob(updatedJob);
            setEditingRow(null);
          }}
        />
      ) : null}

      <MaterialAssetPickerModal
        open={pickerOpen}
        onCancel={() => setPickerOpen(false)}
        onPick={onPickFromMaterial}
        title="从素材库选择题目文件"
        acceptExtensions={["xlsx", "docx"]}
        hint="仅展示素材库中的 .xlsx / .docx 文件。"
        pickButtonText="使用此文件"
      />
    </Modal>
  );
}

function EditRowModal({ row, jobId, onCancel, onSaved }) {
  const { message } = AntdApp.useApp();
  const [form] = Form.useForm();

  const data = row.data || row.raw || {};
  const correctRaw = row.raw?.correct_answer;
  const correctText = Array.isArray(data.correct_answer)
    ? data.correct_answer.join(",")
    : (data.correct_answer ?? correctRaw ?? "");

  const initialValues = {
    question_type: data.question_type || row.raw?.question_type || undefined,
    stem: data.stem || row.raw?.stem || "",
    options: data.options && data.options.length
      ? data.options
      : (row.raw?.options?.length ? row.raw.options : ["", ""]),
    correct_answer: correctText,
    score: data.default_score ?? row.raw?.score ?? 5,
    category: data.category || row.raw?.category || "",
    tag: data.tag || row.raw?.tag || "",
    difficulty: data.difficulty || row.raw?.difficulty || "",
    explanation: data.explanation || row.raw?.explanation || "",
  };

  const handleOk = async () => {
    let values;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    try {
      const updated = await updateMagicQuizImportRow(jobId, row.idx, {
        question_type: values.question_type,
        stem: values.stem,
        options: (values.options || []).filter((item) => (item || "").trim()),
        correct_answer: values.correct_answer,
        score: values.score,
        category: values.category,
        tag: values.tag,
        difficulty: values.difficulty,
        explanation: values.explanation,
      });
      message.success("已更新该行。");
      onSaved(updated);
    } catch (err) {
      message.error(err?.message || "更新失败。");
    }
  };

  return (
    <Modal
      open
      title={`编辑第 ${(row.idx ?? 0) + 2} 行`}
      onCancel={onCancel}
      onOk={handleOk}
      okText="保存并校验"
      cancelText="取消"
      width={680}
      destroyOnHidden
    >
      <Form form={form} layout="vertical" preserve={false} initialValues={initialValues}>
        <Form.Item label="题型" name="question_type" rules={[{ required: true }]}>
          <Select options={QUESTION_TYPES} />
        </Form.Item>
        <Form.Item label="题干" name="stem" rules={[{ required: true }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Form.List name="options">
          {(fields, { add, remove }) => (
            <>
              <div style={{ marginBottom: 6 }}>选项</div>
              {fields.map((field, idx) => (
                <Space key={field.key} style={{ display: "flex", marginBottom: 6 }}>
                  <Tag>{letterFor(idx)}</Tag>
                  <Form.Item {...field} name={field.name} style={{ marginBottom: 0 }}>
                    <Input style={{ width: 460 }} />
                  </Form.Item>
                  <Button type="link" danger onClick={() => remove(field.name)}>移除</Button>
                </Space>
              ))}
              <Button type="dashed" onClick={() => add("")} disabled={fields.length >= 6}>新增选项</Button>
            </>
          )}
        </Form.List>
        <Form.Item label="正确答案（单选填字母如 B；多选如 AB 或 A,B；判断填 对/错；填空多空用 | 分隔）" name="correct_answer">
          <Input />
        </Form.Item>
        <Row gutter={12}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="分值" name="score">
              <InputNumber min={0.5} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="分类" name="category">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="标签" name="tag">
              <Input />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item label="难度" name="difficulty">
              <Input />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item label="解析" name="explanation">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
