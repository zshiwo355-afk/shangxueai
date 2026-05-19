import { Drawer, Tag } from "antd";

export default function BriefDrawer({ open, onClose, brief, trainingType, difficulty, customerType }) {
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
        <p style={{ color: "var(--text-mute)" }}>暂未生成。</p>
      ) : (
        <>
          <div className="brief-drawer__tags">
            {trainingType ? <Tag>{trainingType}</Tag> : null}
            {difficulty ? <Tag color="gold">{difficulty}</Tag> : null}
            {customerType ? <Tag color="blue">{customerType}</Tag> : null}
          </div>

          {brief.training_title ? (
            <>
              <h4>训练主题</h4>
              <p>{brief.training_title}</p>
            </>
          ) : null}

          {brief.trainee_notice ? (
            <>
              <h4>训练须知</h4>
              <p>{brief.trainee_notice}</p>
            </>
          ) : null}

          {Array.isArray(brief.exam_scope) && brief.exam_scope.length > 0 ? (
            <>
              <h4>考察范围</h4>
              <ul>
                {brief.exam_scope.map((item, idx) => <li key={idx}>{item}</li>)}
              </ul>
            </>
          ) : null}

          <h4>最少训练轮次</h4>
          <p>{brief.min_rounds || 10} 轮</p>
        </>
      )}
    </Drawer>
  );
}
