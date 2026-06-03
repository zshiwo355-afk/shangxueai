import { Space, Typography } from "antd";

const { Text } = Typography;

export default function CourseListSection({
  title,
  children,
}) {
  return (
    <Space direction="vertical" style={{ width: "100%" }} size={16}>
      <Text strong>{title}</Text>
      {children}
    </Space>
  );
}
