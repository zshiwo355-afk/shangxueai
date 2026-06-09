import {
  Alert,
  Button,
  Card,
  Checkbox,
  Image,
  Modal,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import { buildReadingCheckinImageUrl } from "../../lib/api.magic";
import ReadingSeriesModal from "./admin/reading/ReadingSeriesModal";
import QuestionFormModal from "./QuestionFormModal";
import ReadingContentFormModal from "./ReadingContentFormModal";
import {
  QuizAnswerModal,
  QuizPointFormModal,
  SeriesFormModal,
  WatchConfirmModal,
} from "./MagicAcademyMiscModals";
import {
  AUDIO_EXPORT_DEFAULT_COLUMNS,
  AUDIO_EXPORT_EMPLOYEE_COLUMNS,
  AUDIO_EXPORT_FIELD_GROUPS,
  AUDIO_EXPORT_STAT_COLUMNS,
} from "./magicAcademyPageConfig";
import { getSeriesTargetSummary } from "./magicAcademyPageHelpers";
import { getReadingTargetSummary } from "./magicAcademyShared";

const { Text } = Typography;

export default function MagicAcademyPageModals({
  videoDetail,
  videoModal,
  users = [],
  videoSubmitting,
  videoUploadProgress,
  setVideoModal,
  submitVideo,
  VideoDispatchFormModal,
  readingContentModalOpen,
  readingContentModalMode,
  readingContentSubmitting,
  readingContentEditing,
  readingContentPreferredSeriesId,
  activeReadingSeriesOptions = [],
  employeeUsers = [],
  employeeDepartmentOptions = [],
  employeePositionOptions = [],
  employmentStatusOptions = [],
  openReadingSeriesModal,
  setReadingContentModalOpen,
  setReadingContentEditing,
  handleSubmitReadingContent,
  readingSeriesSupport,
  readingSeriesForm,
  readingSeriesDetailOpen,
  readingSeriesDetail,
  readingSeriesDetailLoading,
  setReadingSeriesDetailOpen,
  readingImportPreviewOpen,
  readingImportSubmitting,
  setReadingImportPreviewOpen,
  handleConfirmReadingImport,
  readingImportRows = [],
  readingImportSummary = { total: 0, valid: 0, invalid: 0 },
  audioDetailOpen,
  audioDetailRow,
  setAudioDetailOpen,
  audioDetailLegacyHint,
  audioDetailLoading,
  audioDetailRows = [],
  audioExportModalOpen,
  audioExportSubmitting,
  setAudioExportModalOpen,
  handleConfirmAudioExport,
  audioExportColumns = [],
  setAudioExportColumns,
  audioExportScopeLines = [],
  handleToggleAudioExportColumn,
  watchConfirmState,
  handleWatchConfirmContinue,
  seriesModal,
  seriesForm,
  setSeriesModal,
  submitSeries,
  pointModal,
  pointForm,
  setPointModal,
  submitPoint,
  questionModal,
  setQuestionModal,
  submitQuestion,
  quizAnswerState = { open: false, point: null, values: {} },
  setQuizAnswerState,
  handleQuizSubmit,
}) {
  return (
    <>
      <VideoDispatchFormModal
        open={!!videoModal}
        editing={videoModal && videoModal.id ? videoModal : null}
        users={users}
        submitting={videoSubmitting}
        uploadProgress={videoUploadProgress}
        onCancel={() => setVideoModal(null)}
        onSubmit={submitVideo}
      />

      <ReadingContentFormModal
        open={readingContentModalOpen}
        mode={readingContentModalMode}
        submitting={readingContentSubmitting}
        editing={readingContentEditing}
        preferredSeriesId={readingContentPreferredSeriesId}
        readingSeriesOptions={activeReadingSeriesOptions}
        onCreateSeries={() => openReadingSeriesModal()}
        employeeUsers={employeeUsers}
        employeeDepartmentOptions={employeeDepartmentOptions}
        employeePositionOptions={employeePositionOptions}
        employmentStatusOptions={employmentStatusOptions}
        onCancel={() => {
          if (readingContentSubmitting) return;
          setReadingContentModalOpen(false);
          setReadingContentEditing(null);
        }}
        onSubmit={handleSubmitReadingContent}
      />

      <ReadingSeriesModal
        form={readingSeriesForm}
        support={readingSeriesSupport}
        departmentOptions={employeeDepartmentOptions}
        positionOptions={employeePositionOptions}
        employeeUsers={employeeUsers}
        employmentStatusOptions={employmentStatusOptions}
      />

      <Modal
        open={readingSeriesDetailOpen}
        title={readingSeriesDetail ? `${readingSeriesDetail.title} · 读书内容` : "读书系列内容"}
        width={1080}
        footer={null}
        onCancel={() => setReadingSeriesDetailOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%", marginBottom: 12 }}>
          <Alert
            type="info"
            showIcon
            message={`系列周期：${readingSeriesDetail?.start_date || "未设置"} 至 ${readingSeriesDetail?.end_date || "未设置"}`}
            description={`默认派发对象：${readingSeriesDetail?.target_summary || getSeriesTargetSummary(readingSeriesDetail?.targets || [])}`}
          />
        </Space>
        <Table
          rowKey="id"
          loading={readingSeriesDetailLoading}
          dataSource={readingSeriesDetail?.contents || []}
          pagination={{ pageSize: 8 }}
          scroll={{ x: 1000 }}
          columns={[
            { title: "日期", dataIndex: "reading_date", width: 110 },
            { title: "周期状态", dataIndex: "out_of_range", width: 120, render: (value) => value ? <Tag color="warning">超出系列周期</Tag> : <Tag color="success">周期内</Tag> },
            { title: "推送时间", dataIndex: "push_at", width: 170, render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
            { title: "标题", dataIndex: "title", width: 180 },
            { title: "推送对象", render: (_, row) => getReadingTargetSummary(row), width: 180 },
            { title: "推送人数", dataIndex: "push_count", width: 90 },
            { title: "已完成", dataIndex: "completed_count", width: 90 },
            { title: "未完成", dataIndex: "pending_count", width: 90 },
            { title: "完成率", dataIndex: "completion_rate", width: 90, render: (value) => `${value || 0}%` },
            { title: "补卡截止时间", dataIndex: "makeup_deadline_at", width: 170, render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
          ]}
        />
      </Modal>

      <Modal
        open={readingImportPreviewOpen}
        title="Excel 导入预览"
        width={1100}
        onCancel={() => {
          if (readingImportSubmitting) return;
          setReadingImportPreviewOpen(false);
        }}
        onOk={handleConfirmReadingImport}
        okButtonProps={{ disabled: !readingImportRows.some((item) => item.can_import) }}
        confirmLoading={readingImportSubmitting}
        okText="确认导入"
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message={`共 ${readingImportSummary.total} 行，可导入 ${readingImportSummary.valid} 行，错误 ${readingImportSummary.invalid} 行`}
          />
          <Table
            rowKey="row_number"
            size="small"
            pagination={{ pageSize: 8 }}
            dataSource={readingImportRows}
            rowClassName={(row) => (row.errors?.length ? "magic-table-row-error" : "")}
            columns={[
              { title: "行号", dataIndex: "row_number", width: 80 },
              { title: "日期", render: (_, row) => row.parsed?.reading_date || "—" },
              { title: "推送时间", render: (_, row) => row.parsed?.push_time || "—" },
              { title: "标题", render: (_, row) => row.parsed?.title || "—" },
              { title: "所属系列", render: (_, row) => row.parsed?.series_title || "未归属系列" },
              {
                title: "图片来源",
                render: (_, row) => {
                  const rawImageValue = String(row.raw?.["推送图片"] || "").trim();
                  const imageSource = row.parsed?.image_source;
                  if (rawImageValue.toUpperCase().startsWith("=DISPIMG(")) return "公式图片";
                  if (imageSource === "material") return "素材库图片";
                  if (imageSource === "upload") return "Excel 内嵌图片";
                  if (row.parsed?.image_url) return "图片链接";
                  return "空图";
                },
              },
              { title: "目标类型", render: (_, row) => row.parsed?.target_type || "—" },
              {
                title: "目标人群",
                render: (_, row) => {
                  const labels = row.parsed?.target_labels || [];
                  if (row.parsed?.target_type === "all") return "全部员工";
                  if (row.parsed?.target_type === "all_newcomers") return "仅新人";
                  return labels.join("、") || "—";
                },
              },
              { title: "补卡截止", render: (_, row) => row.parsed?.makeup_deadline_at || "—" },
              { title: "错误/警告", render: (_, row) => [...(row.errors || []), ...(row.warnings || [])].join("；") || "—" },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        open={audioDetailOpen}
        title={audioDetailRow ? `${audioDetailRow.reading_date} ${audioDetailRow.title}` : "完成明细"}
        width={980}
        footer={null}
        onCancel={() => setAudioDetailOpen(false)}
      >
        <Space direction="vertical" size={12} style={{ width: "100%" }}>
          {audioDetailLegacyHint ? <Alert type="info" showIcon message={audioDetailLegacyHint} /> : null}
          <Table
            rowKey="user_id"
            loading={audioDetailLoading}
            dataSource={audioDetailRows}
            pagination={{ pageSize: 10 }}
            columns={[
              { title: "员工姓名", dataIndex: "user_name" },
              { title: "部门", dataIndex: "department_name", render: (value) => value || "—" },
              { title: "岗位", dataIndex: "position", render: (value) => value || "—" },
              { title: "应完成", dataIndex: "should_complete", render: (value) => value ? "是" : "否" },
              { title: "已完成", dataIndex: "completed", render: (value) => value ? <Tag bordered={false} color="success">是</Tag> : "否" },
              { title: "上传时间", dataIndex: "uploaded_at", render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
              {
                title: "打卡图片",
                dataIndex: "has_image",
                render: (value, row) => (value && row.upload_id
                  ? (
                    <Image
                      src={buildReadingCheckinImageUrl(row.upload_id)}
                      width={44}
                      height={44}
                      style={{ borderRadius: 6, objectFit: "cover", border: "1px solid #f0f0f0" }}
                      preview={{ src: buildReadingCheckinImageUrl(row.upload_id) }}
                    />
                  )
                  : "—"),
              },
              { title: "是否补卡", dataIndex: "is_makeup", render: (value) => value ? "是" : "否" },
              { title: "补卡时间", dataIndex: "makeup_at", render: (value) => value?.replace("T", " ").slice(0, 19) || "—" },
              { title: "备注", dataIndex: "remark", render: (value) => value || "—" },
              { title: "当前状态", dataIndex: "status_text" },
            ]}
          />
        </Space>
      </Modal>

      <Modal
        open={audioExportModalOpen}
        title="导出读书打卡统计"
        width={880}
        destroyOnHidden
        onCancel={() => {
          if (audioExportSubmitting) return;
          setAudioExportModalOpen(false);
        }}
        onOk={handleConfirmAudioExport}
        okText="确认导出"
        cancelText="取消"
        confirmLoading={audioExportSubmitting}
        okButtonProps={{ disabled: audioExportColumns.length === 0 }}
      >
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
          <Alert
            type="info"
            showIcon
            message="当前导出范围"
            description={(
              <Space direction="vertical" size={4} style={{ width: "100%" }}>
                {audioExportScopeLines.map((line) => (
                  <Text key={line}>{line}</Text>
                ))}
              </Space>
            )}
          />
          <Card
            size="small"
            title="字段选择"
            extra={(
              <Space wrap>
                <Button size="small" onClick={() => setAudioExportColumns(AUDIO_EXPORT_FIELD_GROUPS.flatMap((group) => group.fields.map((item) => item.key)))}>
                  全选
                </Button>
                <Button size="small" onClick={() => setAudioExportColumns([])}>
                  清空
                </Button>
                <Button size="small" onClick={() => setAudioExportColumns(AUDIO_EXPORT_DEFAULT_COLUMNS)}>
                  恢复默认
                </Button>
                <Button size="small" onClick={() => setAudioExportColumns(AUDIO_EXPORT_EMPLOYEE_COLUMNS)}>
                  仅员工明细字段
                </Button>
                <Button size="small" onClick={() => setAudioExportColumns(AUDIO_EXPORT_STAT_COLUMNS)}>
                  仅完成统计字段
                </Button>
              </Space>
            )}
          >
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
              {AUDIO_EXPORT_FIELD_GROUPS.map((group) => (
                <div key={group.key}>
                  <Text strong>{group.title}</Text>
                  <div style={{ marginTop: 8 }}>
                    <Space wrap size={[16, 12]}>
                      {group.fields.map((field) => (
                        <Checkbox
                          key={field.key}
                          checked={audioExportColumns.includes(field.key)}
                          onChange={(event) => handleToggleAudioExportColumn(field.key, event.target.checked)}
                        >
                          {field.label}
                        </Checkbox>
                      ))}
                    </Space>
                  </div>
                </div>
              ))}
              {audioExportColumns.length === 0 ? <Text type="danger">请至少选择一个导出字段</Text> : null}
            </Space>
          </Card>
        </Space>
      </Modal>

      <WatchConfirmModal
        open={watchConfirmState.open}
        message={videoDetail?.watch_confirm_setting?.message}
        buttonText={videoDetail?.watch_confirm_setting?.button_text}
        onContinue={handleWatchConfirmContinue}
      />

      <SeriesFormModal
        editing={seriesModal}
        form={seriesForm}
        onCancel={() => setSeriesModal(null)}
        onOk={submitSeries}
      />

      <QuizPointFormModal
        editing={pointModal}
        form={pointForm}
        onCancel={() => setPointModal(null)}
        onOk={submitPoint}
      />

      <QuestionFormModal
        open={!!questionModal}
        editing={questionModal?.id ? questionModal : null}
        pointId={questionModal?.pointId}
        onCancel={() => setQuestionModal(null)}
        onSubmit={submitQuestion}
      />

      <QuizAnswerModal
        state={quizAnswerState}
        setState={setQuizAnswerState}
        onSubmit={handleQuizSubmit}
      />
    </>
  );
}
