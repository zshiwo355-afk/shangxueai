import { Button, Empty } from "antd";

export default function MagicAcademyEmptyState({
  description,
  actionText,
  onAction,
}) {
  return (
    <Empty
      image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={description}
    >
      {actionText && onAction ? (
        <Button onClick={onAction}>{actionText}</Button>
      ) : null}
    </Empty>
  );
}
