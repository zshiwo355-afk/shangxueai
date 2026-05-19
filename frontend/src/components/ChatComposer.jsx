import { PaperClipOutlined, SendOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Tooltip } from "antd";
import { useRef, useState } from "react";

const { TextArea } = Input;

const ATTACHMENT_PRESETS = [
  { key: "产品图", label: "产品图" },
  { key: "价格表", label: "价格表" },
  { key: "宣传册", label: "宣传册" },
  { key: "视频", label: "视频" },
  { key: "链接", label: "链接（小程序/商城）" },
  { key: "朋友圈截图", label: "朋友圈截图" },
  { key: "资质证明", label: "资质证明" },
];

export default function ChatComposer({ disabled, sending, onSend }) {
  const [value, setValue] = useState("");
  const taRef = useRef(null);

  const submit = async () => {
    const text = value.trim();
    if (!text || disabled || sending) return;
    setValue("");
    await onSend(text);
  };

  const insertMarker = (kind) => {
    if (disabled || sending) return;
    const marker = `[发送:${kind}]`;
    setValue((prev) => {
      const sep = prev && !prev.endsWith(" ") && !prev.endsWith("\n") ? " " : "";
      return `${prev}${sep}${marker} `;
    });
    // 让 TextArea 重新聚焦
    requestAnimationFrame(() => {
      taRef.current?.focus?.();
    });
  };

  const menuItems = ATTACHMENT_PRESETS.map((item) => ({
    key: item.key,
    label: item.label,
    onClick: () => insertMarker(item.key),
  }));

  return (
    <div className="chat-composer-wrap">
      <div className="chat-composer">
        <Tooltip title="模拟发送资料 / 图片 / 链接">
          <Dropdown
            menu={{ items: menuItems }}
            placement="topLeft"
            trigger={["click"]}
            disabled={disabled || sending}
          >
            <Button
              icon={<PaperClipOutlined />}
              className="chat-composer__attach"
              disabled={disabled || sending}
            />
          </Dropdown>
        </Tooltip>

        <TextArea
          ref={taRef}
          className="chat-composer__textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPressEnter={(e) => {
            if (e.shiftKey) return;
            e.preventDefault();
            submit();
          }}
          placeholder={
            disabled
              ? "本次训练已结束。"
              : "输入回复，回车发送 · 需要给客户发资料？直接说『我这就发您』或用左侧 📎"
          }
          autoSize={{ minRows: 1, maxRows: 6 }}
          disabled={disabled || sending}
          variant="borderless"
        />

        <Button
          type="primary"
          icon={<SendOutlined />}
          className="chat-composer__send"
          loading={sending}
          disabled={disabled || !value.trim()}
          onClick={submit}
        />
      </div>
    </div>
  );
}
