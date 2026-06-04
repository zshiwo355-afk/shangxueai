import {
  CrownOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import {
  App as AntdApp,
  Avatar,
  Button,
  Image,
  Popconfirm,
  Space,
  Switch,
  Table,
  Tag,
} from "antd";
import { useEffect, useState } from "react";

import { adminDeleteMentor, adminListMentors, adminUpdateMentor } from "../../../lib/api.mentors";
import MentorEditDrawer from "./MentorEditDrawer";

export default function MentorsTab() {
  const { message } = AntdApp.useApp();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // null | { mode: "create" } | { mode: "edit", id }

  const reload = async () => {
    setLoading(true);
    try {
      const data = await adminListMentors();
      setItems(Array.isArray(data) ? data : []);
    } catch (err) {
      message.error(err?.message || "加载失败。");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { reload(); }, []);

  const remove = async (row) => {
    try {
      await adminDeleteMentor(row.id);
      message.success("已删除。");
      reload();
    } catch (err) {
      message.error(err?.message || "删除失败。");
    }
  };

  const toggle = async (row, key, value) => {
    try {
      await adminUpdateMentor(row.id, { [key]: value });
      setItems((list) => list.map((i) => (i.id === row.id ? { ...i, [key]: value } : i)));
    } catch (err) {
      message.error(err?.message || "更新失败。");
    }
  };

  const columns = [
    { title: "ID", dataIndex: "id", width: 70 },
    {
      title: "头像",
      dataIndex: "avatar_url",
      width: 80,
      render: (v, row) => v ? (
        <Image
          src={v}
          width={48}
          height={48}
          style={{ objectFit: "cover", borderRadius: "50%", cursor: "zoom-in" }}
          preview={{ src: v, mask: "查看" }}
        />
      ) : (
        <Avatar size={48} style={{ background: "#1677ff" }}>
          {(row.display_name || "导").slice(0, 1).toUpperCase()}
        </Avatar>
      ),
    },
    {
      title: "导师",
      key: "mentor",
      render: (_, row) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {row.display_name}
            {row.featured ? <CrownOutlined style={{ color: "#faad14", marginLeft: 6 }} /> : null}
          </div>
          <div style={{ color: "var(--text-mute)", fontSize: 12 }}>
            {row.title || "未填写头衔"} · #{row.user_id} {row.user_label}
          </div>
        </div>
      ),
    },
    {
      title: "标签",
      dataIndex: "expertise_tags",
      width: 220,
      render: (v) => v ? (
        <Space wrap size={[4, 4]}>
          {String(v).split(/[,，]/).map((t) => t.trim()).filter(Boolean).map((tag) => (
            <Tag key={tag} color="blue">{tag}</Tag>
          ))}
        </Space>
      ) : "—",
    },
    { title: "排序", dataIndex: "sort_order", width: 80 },
    {
      title: "推荐位",
      dataIndex: "featured",
      width: 100,
      render: (v, row) => <Switch checked={!!v} onChange={(c) => toggle(row, "featured", c)} />,
    },
    {
      title: "启用",
      dataIndex: "enabled",
      width: 80,
      render: (v, row) => <Switch checked={!!v} onChange={(c) => toggle(row, "enabled", c)} />,
    },
    {
      title: "操作",
      key: "action",
      width: 200,
      render: (_, row) => (
        <Space>
          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ mode: "edit", id: row.id })}>
            编辑
          </Button>
          <Popconfirm title="确认删除该导师档案？" onConfirm={() => remove(row)} okText="删除" cancelText="取消">
            <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: "var(--text-mute)" }}>共 {items.length} 位导师</span>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: "create" })}>
          新增导师
        </Button>
      </div>

      <Table rowKey="id" loading={loading} dataSource={items} columns={columns} pagination={{ pageSize: 20 }} />

      {editing ? (
        <MentorEditDrawer
          key={editing.mode === "edit" ? `edit-${editing.id}` : "create"}
          mode={editing.mode}
          mentorId={editing.id}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); reload(); }}
        />
      ) : null}
    </>
  );
}
