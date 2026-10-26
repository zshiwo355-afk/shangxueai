import test from "node:test";
import assert from "node:assert/strict";

import {
  clearAuth,
  getCurrentUser,
  getToken,
  setCurrentUser,
  setToken,
} from "./auth.js";


test("uses memory only when localStorage is unavailable", () => {
  const values = new Map();
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return values.get(key) ?? null;
      },
      setItem(key, value) {
        values.set(key, value);
      },
      removeItem(key) {
        values.delete(key);
      },
    },
  };

  setToken("active-token");
  setCurrentUser({ id: 1, role: "user" });
  assert.equal(getToken(), "active-token");
  assert.deepEqual(getCurrentUser(), { id: 1, role: "user" });

  values.clear();
  assert.equal(getToken(), "");
  assert.equal(getCurrentUser(), null);

  setToken("memory-token");
  setCurrentUser({ id: 2, role: "admin" });
  window.localStorage.getItem = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  window.localStorage.setItem = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  window.localStorage.removeItem = () => {
    throw new DOMException("blocked", "SecurityError");
  };

  assert.equal(getToken(), "memory-token");
  assert.deepEqual(getCurrentUser(), { id: 2, role: "admin" });
  clearAuth();
  assert.equal(getToken(), "");
  assert.equal(getCurrentUser(), null);

  delete globalThis.window;
});
