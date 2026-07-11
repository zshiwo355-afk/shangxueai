import test from "node:test";
import assert from "node:assert/strict";

import { normalizeSeriesTargetsFromForm } from "./magicAcademyPageHelpers.js";

test("keeps reading series department targets dynamic while preserving selected users", () => {
  const targets = normalizeSeriesTargetsFromForm({
    target_all: false,
    target_department_ids: ["Sales/Team A", 42],
    target_position_ids: ["Coach"],
    target_job_level_ids: ["M"],
    target_employment_status_ids: ["active"],
    target_user_ids: [7],
  });

  assert.deepEqual(targets, [
    { target_type: "department", target_id: "Sales/Team A" },
    { target_type: "user", target_id: 42 },
    { target_type: "position", target_id: "Coach" },
    { target_type: "job_level", target_id: "M" },
    { target_type: "employment_status", target_id: "active" },
    { target_type: "user", target_id: 7 },
  ]);
});
