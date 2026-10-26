export function selectableStaffIds(rows) {
  return rows.filter((row) => !row.user_disabled).map((row) => String(row.user_id));
}

export function normalizeStaffSelection(rows, keys) {
  const allowed = new Set(selectableStaffIds(rows));
  return [...new Set(keys.map(String))].filter((key) => allowed.has(key));
}

// The complete draft is passed in so selections on other pages stay effective.
export function applyStaffEnabled(rows, keys, enabled) {
  if (typeof enabled !== "boolean") return rows;
  const selected = new Set(normalizeStaffSelection(rows, keys));
  return rows.map((row) => selected.has(String(row.user_id)) ? { ...row, enabled } : row);
}

// Adding people grants access directly. Existing active rows and all disabled
// accounts remain untouched; no per-person quota configuration is required.
export function addStaffUsers(rows, users) {
  const selectedUsers = new Map(users.filter((user) => !user.disabled).map((user) => [String(user.id), user]));
  const existing = new Set(rows.map((row) => String(row.user_id)));
  let reenabledCount = 0;
  const next = rows.map((row) => {
    if (selectedUsers.has(String(row.user_id)) && !row.user_disabled && row.enabled === false) {
      reenabledCount += 1;
      return { ...row, enabled: true };
    }
    return row;
  });
  const additions = [...selectedUsers.values()].filter((user) => !existing.has(String(user.id))).map((user) => ({
    user_id: user.id,
    username: user.username,
    display_name: user.real_name || user.display_name,
    department: user.department,
    user_disabled: false,
    enabled: true,
  }));
  return { rows: [...next, ...additions], addedCount: additions.length, reenabledCount };
}

export function staffPermissionPayload(row) {
  return {
    user_id: row.user_id,
    enabled: !row.user_disabled && row.enabled !== false,
    // Keep compatibility with the existing API while clearing obsolete caps.
    link_quota: 0,
    max_chances_per_link: 1,
  };
}
