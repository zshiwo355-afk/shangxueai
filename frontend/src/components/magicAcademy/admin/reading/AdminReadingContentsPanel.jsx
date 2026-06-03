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
import { useMemo } from "react";

import { buildReadingContentImageUrl } from "../../../../lib/api.magic";
import { getReadingTargetSummary, saveBlob } from "../../magicAcademyShared";
import PushStatusCell from "../../shared/PushStatusCell";
import { buildGroupedReadingContents } from "./readingContentsTransforms";

export default function AdminReadingContentsPanel({
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
  openReadingSeriesDetail,
}) {
  const groupedReadingContents = useMemo(() => buildGroupedReadingContents(readingContents), [readingContents]);

  const buildSeriesCell = (content, span = 1) => ({
    children: content,
    props: { colSpan: span },
  });

  const hideSeriesCell = () => ({
    children: null,
    props: { colSpan: 0 },
  });

  return (
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
                ...readingContentSeriesFilterRows.map((item) => ({ value: item.id, label: item.title })),
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
                return (
                  <PushStatusCell
                    summary={summary}
                    retryLoading={retryingReadingContentId === row.id}
                    onOpenDetail={() => handleOpenReadingPushDetail(row)}
                    onRetry={() => handleRetryReadingPush(row)}
                  />
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
  );
}
