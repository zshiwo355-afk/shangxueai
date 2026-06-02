import {
  Button,
  Card,
  DatePicker,
  Image,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  DownOutlined,
  DownloadOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  RightOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";
import {
  READING_SERIES_STATUS_FILTER_OPTIONS,
  READING_SERIES_STATUS_META,
} from "./magicAcademyPageConfig";
import { buildReadingContentImageUrl } from "../../lib/api.magic";
import { getSeriesTargetSummary } from "./magicAcademyPageHelpers";
import { getReadingTargetSummary, saveBlob } from "./magicAcademyShared";

function getPushStatusMeta(status) {
  if (status === "sent") return { label: "已推送", color: "success" };
  if (status === "partial") return { label: "部分成功", color: "warning" };
  if (status === "failed") return { label: "推送失败", color: "error" };
  if (status === "pending") return { label: "待推送", color: "default" };
  if (status === "running") return { label: "推送中", color: "processing" };
  return { label: "未推送", color: "default" };
}

export function buildReadingAdminTabItems({
  readingContentMonth,
  setReadingContentMonth,
  readingContentKeyword,
  setReadingContentKeyword,
  setReadingContentPage,
  readingContentPageSize,
  setReadingContentPageSize,
  readingContentSeriesId,
  setReadingContentSeriesId,
  readingSeriesRows = [],
  downloadMagicFile,
  handlePreviewReadingImport,
  openReadingImportMaterialPicker,
  readingImportSubmitting,
  openCreateReadingContentModal,
  readingContents = [],
  readingContentPage,
  readingContentsTotal,
  selectedReadingContentRowKeys,
  setSelectedReadingContentRowKeys,
  openEditReadingContentModal,
  handleToggleReadingContentStatus,
  handleDeleteReadingContent,
  handleBatchDeleteReadingContents,
  handleBatchDisableReadingContents,
  readingPushSummaryMap = {},
  handleOpenReadingPushDetail,
  handleRetryReadingPush,
  retryingReadingContentId,
  readingSeriesKeyword,
  setReadingSeriesKeyword,
  readingSeriesPage,
  setReadingSeriesPage,
  readingSeriesTotal,
  readingSeriesStatus,
  setReadingSeriesStatus,
  openReadingSeriesModal,
  openReadingSeriesDetail,
  handleToggleReadingSeriesStatus,
  handleArchiveReadingSeries,
}) {
  const groupedReadingContents = [];
  const seriesRowsMap = new Map();

  for (const item of readingContents) {
    if (!item.series_id) {
      groupedReadingContents.push({ ...item, _rowType: "content" });
      continue;
    }
    const groupKey = `series-${item.series_id}`;
    let seriesRow = seriesRowsMap.get(groupKey);
    if (!seriesRow) {
      seriesRow = {
        id: groupKey,
        _rowType: "series",
        series_id: item.series_id,
        series_title: item.series_title || "未命名系列",
        title: item.series_title || "未命名系列",
        reading_date: "",
        push_at: "",
        push_count: 0,
        completed_count: 0,
        pending_count: 0,
        completion_rate: 0,
        makeup_deadline_at: "",
        creator_name: item.creator_name || "",
        created_at: item.created_at || "",
        children: [],
      };
      seriesRowsMap.set(groupKey, seriesRow);
      groupedReadingContents.push(seriesRow);
    }
    seriesRow.children.push({ ...item, _rowType: "content" });
    seriesRow.push_count += Number(item.push_count || 0);
    seriesRow.completed_count += Number(item.completed_count || 0);
    seriesRow.pending_count += Number(item.pending_count || 0);
    if (!seriesRow.makeup_deadline_at || (item.makeup_deadline_at && item.makeup_deadline_at > seriesRow.makeup_deadline_at)) {
      seriesRow.makeup_deadline_at = item.makeup_deadline_at || seriesRow.makeup_deadline_at;
    }
    if (!seriesRow.created_at || (item.created_at && item.created_at < seriesRow.created_at)) {
      seriesRow.created_at = item.created_at || seriesRow.created_at;
    }
  }

  for (const row of groupedReadingContents) {
    if (row._rowType !== "series") continue;
    const total = Number(row.push_count || 0);
    const completed = Number(row.completed_count || 0);
    row.completion_rate = total ? Number(((completed / total) * 100).toFixed(2)) : 0;
  }

  const buildSeriesCell = (content, span = 1) => ({
    children: content,
    props: { colSpan: span },
  });

  const hideSeriesCell = () => ({
    children: null,
    props: { colSpan: 0 },
  });

  return [
    {
      key: "reading_contents",
      label: "读书内容推送",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
              <Space wrap>
                <DatePicker
                  picker="month"
                  allowClear={false}
                  style={{ width: 160 }}
                  value={readingContentMonth ? dayjs(`${readingContentMonth}-01`) : null}
                  format="YYYY-MM"
                  onChange={(value) => {
                    setReadingContentMonth(value ? value.format("YYYY-MM") : dayjs().format("YYYY-MM"));
                    setReadingContentPage(1);
                  }}
                />
                <Input.Search
                  style={{ width: 240 }}
                  placeholder="搜索标题/描述"
                  value={readingContentKeyword}
                  onChange={(e) => {
                    setReadingContentKeyword(e.target.value);
                    setReadingContentPage(1);
                  }}
                  onSearch={(value) => {
                    setReadingContentKeyword(value);
                    setReadingContentPage(1);
                  }}
                />
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  style={{ width: 220 }}
                  placeholder="按读书系列筛选"
                  value={readingContentSeriesId || undefined}
                  onChange={(value) => {
                    setReadingContentSeriesId(value || null);
                    setReadingContentPage(1);
                  }}
                  options={[
                    { value: 0, label: "未归属系列" },
                    ...readingSeriesRows.map((item) => ({ value: item.id, label: item.title })),
                  ]}
                />
              </Space>
              <Space wrap>
                <Button
                  disabled={!selectedReadingContentRowKeys.length}
                  onClick={handleBatchDisableReadingContents}
                >
                  批量停用
                </Button>
                <Popconfirm
                  title="批量删除选中的读书内容？"
                  description="已有打卡记录的内容不会被删除。"
                  onConfirm={handleBatchDeleteReadingContents}
                  okText="确认删除"
                  cancelText="取消"
                  disabled={!selectedReadingContentRowKeys.length}
                >
                  <Button danger disabled={!selectedReadingContentRowKeys.length}>
                    批量删除
                  </Button>
                </Popconfirm>
                <Button
                  icon={<DownloadOutlined />}
                  onClick={async () => saveBlob(await downloadMagicFile("/api/magic-academy/admin/reading-contents/template"))}
                >
                  下载 Excel 模板
                </Button>
                <Upload showUploadList={false} beforeUpload={handlePreviewReadingImport}>
                  <Button loading={readingImportSubmitting} icon={<UploadOutlined />}>Excel 导入</Button>
                </Upload>
                <Button
                  loading={readingImportSubmitting}
                  icon={<FolderOpenOutlined />}
                  onClick={openReadingImportMaterialPicker}
                >
                  从素材库导入
                </Button>
                <Button type="primary" icon={<PlusOutlined />} onClick={openCreateReadingContentModal}>
                  新增读书内容
                </Button>
              </Space>
            </Space>
          </Card>
          <Card>
            <Table
              rowKey="id"
              dataSource={groupedReadingContents}
              scroll={{ x: 1400 }}
              rowSelection={{
                selectedRowKeys: selectedReadingContentRowKeys,
                onChange: setSelectedReadingContentRowKeys,
                checkStrictly: false,
                getCheckboxProps: (row) => ({ disabled: row._rowType !== "content" }),
              }}
              expandable={{
                rowExpandable: (row) => row._rowType === "series" && Array.isArray(row.children) && row.children.length > 0,
                expandRowByClick: true,
                expandIcon: ({ expanded, onExpand, record }) => {
                  if (record._rowType !== "series" || !record.children?.length) {
                    return <span style={{ display: "inline-block", width: 14 }} />;
                  }
                  return (
                    <Button
                      type="text"
                      size="small"
                      icon={expanded ? <DownOutlined /> : <RightOutlined />}
                      onClick={(event) => onExpand(record, event)}
                    />
                  );
                },
              }}
              rowClassName={(row) => (row._rowType === "series" ? "magic-academy-reading-series-row" : "")}
              pagination={{
                current: readingContentPage,
                pageSize: readingContentPageSize,
                total: readingContentsTotal,
                showSizeChanger: true,
                pageSizeOptions: ["10", "20", "30", "50", "100"],
                onChange: (page, pageSize) => {
                  setReadingContentPage(page);
                  if (pageSize !== readingContentPageSize) {
                    setReadingContentPageSize(pageSize);
                  }
                },
                onShowSizeChange: (_, pageSize) => {
                  setReadingContentPage(1);
                  setReadingContentPageSize(pageSize);
                },
                showTotal: (total) => `共 ${total} 条`,
              }}
              columns={[
                {
                  title: "日期",
                  dataIndex: "reading_date",
                  width: 120,
                  render: (value, row) => (
                    row._rowType === "series"
                      ? buildSeriesCell(`共 ${row.children.length} 条`, 1)
                      : value || "—"
                  ),
                },
                {
                  title: "所属系列",
                  width: 140,
                  render: (_, row) => (
                    row._rowType === "series" ? (
                      buildSeriesCell(
                        <Space size={8}>
                          <Tag color="processing" bordered={false}>系列</Tag>
                          <span style={{ fontWeight: 600 }}>{row.series_title}</span>
                        </Space>,
                        2,
                      )
                    ) : (row.series_title || "未归属系列")
                  ),
                },
                {
                  title: "推送时间",
                  dataIndex: "push_at",
                  width: 170,
                  render: (value, row) => (
                    row._rowType === "series"
                      ? hideSeriesCell()
                      : (value?.replace("T", " ").slice(0, 19) || "—")
                  ),
                },
                {
                  title: "标题",
                  dataIndex: "title",
                  render: (value, row) => (
                    row._rowType === "series" ? (
                      buildSeriesCell(
                        <Space size={8} wrap>
                          <Tag>{row.children.length} 条内容</Tag>
                          <span style={{ color: "#8c8c8c" }}>点击展开/收起查看系列内容</span>
                        </Space>,
                        8,
                      )
                    ) : value
                  ),
                },
                {
                  title: "图片",
                  render: (_, row) => row._rowType === "series"
                    ? hideSeriesCell()
                    : row.id ? (
                    <Image
                      src={buildReadingContentImageUrl(row.id)}
                      alt={row.title}
                      width={44}
                      height={58}
                      style={{ borderRadius: 6, objectFit: "cover", border: "1px solid #f0f0f0" }}
                      preview={{ src: buildReadingContentImageUrl(row.id) }}
                    />
                  ) : "—",
                },
                {
                  title: "推送对象",
                  render: (_, row) => (
                    row._rowType === "series"
                      ? hideSeriesCell()
                      : getReadingTargetSummary(row)
                  ),
                },
                { title: "推送人数", dataIndex: "push_count", width: 100 },
                {
                  title: "已完成",
                  dataIndex: "completed_count",
                  width: 90,
                  render: (value, row) => (row._rowType === "series" ? hideSeriesCell() : value),
                },
                {
                  title: "未完成",
                  dataIndex: "pending_count",
                  width: 90,
                  render: (value, row) => (row._rowType === "series" ? hideSeriesCell() : value),
                },
                {
                  title: "完成率",
                  dataIndex: "completion_rate",
                  width: 100,
                  render: (value, row) => (row._rowType === "series" ? hideSeriesCell() : `${value || 0}%`),
                },
                {
                  title: "补卡截止时间",
                  dataIndex: "makeup_deadline_at",
                  width: 170,
                  render: (value, row) => (
                    row._rowType === "series"
                      ? hideSeriesCell()
                      : (value?.replace("T", " ").slice(0, 19) || "—")
                  ),
                },
                {
                  title: "推送",
                  width: 240,
                  render: (_, row) => {
                    if (row._rowType === "series") return hideSeriesCell();
                    const summary = readingPushSummaryMap?.[row.id] || null;
                    const meta = getPushStatusMeta(summary?.status);
                    const latestTime = summary?.finished_at || summary?.started_at || summary?.created_at || "";
                    const retryDisabled = summary?.status === "running" || summary?.status === "pending";
                    return (
                      <Space direction="vertical" size={4}>
                        <Space wrap size={4}>
                          <Tag color={meta.color}>{meta.label}</Tag>
                          <span style={{ color: "#8c8c8c", fontSize: 12 }}>
                            {summary ? `成功 ${summary.success_count || 0} / 失败 ${summary.failed_count || 0} / 跳过 ${summary.skipped_count || 0}` : "暂无记录"}
                          </span>
                        </Space>
                        <span style={{ color: "#8c8c8c", fontSize: 12 }}>
                          {latestTime ? latestTime.replace("T", " ").slice(0, 19) : "—"}
                        </span>
                        <Space size={4} wrap>
                          <Button size="small" onClick={() => handleOpenReadingPushDetail(row)}>
                            查看明细
                          </Button>
                          <Button
                            size="small"
                            disabled={retryDisabled}
                            loading={retryingReadingContentId === row.id}
                            onClick={() => handleRetryReadingPush(row)}
                          >
                            立即补推
                          </Button>
                        </Space>
                      </Space>
                    );
                  },
                },
                { title: "创建人", dataIndex: "creator_name", render: (value) => value || "—", width: 120 },
                { title: "创建时间", dataIndex: "created_at", render: (value) => value?.replace("T", " ").slice(0, 19) || "—", width: 180 },
                {
                  title: "操作",
                  width: 260,
                  render: (_, row) => (
                    row._rowType === "series" ? (
                      <Button size="small" onClick={() => openReadingSeriesDetail({ id: row.series_id, title: row.series_title })}>
                        查看系列
                      </Button>
                    ) : (
                      <Space>
                        <Tooltip title={row.is_locked ? "该内容已有打卡记录，为保证统计一致性，核心字段不可修改。" : ""}>
                          <Button size="small" onClick={() => openEditReadingContentModal(row)}>编辑</Button>
                        </Tooltip>
                        <Button size="small" onClick={() => handleToggleReadingContentStatus(row)}>
                          {row.status === "active" ? "停用" : "启用"}
                        </Button>
                        <Popconfirm
                          title={row.is_locked ? "该内容已有打卡记录，不允许删除，请使用停用。" : "删除后员工端将不再显示该读书内容，确认继续？"}
                          onConfirm={() => handleDeleteReadingContent(row)}
                        >
                          <Button size="small" danger>删除</Button>
                        </Popconfirm>
                      </Space>
                    )
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      ),
    },
    {
      key: "reading_series",
      label: "读书系列管理",
      children: (
        <Space direction="vertical" style={{ width: "100%" }} size={16}>
          <Card>
            <Space wrap style={{ width: "100%", justifyContent: "space-between" }}>
              <Space wrap>
                <Input.Search
                  style={{ width: 260 }}
                  placeholder="搜索系列名称"
                  value={readingSeriesKeyword}
                  onChange={(e) => {
                    setReadingSeriesKeyword(e.target.value);
                    setReadingSeriesPage(1);
                  }}
                  onSearch={(value) => {
                    setReadingSeriesKeyword(value);
                    setReadingSeriesPage(1);
                  }}
                />
                <Select
                  allowClear
                  style={{ width: 180 }}
                  placeholder="全部状态"
                  value={readingSeriesStatus || undefined}
                  onChange={(value) => {
                    setReadingSeriesStatus(value || "");
                    setReadingSeriesPage(1);
                  }}
                  options={READING_SERIES_STATUS_FILTER_OPTIONS}
                />
              </Space>
              <Button type="primary" icon={<PlusOutlined />} onClick={() => openReadingSeriesModal()}>
                新增系列
              </Button>
            </Space>
          </Card>
          <Card>
            <Table
              rowKey="id"
              dataSource={readingSeriesRows}
              pagination={{
                current: readingSeriesPage,
                pageSize: 10,
                total: readingSeriesTotal,
                onChange: (page) => setReadingSeriesPage(page),
              }}
              columns={[
                { title: "系列名称", dataIndex: "title", render: (value) => value || "—" },
                {
                  title: "计划周期",
                  width: 220,
                  render: (_, row) => row.start_date || row.end_date ? `${row.start_date || "未设置"} 至 ${row.end_date || "未设置"}` : "未设置",
                },
                { title: "派发对象", dataIndex: "target_summary", width: 180, render: (_, row) => row.target_summary || getSeriesTargetSummary(row.targets || []) },
                {
                  title: "状态",
                  dataIndex: "status",
                  width: 100,
                  render: (value) => {
                    const meta = READING_SERIES_STATUS_META[value] || READING_SERIES_STATUS_META.draft;
                    return <Tag bordered={false} color={meta.color}>{meta.label}</Tag>;
                  },
                },
                { title: "内容数量", dataIndex: "content_count", width: 100 },
                { title: "超出周期", dataIndex: "out_of_range_content_count", width: 100, render: (value) => value ? <Tag color="warning">{value}</Tag> : "0" },
                { title: "创建时间", dataIndex: "created_at", width: 180, render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
                {
                  title: "操作",
                  width: 260,
                  render: (_, row) => (
                    <Space wrap>
                      <Button size="small" onClick={() => openReadingSeriesModal(row)} disabled={row.status === "archived"}>编辑</Button>
                      <Button size="small" onClick={() => openReadingSeriesDetail(row)}>查看内容</Button>
                      {row.status !== "archived" ? (
                        <Button size="small" onClick={() => handleToggleReadingSeriesStatus(row)}>
                          {row.status === "active" ? "暂停" : "启用"}
                        </Button>
                      ) : null}
                      {row.status !== "archived" ? (
                        <Popconfirm
                          title="归档后该系列不会出现在新增读书内容的系列选择中，但历史内容和统计不会删除。是否继续？"
                          onConfirm={() => handleArchiveReadingSeries(row)}
                        >
                          <Button size="small" danger>归档</Button>
                        </Popconfirm>
                      ) : null}
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Space>
      ),
    },
  ];
}
