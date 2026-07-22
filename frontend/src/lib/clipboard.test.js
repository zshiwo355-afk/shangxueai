import test from "node:test";
import assert from "node:assert/strict";

import { copyText } from "./clipboard.js";


test("copies even when Clipboard API reports success without changing the system clipboard", async () => {
  const clipboard = { value: "old content" };
  let copyHandler = null;
  const documentRef = {
    body: {
      appendChild() {},
      removeChild() {},
    },
    createElement() {
      return {
        value: "",
        style: {},
        setAttribute() {},
        focus() {},
        select() {},
        setSelectionRange() {},
      };
    },
    addEventListener(type, handler) {
      if (type === "copy") copyHandler = handler;
    },
    removeEventListener(type, handler) {
      if (type === "copy" && copyHandler === handler) copyHandler = null;
    },
    execCommand(command) {
      if (command !== "copy") return false;
      copyHandler?.({
        clipboardData: { setData: (_, value) => { clipboard.value = value; } },
        preventDefault() {},
      });
      return true;
    },
  };
  const navigatorRef = {
    clipboard: {
      async writeText() {
        // Reproduces the reported false-success behavior: resolves, but does not copy.
      },
    },
  };

  await copyText("https://example.test/report", { navigatorRef, documentRef });

  assert.equal(clipboard.value, "https://example.test/report");
});
