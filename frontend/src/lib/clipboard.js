export async function copyText(
  text,
  { navigatorRef = globalThis.navigator, documentRef = globalThis.document } = {},
) {
  const value = String(text || "").trim();
  if (!value) return false;

  if (documentRef?.body && documentRef?.execCommand && documentRef?.addEventListener) {
    const textarea = documentRef.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    Object.assign(textarea.style, { position: "fixed", left: "-9999px", opacity: "0" });
    let copied = false;
    let copyEventHandled = false;
    let appended = false;
    const handleCopy = (event) => {
      if (!event.clipboardData) return;
      event.clipboardData.setData("text/plain", value);
      event.preventDefault();
      copyEventHandled = true;
    };
    try {
      documentRef.body.appendChild(textarea);
      appended = true;
      documentRef.addEventListener("copy", handleCopy);
      textarea.focus();
      textarea.select();
      textarea.setSelectionRange(0, value.length);
      copied = documentRef.execCommand("copy");
    } catch {
      // Fall through to the Clipboard API.
    } finally {
      documentRef.removeEventListener("copy", handleCopy);
      if (appended) documentRef.body.removeChild(textarea);
    }
    if (copied && copyEventHandled) return true;
  }

  if (!navigatorRef?.clipboard?.writeText) return false;
  await navigatorRef.clipboard.writeText(value);
  return true;
}
