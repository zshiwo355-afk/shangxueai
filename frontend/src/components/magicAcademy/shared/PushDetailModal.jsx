import { Modal, Table, Tag, Tooltip } from "antd";

function renderPushDetailTextCell(value, fallback = "—") {
  const text = String(value || "").trim();
  if (!text) return fallback;
  return (
    <Tooltip title={text} placement="topLeft">
      <span>{text}</span>
    </Tooltip>
  );
}

export default function PushDetailModal({
  open,
  title,
  loading,
  rows,
  onCancel,
}) {
  return (
    <Modal
      open={open}
      title={title || "推送明细"}
      footer={null}
      width="min(1360px, calc(100vw - 48px))"
      style={{ top: 24 }}
      onCancel={onCancel}
    >
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        dataSource={rows}
        pagination={{ pageSize: 10 }}
        tableLayout="fixed"
        scroll={{ x: 1280, y: "calc(100vh - 220px)" }}
        columns={[
          {
            title: "用户姓名",
            dataIndex: "recipient_name",
            width: 140,
            ellipsis: true,
            render: (value) => renderPushDetailTextCell(value),
          },
          {
            title: "部门",
            dataIndex: "department",
            width: 220,
            ellipsis: true,
            render: (value) => renderPushDetailTextCell(value),
          },
          {
            title: "企微账号",
            dataIndex: "recipient_wecom_userid",
            width: 220,
            ellipsis: true,
            render: (value) => renderPushDetailTextCell(value, "未绑定"),
          },
          {
            title: "状态",
            dataIndex: "status",
            width: 110,
            render: (value) => {
              if (value === "sent") return <Tag color="success">已发送</Tag>;
              if (value === "failed") return <Tag color="error">发送失败</Tag>;
              if (value === "skipped") return <Tag color="default">未发送</Tag>;
              return <Tag color="processing">待发送</Tag>;
            },
          },
          {
            title: "跳过原因",
            dataIndex: "skip_reason",
            width: 140,
            ellipsis: true,
            render: (value) => {
              if (value === "missing_wecom_userid") return "缺少企微绑定";
              if (value === "already_sent_in_previous_batch") return "历史已成功推送";
              return renderPushDetailTextCell(value);
            },
          },
          {
            title: "失败原因",
            dataIndex: "error",
            width: 360,
            ellipsis: true,
            render: (value) => renderPushDetailTextCell(value),
          },
          {
            title: "推送时间",
            dataIndex: "sent_at",
            width: 180,
            render: (value) => value?.replace("T", " ").slice(0, 19) || "—",
          },
        ]}
      />
    </Modal>
  );
}
