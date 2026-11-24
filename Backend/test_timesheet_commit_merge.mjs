/**
 * Assert commit merge: replace only dates in the new payload; keep earlier days.
 * Run: node test_timesheet_commit_merge.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DATA_DIR,
  appendAttendance,
  clearTimesheetAttendanceForDates,
  listAllAttendance,
  saveUser,
} from "./userStore.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP_MARKER = path.join(DATA_DIR, ".test-commit-merge-marker");

async function main() {
  // Use a disposable labor id unlikely to collide with real data
  const laborId = "ts-merge-fixture-991";
  const name = "Partial Sheet Fixture";
  const user = await saveUser({
    name,
    laborId,
    country: "Test",
  });

  const early = {
    id: "att-ts-fixture-early-1",
    token: "timesheet:fixture-a",
    locationId: "loc-test",
    locationName: "Central Workshop",
    workingHours: "10",
    hours: 10,
    matched: true,
    engine: "timesheet-ocr",
    laborId,
    name,
    laborRecordId: user.id,
    createdAt: new Date("2026-11-21T12:00:00").getTime(),
    date: "2026-11-21",
    source: "timesheet",
    timesheetId: "fixture-a",
  };
  await appendAttendance(user, early);

  // Simulate later upload filling only 22–25 Nov — clear those dates only
  const newDates = ["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25"];
  const removed = await clearTimesheetAttendanceForDates({
    laborId,
    name,
    dates: newDates,
  });
  assert.equal(removed, 0, "nothing to remove on blank trailing dates yet");

  // Prior 21-Nov must still exist
  let all = await listAllAttendance();
  const kept = all.filter((r) => r.laborId === laborId && r.date === "2026-11-21");
  assert.ok(kept.length >= 1, "21-Nov prior commit must remain");

  // Overlapping replace: new payload includes 21-Nov again + new 22-Nov
  await clearTimesheetAttendanceForDates({
    laborId,
    name,
    dates: ["2026-11-21", "2026-11-22"],
  });
  all = await listAllAttendance();
  assert.equal(
    all.filter((r) => r.laborId === laborId && r.date === "2026-11-21").length,
    0,
    "21-Nov cleared when present in new payload",
  );

  await appendAttendance(user, {
    ...early,
    id: "att-ts-fixture-early-2",
    hours: 11,
    workingHours: "11",
    date: "2026-11-21",
    createdAt: new Date("2026-11-21T12:00:01").getTime(),
  });
  await appendAttendance(user, {
    ...early,
    id: "att-ts-fixture-new-22",
    hours: 8,
    workingHours: "8",
    date: "2026-11-22",
    createdAt: new Date("2026-11-22T12:00:00").getTime(),
    timesheetId: "fixture-b",
    token: "timesheet:fixture-b",
  });

  all = await listAllAttendance();
  const d21 = all.filter((r) => r.laborId === laborId && r.date === "2026-11-21");
  const d22 = all.filter((r) => r.laborId === laborId && r.date === "2026-11-22");
  assert.equal(d21.length, 1);
  assert.equal(d21[0].hours, 11);
  assert.equal(d22.length, 1);
  assert.equal(d22[0].hours, 8);

  // Cleanup fixture attendance days + marker
  await clearTimesheetAttendanceForDates({
    laborId,
    name,
    dates: ["2026-11-21", "2026-11-22", ...newDates],
  });
  await fs.writeFile(TMP_MARKER, "ok\n", "utf8");
  console.log("ok — commit merge keeps absent dates, replaces overlapping payload dates");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
