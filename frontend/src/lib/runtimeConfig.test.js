import test from "node:test";
import assert from "node:assert/strict";

import {
  buildApiUrl,
  clearStoredApiBaseUrl,
  getStoredApiBaseUrl,
  saveApiBaseUrl,
} from "./runtimeConfig.js";


test("tolerates embedded browsers that block localStorage", () => {
  globalThis.window = {
    location: {
      origin: "https://hr.shanyinzhijia.com",
      search: "",
    },
    localStorage: {
      getItem() {
        throw new DOMException("blocked", "SecurityError");
      },
      setItem() {
        throw new DOMException("blocked", "SecurityError");
      },
      removeItem() {
        throw new DOMException("blocked", "SecurityError");
      },
    },
  };

  assert.equal(getStoredApiBaseUrl(), "");
  assert.equal(buildApiUrl("/api/auth/me"), "/api/auth/me");
  assert.equal(saveApiBaseUrl("https://api.example.test/"), "https://api.example.test");
  assert.doesNotThrow(() => clearStoredApiBaseUrl());

  delete globalThis.window;
});
