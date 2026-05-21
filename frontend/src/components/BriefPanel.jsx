import { Drawer, Tag } from "antd";

export default function BriefDrawer({
  open,
  onClose,
  brief,
  trainingType,
  difficulty,
  customerType,
}) {
  return (
    <Drawer
      title="训练说明"
      placement="right"
      open={open}
      onClose={onClose}
      width={380}
      className="brief-drawer"
    >
      {!brief ? (
        <p style={{ color: "var(--text-mute)" }}>暂无说明。</p>
      ) : (
        <>
          <div className="brief-drawer__tags">
            {trainingType ? <Tag>{trainingType}</Tag> : null}
            {difficulty ? <Tag>{difficulty}</Tag> : null}
            {customerType ? <Tag>{customerType}</Tag> : null}
          </div>

          {brief.training_title ? (
            <>
              <h4>主题</h4>
              <p>{brief.training_title}</p>
            </>
          ) : null}

          {brief.trainee_notice ? (
            <>
              <h4>提示</h4>
              <p>{brief.trainee_notice}</p>
            </>
          ) : null}

          {Array.isArray(brief.exam_scope) && brief.exam_scope.length > 0 ? (
            <>
              <h4>关注点</h4>
              <ul>
                {brief.exam_scope.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}

          <h4>结束</h4>
          <p>可随时结束，按当前对话生成复盘和评分。</p>
        </>
      )}
    </Drawer>
  );
}
