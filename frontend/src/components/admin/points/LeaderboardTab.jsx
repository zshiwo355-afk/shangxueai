import { CrownFilled, TrophyOutlined } from "@ant-design/icons";
import { App as AntdApp, Card, Segmented, Space, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { adminListDepartments, adminPointLeaderboard } from "../../../lib/api.points";
import DepartmentTreeSelect from "../../common/DepartmentTreeSelect";

const CATEGORY_OPTIONS = [
  { label: "综合", value: "all" },
  { label: "AI对练", value: "training" },
  { label: "课程", value: "course" },
  { label: "读书打卡", value: "reading" },
  { label: "考试", value: "paper" },
  { label: "AI通关", value: "exam" },
];

function rankBadge(rank) {
  if (rank === 1) return <CrownFilled style={{ color: "#faad14", fontSize: 18 }} />;
  if (rank === 2) return <CrownFilled style={{ color: "#bfbfbf", fontSize: 18 }} />;
  if (rank === 3) return <CrownFilled style={{ color: "#d4a373", fontSize: 18 }} />;
  return <span style={{ color: "var(--text-mute)" }}>#{rank}</span>;
}

export default function LeaderboardTab() {
  const { message } = AntdApp.useApp();
  const [scope, setScope] = useState("all");
  const [department, setDepartment] = useState("");
  const [departments, setDepartments] = useState([]);
  const [category, setCategory] = useState("all");
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    adminListDepartments()
      .then((data) => setDepartments(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const params = { scope, category, limit: 100 };
    if (scope === "department") {
      if (!department) {
        setItems([]);
        setLoading(false);
        return;
      }
      params.department = department;
    }
    adminPointLeaderboard(params)
      .then((data) => {
        if (cancelled) return;
        setItems(Array.isArray(data) ? data : []);
      })
      .catch((err) => message.error(err?.message || "加载失败。"))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [scope, department, category, message]);

  const pointField = useMemo(() => (
    category === "all" ? "total_points" : `${category}_points`
  ), [category]);

  const columns = [
    {
      title: "排名",
      dataIndex: "rank",
      width: 70,
      align: "center",
      render: (v) => rankBadge(v),
    },
    { title: "姓名", dataIndex: "name" },
    {
      title: "部门",
      dataIndex: "department",
      width: 160,
      render: (v) => v ? <Tag>{v}</Tag> : <span style={{ color: "var(--text-mute)" }}>—</span>,
    },
    {
      title: category === "all" ? "总积分" : "该分类积分",
      dataIndex: pointField,
      width: 120,
      render: (v) => <strong style={{ color: "#1677ff" }}>{v ?? 0}</strong>,
      sorter: (a, b) => (a[pointField] || 0) - (b[pointField] || 0),
    },
    { title: "总分", dataIndex: "total_points", width: 100 },
    {
      title: "连续打卡",
      dataIndex: "streak_days",
      width: 100,
      render: (v) => v > 0 ? <Tag color="purple">{v} 天</Tag> : "—",
    },
  ];

  return (
    <div>
      <Card size="small" style={{ marginBottom: 12 }}>
        <Space wrap size={12}>
          <span style={{ color: "var(--text-mute)" }}><TrophyOutlined /> 范围</span>
          <Segmented
            options={[
              { label: "全公司", value: "all" },
              { label: "按部门", value: "department" },
            ]}
            value={scope}
            onChange={setScope}
          />
          {scope === "department" ? (
            <DepartmentTreeSelect
              departments={departments}
              value={department}
              onChange={setDepartment}
              placeholder="选择部门"
              style={{ width: 240 }}
            />
          ) : null}
          <span style={{ color: "var(--text-mute)" }}>分类</span>
          <Segmented options={CATEGORY_OPTIONS} value={category} onChange={setCategory} />
        </Space>
      </Card>
      <Table
        rowKey="user_id"
        loading={loading}
        dataSource={items}
        columns={columns}
        pagination={{
          defaultPageSize: 20,
          showSizeChanger: true,
          pageSizeOptions: [10, 20, 50, 100],
          showTotal: (total) => `共 ${total} 人`,
        }}
      />
    </div>
  );
}
