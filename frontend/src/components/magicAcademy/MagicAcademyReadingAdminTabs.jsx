import { Button, Card, Input, Popconfirm, Select, Space, Table, Tag } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import {
  READING_SERIES_STATUS_FILTER_OPTIONS,
  READING_SERIES_STATUS_META,
} from "./magicAcademyPageConfig";
import AdminReadingContentsPanel from "./admin/reading/AdminReadingContentsPanel";
import { getSeriesTargetSummary } from "./magicAcademyPageHelpers";

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
  readingContentSeriesFilterRows = [],
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
  handleBatchEnableReadingContents,
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
  return [
    {
      key: "reading_contents",
      label: "读书内容推送",
      children: (
        <AdminReadingContentsPanel
          readingContentMonth={readingContentMonth}
          setReadingContentMonth={setReadingContentMonth}
          readingContentKeyword={readingContentKeyword}
          setReadingContentKeyword={setReadingContentKeyword}
          setReadingContentPage={setReadingContentPage}
          readingContentPageSize={readingContentPageSize}
          setReadingContentPageSize={setReadingContentPageSize}
          readingContentSeriesId={readingContentSeriesId}
          setReadingContentSeriesId={setReadingContentSeriesId}
          readingContentSeriesFilterRows={readingContentSeriesFilterRows}
          downloadMagicFile={downloadMagicFile}
          handlePreviewReadingImport={handlePreviewReadingImport}
          openReadingImportMaterialPicker={openReadingImportMaterialPicker}
          readingImportSubmitting={readingImportSubmitting}
          openCreateReadingContentModal={openCreateReadingContentModal}
          readingContents={readingContents}
          readingContentPage={readingContentPage}
          readingContentsTotal={readingContentsTotal}
          selectedReadingContentRowKeys={selectedReadingContentRowKeys}
          setSelectedReadingContentRowKeys={setSelectedReadingContentRowKeys}
          openEditReadingContentModal={openEditReadingContentModal}
          handleToggleReadingContentStatus={handleToggleReadingContentStatus}
          handleDeleteReadingContent={handleDeleteReadingContent}
          handleBatchDeleteReadingContents={handleBatchDeleteReadingContents}
          handleBatchEnableReadingContents={handleBatchEnableReadingContents}
          handleBatchDisableReadingContents={handleBatchDisableReadingContents}
          readingPushSummaryMap={readingPushSummaryMap}
          handleOpenReadingPushDetail={handleOpenReadingPushDetail}
          handleRetryReadingPush={handleRetryReadingPush}
          retryingReadingContentId={retryingReadingContentId}
          openReadingSeriesDetail={openReadingSeriesDetail}
        />
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
