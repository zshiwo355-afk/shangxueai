import { useCallback, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, DatePicker, Empty, Select, Space, Table, Tag, Typography } from "antd";
import { SoundOutlined } from "@ant-design/icons";
import dayjs from "dayjs";

import { fetchAdminAudiosByDate, transcribeAdminAudio } from "../../../../lib/api.magic";

const { Text, Paragraph } = Typography;

const TRANSCRIPT_STATUS_META = {
  done: { color: "success", label: "已完成" },
  processing: { color: "processing", label: "转写中" },
  failed: { color: "error", label: "失败" },
  "": { color: "default", label: "未转写" },
};

export default function AdminAudioTranscribePanel({ users = [] }) {
  const { message } = AntdApp.useApp();
  const [selectedDate, setSelectedDate] = useState(() => dayjs());
  const [department, setDepartment] = useState("");
  const [userId, setUserId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [rows, setRows] = useState([]);
  const [transcribingId, setTranscribingId] = useState(null);

  const departmentOptions = useMemo(
    () => Array.from(new Set(users.map((item) => item.department).filter(Boolean))).map((item) => ({ value: item, label: item })),
    [users],
  );
  const userOptions = useMemo(
    () => users
      .filter((item) => item.role === "user" || item.role === "admin")
      .map((item) => ({ value: item.id, label: `${item.real_name || item.display_name || item.username} (${item.username})` })),
    [users],
  );

  const handleQuery = useCallback(async () => {
    if (!selectedDate) {
      message.warning("请先选择日期。");
      return;
    }
    setLoading(true);
    try {
      const result = await fetchAdminAudiosByDate({
        date: selectedDate.format("YYYY-MM-DD"),
        department: department || undefined,
        user_id: userId || undefined,
      });
      setRows(Array.isArray(result?.items) ? result.items : []);
      setLoaded(true);
    } catch (error) {
      message.error(error?.message || "录音列表加载失败。");
    } finally {
      setLoading(false);
    }
  }, [selectedDate, department, userId, message]);

  const handleTranscribe = useCallback(async (row) => {
    setTranscribingId(row.id);
    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, transcript_status: "processing" } : item)));
    try {
      const result = await transcribeAdminAudio(row.id);
      setRows((prev) => prev.map((item) => (item.id === row.id
        ? { ...item, transcript_status: result?.transcript_status || "done", transcript_text: result?.transcript_text || "", transcribed_at: result?.transcribed_at || item.transcribed_at }
        : item)));
      message.success("转写完成。");
    } catch (error) {
      setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, transcript_status: "failed" } : item)));
      message.error(error?.message || "录音转写失败。");
    } finally {
      setTranscribingId(null);
    }
  }, [message]);

  const columns = [
    { title: "员工", dataIndex: "user_name", width: 140, render: (value) => value || "—" },
    { title: "部门", dataIndex: "department", width: 140, render: (value) => value || "—" },
    { title: "文件名", dataIndex: "file_name", width: 180, ellipsis: true, render: (value) => value || "未命名录音" },
    {
      title: "上传时间",
      dataIndex: "uploaded_time",
      width: 170,
      render: (value) => value?.replace("T", " ").slice(0, 19) || "—",
    },
    {
      title: "录音",
      dataIndex: "audio_play_url",
      width: 260,
      render: (value) => (value
        ? <audio controls preload="none" src={value} style={{ width: 240, height: 36 }} />
        : <Text type="secondary">无录音</Text>),
    },
    {
      title: "转写状态",
      dataIndex: "transcript_status",
      width: 100,
      render: (value) => {
        const meta = TRANSCRIPT_STATUS_META[value || ""] || TRANSCRIPT_STATUS_META[""];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: "转写文本",
      dataIndex: "transcript_text",
      render: (value) => (value
        ? <Paragraph style={{ marginBottom: 0, maxWidth: 420 }} ellipsis={{ rows: 3, expandable: true, symbol: "展开" }}>{value}</Paragraph>
        : <Text type="secondary">—</Text>),
    },
    {
      title: "操作",
      width: 110,
      fixed: "right",
      render: (_, row) => {
        const isProcessing = transcribingId === row.id || row.transcript_status === "processing";
        const done = row.transcript_status === "done";
        return (
          <Button
            size="small"
            type="primary"
            icon={<SoundOutlined />}
            loading={isProcessing}
            disabled={isProcessing}
            onClick={() => handleTranscribe(row)}
          >
            {done ? "重新转写" : "转文字"}
          </Button>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card>
        <Space wrap>
          <DatePicker
            allowClear={false}
            value={selectedDate}
            onChange={(value) => setSelectedDate(value)}
            placeholder="选择日期"
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 200 }}
            placeholder="按部门筛选"
            value={department || undefined}
            onChange={(value) => setDepartment(value || "")}
            options={departmentOptions}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 240 }}
            placeholder="按员工筛选"
            value={userId || undefined}
            onChange={(value) => setUserId(value || null)}
            options={userOptions}
          />
          <Button type="primary" loading={loading} onClick={handleQuery}>查询</Button>
        </Space>
      </Card>
      <Card>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={rows}
          columns={columns}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          locale={{ emptyText: loaded ? <Empty description="当天暂无录音提交" /> : <Empty description="请选择日期后点击查询" /> }}
        />
      </Card>
    </Space>
  );
}
