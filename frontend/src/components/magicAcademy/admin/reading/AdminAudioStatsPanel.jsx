import { DownloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  Card,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";

export default function AdminAudioStatsPanel({
  audioStatsState,
  audioStatsActions,
  audioStatsDeps,
}) {
  const { Text } = Typography;
  const {
    audioMakeupSetting,
    audioMonth,
    audioDateRange,
    audioReadingContentId,
    audioDepartment,
    audioUserId,
    audioStatusFilter,
    audioReadingOptions,
    audioLegacyHint,
    audioReadingStatsRows,
    users,
  } = audioStatsState;
  const {
    setAudioMakeupSetting,
    handleSaveAudioMakeupSetting,
    setAudioMonth,
    setAudioDateRange,
    setAudioReadingContentId,
    setAudioDepartment,
    setAudioUserId,
    setAudioStatusFilter,
    reloadAdminReadingAudioStats,
    handleOpenAudioExportModal,
    openAudioDetail,
  } = audioStatsActions;
  const { RangePicker, message } = audioStatsDeps;

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Card title="补卡设置">
        <Space wrap align="center">
          <Text>开启补卡</Text>
          <Switch
            checked={!!audioMakeupSetting.enabled}
            onChange={(checked) => setAudioMakeupSetting((prev) => ({ ...prev, enabled: checked }))}
          />
          <Text>允许补卡天数</Text>
          <InputNumber
            min={0}
            max={365}
            value={Number(audioMakeupSetting.make_up_days || 0)}
            onChange={(value) => setAudioMakeupSetting((prev) => ({ ...prev, make_up_days: Number(value || 0) }))}
          />
          <Button type="primary" onClick={handleSaveAudioMakeupSetting}>保存设置</Button>
          <Text type="secondary">{audioMakeupSetting.description || "当前未开启补卡"}</Text>
        </Space>
      </Card>
      <Card>
        <Space wrap>
          <Input style={{ width: 160 }} placeholder="YYYY-MM" value={audioMonth} onChange={(e) => setAudioMonth(e.target.value)} />
          <RangePicker value={audioDateRange} onChange={setAudioDateRange} />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 320 }}
            placeholder="选择读书内容"
            value={audioReadingContentId || undefined}
            onChange={(value) => setAudioReadingContentId(value || null)}
            options={audioReadingOptions.map((item) => ({
              value: item.reading_content_id || item.id,
              label: `${item.reading_date} ${(item.push_at || "").replace("T", " ").slice(11, 16)} ${item.title}`,
            }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 220 }}
            placeholder="按部门筛选"
            value={audioDepartment || undefined}
            onChange={(value) => setAudioDepartment(value || "")}
            options={Array.from(new Set(users.map((item) => item.department).filter(Boolean))).map((item) => ({ value: item, label: item }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            style={{ width: 220 }}
            placeholder="按员工筛选"
            value={audioUserId || undefined}
            onChange={(value) => setAudioUserId(value || null)}
            options={users.filter((item) => item.role === "user" || item.role === "admin").map((item) => ({ value: item.id, label: `${item.real_name || item.display_name || item.username} (${item.username})` }))}
          />
          <Select
            style={{ width: 180 }}
            value={audioStatusFilter}
            onChange={setAudioStatusFilter}
            options={[
              { value: "all", label: "全部状态" },
              { value: "completed", label: "已完成" },
              { value: "deleted", label: "已删除记录" },
              { value: "pending", label: "未完成" },
              { value: "expired", label: "已过补卡截止时间" },
              { value: "future", label: "未到推送时间" },
            ]}
          />
          <Button type="primary" onClick={() => reloadAdminReadingAudioStats().catch((error) => message.error(error?.message || "读书内容统计加载失败。"))}>
            查询
          </Button>
          <Button icon={<DownloadOutlined />} onClick={handleOpenAudioExportModal}>导出 Excel</Button>
        </Space>
      </Card>
      <Card>
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {audioLegacyHint ? <Alert type="info" showIcon message={audioLegacyHint} /> : null}
          <Table
            rowKey="reading_content_id"
            dataSource={audioReadingStatsRows}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: "日期", dataIndex: "reading_date", width: 110 },
              { title: "推送时间", dataIndex: "push_at", width: 170, render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
              { title: "标题", dataIndex: "title" },
              { title: "推送对象", dataIndex: "target_summary", width: 180, render: (value) => value || "—" },
              { title: "应完成人数", dataIndex: "expected_count", width: 100 },
              { title: "已完成", dataIndex: "completed_count", width: 90 },
              { title: "已删除记录", dataIndex: "deleted_count", width: 110 },
              { title: "未完成", dataIndex: "pending_count", width: 90 },
              { title: "完成率", dataIndex: "completion_rate", width: 100, render: (value) => `${value || 0}%` },
              { title: "补卡截止时间", dataIndex: "makeup_deadline_at", width: 170, render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
              { title: "已过截止", dataIndex: "is_deadline_passed", width: 90, render: (value) => value ? <Tag bordered={false} color="default">是</Tag> : "否" },
              { title: "已有打卡", dataIndex: "has_checkins", width: 90, render: (value) => value ? <Tag bordered={false} color="success">是</Tag> : "否" },
              { title: "操作", width: 100, render: (_, row) => <Button size="small" onClick={() => openAudioDetail(row)}>查看明细</Button> },
            ]}
          />
        </Space>
      </Card>
    </Space>
  );
}
