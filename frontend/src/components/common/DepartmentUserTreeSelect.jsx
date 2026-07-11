import { TreeSelect } from "antd";
import { useMemo } from "react";

const DEPT_PREFIX = "dept:";
const USER_PREFIX = "user:";
const UNASSIGNED_DEPARTMENT = "未分配部门";

export function normalizeDepartmentPath(value) {
  const parts = String(value || "")
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  return parts.join("/");
}

function getDepartmentParts(value) {
  const normalized = normalizeDepartmentPath(value);
  return normalized ? normalized.split("/") : [UNASSIGNED_DEPARTMENT];
}

function getUserDisplayName(user) {
  return user?.real_name || user?.display_name || user?.username || `用户${user?.id || ""}`;
}

function createDepartmentNode(title, path) {
  return {
    title,
    value: `${DEPT_PREFIX}${path}`,
    key: `${DEPT_PREFIX}${path}`,
    children: [],
    userCount: 0,
    sortType: "department",
  };
}

function buildDepartmentTree(users = []) {
  const root = new Map();
  const departmentUserIds = new Map();
  const departmentTargetPaths = new Map();

  const addDepartmentUser = (path, userId) => {
    const current = departmentUserIds.get(path) || [];
    current.push(Number(userId));
    departmentUserIds.set(path, current);
  };

  const addDepartmentTargetPath = (path, targetPath) => {
    if (!targetPath) return;
    const current = departmentTargetPaths.get(path) || [];
    current.push(targetPath);
    departmentTargetPaths.set(path, current);
  };

  users.forEach((user) => {
    if (!user?.id) return;
    const targetDepartmentPath = normalizeDepartmentPath(user.department);
    const parts = getDepartmentParts(user.department);
    let childrenMap = root;
    let currentPath = "";
    const visitedPaths = [];

    parts.forEach((part) => {
      currentPath = currentPath ? `${currentPath}/${part}` : part;
      let node = childrenMap.get(part);
      if (!node) {
        node = createDepartmentNode(part, currentPath);
        node.childMap = new Map();
        childrenMap.set(part, node);
      }
      node.userCount += 1;
      visitedPaths.push(currentPath);
      childrenMap = node.childMap;
    });

    visitedPaths.forEach((path) => addDepartmentUser(path, user.id));
    visitedPaths.forEach((path) => addDepartmentTargetPath(path, targetDepartmentPath));

    const userNode = {
      title: `${getUserDisplayName(user)} (${user.username || user.id})`,
      value: `${USER_PREFIX}${user.id}`,
      key: `${USER_PREFIX}${user.id}`,
      isLeaf: true,
      sortType: "user",
    };
    const parentNode = parts.reduce((nodeMap, part) => nodeMap.get(part).childMap, root);
    parentNode.set(`${USER_PREFIX}${user.id}`, userNode);
  });

  const toTreeData = (nodeMap) => Array.from(nodeMap.values())
    .sort((a, b) => {
      if (a.sortType !== b.sortType) return a.sortType === "department" ? -1 : 1;
      return String(a.title).localeCompare(String(b.title), "zh-Hans-CN");
    })
    .map((node) => {
      if (node.sortType === "user") return node;
      return {
        title: `${node.title}（${node.userCount}人）`,
        value: node.value,
        key: node.key,
        children: toTreeData(node.childMap),
      };
    });

  return { treeData: toTreeData(root), departmentUserIds, departmentTargetPaths };
}

function toArray(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null || value === "") return [];
  return [value];
}

export function resolveDepartmentSelectionUserIds(value, users = []) {
  const { departmentUserIds } = buildDepartmentTree(users);
  const directUserIds = new Set(users.map((user) => Number(user.id)));
  const selected = new Set();

  toArray(value).forEach((item) => {
    const raw = String(item || "").trim();
    if (!raw) return;
    if (raw.startsWith(USER_PREFIX)) {
      const id = Number(raw.slice(USER_PREFIX.length));
      if (directUserIds.has(id)) selected.add(id);
      return;
    }
    if (raw.startsWith(DEPT_PREFIX)) {
      const path = normalizeDepartmentPath(raw.slice(DEPT_PREFIX.length));
      (departmentUserIds.get(path) || []).forEach((id) => selected.add(Number(id)));
      return;
    }
    const numericId = Number(raw);
    if (Number.isFinite(numericId) && directUserIds.has(numericId)) {
      selected.add(numericId);
      return;
    }
    const path = normalizeDepartmentPath(raw);
    (departmentUserIds.get(path) || []).forEach((id) => selected.add(Number(id)));
  });

  return users
    .map((user) => Number(user.id))
    .filter((id) => selected.has(id));
}

export function resolveDepartmentSelectionTargets(value, users = []) {
  const { departmentUserIds, departmentTargetPaths } = buildDepartmentTree(users);
  const directUserIds = new Set(users.map((user) => Number(user.id)));
  const selectedDepartmentTargets = new Set();
  const selectedUserIds = new Set();
  const usersCoveredByDepartments = new Set();

  const addDepartmentTargets = (pathValue) => {
    const path = normalizeDepartmentPath(pathValue);
    const targetPaths = departmentTargetPaths.get(path) || [];
    if (!targetPaths.length) {
      (departmentUserIds.get(path) || []).forEach((id) => selectedUserIds.add(Number(id)));
      return;
    }
    targetPaths.forEach((targetPath) => selectedDepartmentTargets.add(targetPath));
    (departmentUserIds.get(path) || []).forEach((id) => usersCoveredByDepartments.add(Number(id)));
  };

  toArray(value).forEach((item) => {
    const raw = String(item || "").trim();
    if (!raw) return;
    if (raw.startsWith(USER_PREFIX)) {
      const id = Number(raw.slice(USER_PREFIX.length));
      if (directUserIds.has(id)) selectedUserIds.add(id);
      return;
    }
    if (raw.startsWith(DEPT_PREFIX)) {
      addDepartmentTargets(raw.slice(DEPT_PREFIX.length));
      return;
    }
    const numericId = Number(raw);
    if (Number.isFinite(numericId) && directUserIds.has(numericId)) {
      selectedUserIds.add(numericId);
      return;
    }
    addDepartmentTargets(raw);
  });

  const departmentTargets = Array.from(selectedDepartmentTargets)
    .sort((left, right) => String(left).localeCompare(String(right), "zh-Hans-CN"))
    .map((targetId) => ({ target_type: "department", target_id: targetId }));
  const userTargets = users
    .map((user) => Number(user.id))
    .filter((id) => selectedUserIds.has(id) && !usersCoveredByDepartments.has(id))
    .map((id) => ({ target_type: "user", target_id: id }));
  return [...departmentTargets, ...userTargets];
}

export function resolveDepartmentSelectionTargetValues(value, users = []) {
  return resolveDepartmentSelectionTargets(value, users).map((target) => (
    target.target_type === "user" ? Number(target.target_id) : target.target_id
  ));
}

function toTreeValue(value, users = []) {
  const userIds = new Set(users.map((user) => Number(user.id)));
  return toArray(value)
    .map((item) => {
      const raw = String(item || "").trim();
      if (!raw) return "";
      if (raw.startsWith(USER_PREFIX) || raw.startsWith(DEPT_PREFIX)) return raw;
      const numericId = Number(raw);
      if (Number.isFinite(numericId) && userIds.has(numericId)) return `${USER_PREFIX}${numericId}`;
      const path = normalizeDepartmentPath(raw);
      return path ? `${DEPT_PREFIX}${path}` : "";
    })
    .filter(Boolean);
}

export default function DepartmentUserTreeSelect({
  users = [],
  value,
  onChange,
  placeholder = "选择部门或员工",
  disabled = false,
  preserveTargetSelection = false,
}) {
  const { treeData } = useMemo(() => buildDepartmentTree(users), [users]);
  const treeValue = useMemo(() => toTreeValue(value, users), [value, users]);

  return (
    <TreeSelect
      allowClear
      treeCheckable
      showSearch
      treeNodeFilterProp="title"
      value={treeValue}
      treeData={treeData}
      disabled={disabled || !treeData.length}
      placeholder={treeData.length ? placeholder : "暂无可选部门或员工"}
      maxTagCount="responsive"
      showCheckedStrategy={preserveTargetSelection ? TreeSelect.SHOW_ALL : TreeSelect.SHOW_CHILD}
      style={{ width: "100%" }}
      onChange={(nextValue) => {
        onChange?.(
          preserveTargetSelection
            ? resolveDepartmentSelectionTargetValues(nextValue, users)
            : resolveDepartmentSelectionUserIds(nextValue, users),
        );
      }}
    />
  );
}
