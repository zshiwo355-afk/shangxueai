import { TreeSelect } from "antd";
import { useMemo } from "react";

const COMPANY_ROOT = "怀仁产业发展集团";
const GROUP_VALUE_PREFIX = "__group__/";

/**
 * 把扁平的真实部门路径数组构建成 antd TreeSelect 的树。
 *
 * 关键约束：后端按 `User.department == 路径` 精确匹配，所以每个可选节点的
 * value 必须是数据库里真实存在的原始路径，绝不能因为补前缀而改写。
 *
 * 归整策略（仅影响“显示结构”，不影响 value）：
 *  - 有的部门漏录了 "怀仁产业发展集团" 前缀，导致各自成为根节点；
 *  - 这里把缺前缀的路径在显示上挂到统一根 COMPANY_ROOT 下，收拢根节点；
 *  - 每个节点是否可选，取决于它对应的真实路径是否真实存在于 departments，
 *    纯层级分组节点不可选（选了后端也查不到）。
 */
function buildDepartmentTree(departments = []) {
  const realSet = new Set(
    departments.map((d) => String(d || "").trim()).filter(Boolean),
  );

  const root = new Map();

  realSet.forEach((realPath) => {
    const displayPath = realPath.startsWith(COMPANY_ROOT)
      ? realPath
      : `${COMPANY_ROOT}/${realPath}`;
    const segments = displayPath.split("/").map((s) => s.trim()).filter(Boolean);

    let childrenMap = root;
    let acc = "";
    segments.forEach((seg) => {
      acc = acc ? `${acc}/${seg}` : seg;
      let node = childrenMap.get(acc);
      if (!node) {
        node = { displayPath: acc, title: seg, childMap: new Map() };
        childrenMap.set(acc, node);
      }
      childrenMap = node.childMap;
    });
  });

  // 给定显示路径，推断它对应的真实部门 value：
  //  1) 显示路径本身就是真实部门 → 用它；
  //  2) 去掉虚拟根前缀后是真实部门 → 用去前缀的；
  //  3) 都不是 → 纯分组节点，不可选。
  const resolveRealValue = (displayPath) => {
    if (realSet.has(displayPath)) return displayPath;
    if (displayPath.startsWith(`${COMPANY_ROOT}/`)) {
      const stripped = displayPath.slice(COMPANY_ROOT.length + 1);
      if (stripped && realSet.has(stripped)) return stripped;
    }
    return null;
  };

  const toTreeData = (nodeMap) => Array.from(nodeMap.values())
    .sort((a, b) => String(a.title).localeCompare(String(b.title), "zh-Hans-CN"))
    .map((node) => {
      const realValue = resolveRealValue(node.displayPath);
      return {
        title: node.title,
        value: realValue ?? `${GROUP_VALUE_PREFIX}${node.displayPath}`,
        key: node.displayPath,
        selectable: realValue !== null,
        children: node.childMap.size ? toTreeData(node.childMap) : undefined,
      };
    });

  const treeData = toTreeData(root);
  const rootKeys = treeData.map((node) => node.key);
  return { treeData, rootKeys };
}

/**
 * 部门树单选。值与 onChange 均为「部门真实路径字符串」，空串/undefined 表示未选。
 * 用于替换数据看板、积分榜、用户管理里散乱的扁平部门下拉。
 */
export default function DepartmentTreeSelect({
  departments = [],
  value,
  onChange,
  placeholder = "选择部门",
  style,
  size,
  allowClear = true,
  popupMatchSelectWidth = false,
}) {
  const { treeData, rootKeys } = useMemo(
    () => buildDepartmentTree(departments),
    [departments],
  );

  return (
    <TreeSelect
      showSearch
      treeNodeFilterProp="title"
      treeDefaultExpandedKeys={rootKeys}
      treeLine={{ showLeafIcon: false }}
      value={value || undefined}
      treeData={treeData}
      disabled={!treeData.length}
      placeholder={treeData.length ? placeholder : "暂无可选部门"}
      allowClear={allowClear}
      size={size}
      style={style || { width: "100%" }}
      popupMatchSelectWidth={popupMatchSelectWidth}
      onChange={(next) => onChange?.(next || "")}
    />
  );
}
