export default function ChatMessage({ role, content }) {
  if (role === "trainee") {
    return (
      <div className="chat-row chat-row--trainee">
        <div className="chat-bubble chat-bubble--trainee">{content}</div>
      </div>
    );
  }

  return (
    <div className="chat-row chat-row--customer">
      <div className="chat-avatar">客</div>
      <div className="chat-bubble chat-bubble--customer">{content}</div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="chat-row chat-row--customer">
      <div className="chat-avatar">客</div>
      <div className="chat-bubble chat-bubble--customer chat-bubble--typing">
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
        <span className="typing-dot"></span>
      </div>
    </div>
  );
}
