import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(__dirname, "data");
export const USER_DIR = path.join(DATA_DIR, "user");
/** Source of truth: data/attendance/<year>/<month>/<week>/<day>/<employee-slug>/ */
export const ATTENDANCE_DIR = path.join(DATA_DIR, "attendance");
const LABORS_FILE = path.join(DATA_DIR, "labors.json");
const LOGS_FILE = path.join(DATA_DIR, "attendance_logs.json");
const REJECTS_FILE = path.join(DATA_DIR, "attendance_rejects.json");
const UNMATCHED_FILE = path.join(DATA_DIR, "unmatched_attendance.json");

export const NORMAL_DAY_HOURS = 10;

export function slugifyName(name) {
  const base = String(name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "worker";
}

export function parseWorkingHours(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const range = s.match(
    /(\d{1,2}):(\d{2})\s*(?:-|–|to)\s*(\d{1,2}):(\d{2})/i,
  );
  if (range) {
    const start = Number(range[1]) + Number(range[2]) / 60;
    let end = Number(range[3]) + Number(range[4]) / 60;
    if (end < start) end += 24;
    return Math.max(0, Math.round((end - start) * 100) / 100);
  }
  const num = s.match(/(\d+(?:\.\d+)?)/);
  return num ? Math.max(0, Number(num[1])) : 0;
}

export function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function ymdLocal(ts) {
  const d = new Date(Number(ts) || 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Path parts: year / month / Wnn / day — e.g. 2026/11/W47/22 */
export function attendancePathParts(dateOrTs) {
  let y;
  let m;
  let day;
  const s = String(dateOrTs || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yy, mm, dd] = s.split("-").map(Number);
    y = yy;
    m = mm;
    day = dd;
  } else {
    const d = new Date(Number(dateOrTs) || Date.now());
    y = d.getFullYear();
    m = d.getMonth() + 1;
    day = d.getDate();
  }
  const utc = new Date(Date.UTC(y, m - 1, day));
  const dayNum = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((utc - yearStart) / 86400000 + 1) / 7);
  return {
    year: String(y),
    month: String(m),
    week: `W${week}`,
    day: String(day),
  };
}

export function employeeAttendanceSlug(name, laborId) {
  const lid = String(laborId || "").trim();
  if (!lid || lid === "_unmatched") return "_unmatched";
  const base = slugifyName(name);
  return `${base}-${lid}`;
}

export function attendanceTreeDir(dateOrTs, name, laborId) {
  const p = attendancePathParts(dateOrTs);
  const emp = employeeAttendanceSlug(name, laborId);
  return path.join(ATTENDANCE_DIR, p.year, p.month, p.week, p.day, emp);
}

function hoursSplit(hours) {
  const h = Math.max(0, Number(hours) || 0);
  return {
    hours: round2(h),
    regularHours: round2(Math.min(h, NORMAL_DAY_HOURS)),
    otHours: round2(Math.max(0, h - NORMAL_DAY_HOURS)),
  };
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJsonFile(file, fallback) {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw);
  } catch {
    return typeof fallback === "function" ? fallback() : fallback;
  }
}

async function writeJsonFile(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export function userDir(slug) {
  return path.join(USER_DIR, slug);
}

function profilePath(slug) {
  return path.join(userDir(slug), "profile.json");
}

function attendancePath(slug) {
  return path.join(userDir(slug), "attendance.json");
}

/** Pick a unique slug; if taken by another id, append -laborId. */
async function allocateSlug(name, laborId, keepId) {
  const base = slugifyName(name);
  const candidates = [base, `${base}-${laborId}`, `${base}-${String(laborId).toLowerCase()}`];
  for (const slug of candidates) {
    const existing = await readJsonFile(profilePath(slug), null);
    if (!existing || (keepId && existing.id === keepId)) return slug;
  }
  return `${base}-${laborId}-${Date.now().toString(36)}`;
}

async function listSlugs() {
  await ensureDir(USER_DIR);
  try {
    const entries = await fs.readdir(USER_DIR, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

export async function listUsers() {
  const slugs = await listSlugs();
  const rows = [];
  for (const slug of slugs) {
    const profile = await readJsonFile(profilePath(slug), null);
    if (profile?.id) rows.push({ ...profile, slug: profile.slug || slug });
  }
  rows.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return rows;
}

export async function getUserById(id) {
  const users = await listUsers();
  return users.find((u) => u.id === id) || null;
}

export async function getUserByLaborId(laborId) {
  const lid = String(laborId || "").trim();
  if (!lid) return null;
  const users = await listUsers();
  return users.find((u) => String(u.laborId) === lid) || null;
}

export async function saveUser(input) {
  const now = Date.now();
  const existing = input.id ? await getUserById(input.id) : null;
  const slug =
    existing?.slug ||
    (await allocateSlug(input.name, input.laborId, input.id || null));
  const profile = {
    id: existing?.id || input.id || `lab-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    slug,
    name: String(input.name || "").trim(),
    laborId: String(input.laborId || "").trim(),
    country: String(input.country || "").trim(),
    photoDataUrl: String(input.photoDataUrl || ""),
    photoName: String(input.photoName || "photo.jpg").trim() || "photo.jpg",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await writeJsonFile(profilePath(slug), profile);
  // ensure attendance file exists
  const attFile = attendancePath(slug);
  try {
    await fs.access(attFile);
  } catch {
    await writeJsonFile(attFile, []);
  }
  return profile;
}

export async function deleteUser(id) {
  const user = await getUserById(id);
  if (!user?.slug) return false;
  const dir = userDir(user.slug);
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export async function listAttendance(slug) {
  const rows = await readJsonFile(attendancePath(slug), []);
  return Array.isArray(rows) ? rows : [];
}

function buildAttendanceRow(entry) {
  const createdAt = Number(entry.createdAt) || Date.now();
  const hours = entry.hours != null ? Number(entry.hours) : parseWorkingHours(entry.workingHours);
  const split = hoursSplit(hours);
  const faceMismatch = Boolean(entry.faceMismatch);
  const photo =
    entry.photoDataUrl || entry.submitPhotoDataUrl || entry.checkInPhotoDataUrl || "";
  return {
    id: entry.id || `att-${Date.now().toString(36)}`,
    token: entry.token || "",
    matched: faceMismatch ? false : entry.matched !== false,
    faceMismatch,
    locationId: entry.locationId || "",
    locationName: entry.locationName || "",
    workingHours: String(entry.workingHours ?? ""),
    hours: split.hours,
    regularHours: split.regularHours,
    otHours: split.otHours,
    confidence: entry.confidence ?? null,
    distance: entry.distance ?? null,
    engine: entry.engine || "insightface",
    laborId: entry.laborId != null ? String(entry.laborId) : null,
    name: entry.name != null ? String(entry.name) : null,
    laborRecordId: entry.laborRecordId || null,
    photoDataUrl: typeof photo === "string" && photo.startsWith("data:image/") ? photo : "",
    createdAt,
    date: entry.date || ymdLocal(createdAt),
    ...(entry.source != null ? { source: entry.source } : {}),
    ...(entry.timesheetId != null ? { timesheetId: entry.timesheetId } : {}),
  };
}

function isTimesheetAttendanceRow(row) {
  if (!row || typeof row !== "object") return false;
  if (row.source === "timesheet") return true;
  if (row.engine === "timesheet-ocr") return true;
  if (String(row.token || "").startsWith("timesheet:")) return true;
  if (row.timesheetId) return true;
  return false;
}

/**
 * Remove timesheet-sourced attendance for a labor on specific dates only.
 * Other dates (and non-timesheet check-ins on those days) are left untouched —
 * used so a later upload can fill previously blank days without wiping prior commits.
 */
export async function clearTimesheetAttendanceForDates({ laborId, name, dates } = {}) {
  const dateList = [...new Set((dates || []).map((d) => String(d || "").trim()).filter(Boolean))];
  if (!dateList.length) return 0;
  const lid = String(laborId || "").trim() || "_unmatched";
  const displayName = String(name || "").trim() || (lid === "_unmatched" ? "Unknown worker" : lid);
  let removed = 0;
  for (const date of dateList) {
    const dir = attendanceTreeDir(date, displayName, lid);
    const file = path.join(dir, "attendance.json");
    const prev = await readJsonFile(file, []);
    const list = Array.isArray(prev) ? prev : [];
    if (!list.length) continue;
    const next = [];
    for (const row of list) {
      if (isTimesheetAttendanceRow(row)) {
        removed += 1;
        continue;
      }
      next.push(row);
    }
    if (next.length === list.length) continue;
    if (next.length === 0) {
      try {
        await fs.unlink(file);
      } catch {
        await writeJsonFile(file, []);
      }
      try {
        const profile = path.join(dir, "profile.json");
        try {
          await fs.unlink(profile);
        } catch {
          /* none */
        }
        await fs.rmdir(dir);
      } catch {
        /* not empty / missing */
      }
    } else {
      await writeJsonFile(file, next);
    }
  }
  return removed;
}

async function writeDayProfile(dir, user, row) {
  const snap = user
    ? {
        name: user.name,
        laborId: user.laborId,
        slug: user.slug,
        laborRecordId: user.id,
        profilePhotoRef: `user/${user.slug}/profile.json`,
      }
    : {
        name: row?.name || "Unknown worker",
        laborId: row?.laborId || "_unmatched",
        slug: "_unmatched",
        laborRecordId: null,
        profilePhotoRef: null,
      };
  await writeJsonFile(path.join(dir, "profile.json"), snap);
}

async function upsertTreeAttendance(row, user = null) {
  const date = row.date || ymdLocal(row.createdAt);
  const laborId = row.laborId || "_unmatched";
  const name = row.name || (laborId === "_unmatched" ? "Unknown worker" : laborId);
  const dir = attendanceTreeDir(date, name, laborId);
  const empSlug = employeeAttendanceSlug(name, laborId);
  await ensureDir(dir);
  await writeDayProfile(dir, user, { ...row, name, laborId });
  const file = path.join(dir, "attendance.json");
  const prev = await readJsonFile(file, []);
  const list = Array.isArray(prev) ? prev : [];
  const idx = list.findIndex((r) => r?.id === row.id);
  if (idx >= 0) list[idx] = row;
  else list.push(row);
  await writeJsonFile(file, list);
  return {
    ...row,
    slug: empSlug,
    treePath: path.relative(DATA_DIR, dir).replace(/\\/g, "/"),
  };
}

async function removeIdFromTreeFile(file, id) {
  const prev = await readJsonFile(file, []);
  const list = Array.isArray(prev) ? prev : [];
  const next = list.filter((r) => r?.id !== id);
  if (next.length === list.length) return false;
  if (next.length === 0) {
    try {
      await fs.unlink(file);
    } catch {
      await writeJsonFile(file, []);
    }
    // drop empty employee day folder if only profile left
    try {
      const dir = path.dirname(file);
      const profile = path.join(dir, "profile.json");
      try {
        await fs.unlink(profile);
      } catch {
        /* none */
      }
      await fs.rmdir(dir);
    } catch {
      /* not empty / missing */
    }
  } else {
    await writeJsonFile(file, next);
  }
  return true;
}

async function collectAttendanceJsonFiles(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await collectAttendanceJsonFiles(p, out);
    else if (e.name === "attendance.json") out.push(p);
  }
  return out;
}

async function listTreeAttendance() {
  await ensureDir(ATTENDANCE_DIR);
  const files = await collectAttendanceJsonFiles(ATTENDANCE_DIR);
  const out = [];
  for (const file of files) {
    const rows = await readJsonFile(file, []);
    if (!Array.isArray(rows)) continue;
    const empSlug = path.basename(path.dirname(file));
    for (const row of rows) {
      if (!row) continue;
      out.push({
        ...row,
        laborId: row.laborId || (empSlug === "_unmatched" ? "_unmatched" : row.laborId),
        name:
          row.name ||
          (empSlug === "_unmatched" ? "Unknown worker" : row.name),
        slug: empSlug,
        treePath: path.relative(DATA_DIR, path.dirname(file)).replace(/\\/g, "/"),
        _file: file,
      });
    }
  }
  return out;
}

async function listLegacyAttendance() {
  const users = await listUsers();
  const out = [];
  for (const user of users) {
    const rows = await listAttendance(user.slug);
    for (const row of rows) {
      if (!row) continue;
      out.push({
        ...row,
        laborId: row.laborId || user.laborId,
        name: row.name || user.name,
        laborRecordId: row.laborRecordId || user.id,
        slug: user.slug,
        _legacy: "user",
        _legacySlug: user.slug,
      });
    }
  }
  for (const file of [LOGS_FILE, UNMATCHED_FILE]) {
    const unmatched = await readJsonFile(file, []);
    if (!Array.isArray(unmatched)) continue;
    for (const row of unmatched) {
      if (!row) continue;
      out.push({
        ...row,
        laborId: row.laborId || "_unmatched",
        name: row.name || "Unknown worker",
        slug: "_unmatched",
        faceMismatch: true,
        matched: false,
        _legacy: "unmatched",
        _legacyFile: file,
      });
    }
  }
  return out;
}

/**
 * Append attendance for a known user (matched or face-mismatch with best-effort id).
 * Writes under data/attendance/<y>/<m>/<Ww>/<d>/<employee-slug>/.
 */
export async function appendAttendance(userRef, entry) {
  const user =
    typeof userRef === "string"
      ? (await getUserByLaborId(userRef)) || (await getUserById(userRef))
      : userRef;
  if (!user?.slug) {
    throw new Error("User folder not found for attendance.");
  }
  const row = buildAttendanceRow({
    ...entry,
    laborId: entry.laborId ?? user.laborId,
    name: entry.name ?? user.name,
    laborRecordId: entry.laborRecordId ?? user.id,
  });
  return upsertTreeAttendance(row, user);
}

/** Unknown identity → tree under _unmatched for that day. */
export async function appendUnmatchedAttendance(entry) {
  const row = buildAttendanceRow({ ...entry, matched: false, faceMismatch: true });
  return upsertTreeAttendance(row, null);
}

/** All submitted attendance (tree first; legacy only if not yet migrated). */
export async function listAllAttendance() {
  const tree = await listTreeAttendance();
  const byId = new Map();
  for (const row of tree) {
    if (!row?.id) continue;
    const { _file, ...rest } = row;
    byId.set(row.id, rest);
  }
  // During/after migrate, legacy copies may still exist — skip duplicate ids.
  const legacy = await listLegacyAttendance();
  for (const row of legacy) {
    if (!row?.id || byId.has(row.id)) continue;
    const { _legacy, _legacySlug, _legacyFile, ...rest } = row;
    byId.set(row.id, rest);
  }
  const out = [...byId.values()];
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

async function findAttendanceById(id) {
  const want = String(id || "");
  if (!want) return null;

  const tree = await listTreeAttendance();
  const hit = tree.find((r) => r?.id === want);
  if (hit) {
    const file = hit._file;
    const rows = await readJsonFile(file, []);
    const list = Array.isArray(rows) ? rows : [];
    const index = list.findIndex((r) => r?.id === want);
    let user = null;
    if (hit.laborRecordId) user = await getUserById(hit.laborRecordId);
    if (!user && hit.laborId && hit.laborId !== "_unmatched") {
      user = await getUserByLaborId(String(hit.laborId));
    }
    return {
      kind: "tree",
      file,
      dir: path.dirname(file),
      index,
      row: list[index] || hit,
      rows: list,
      user,
    };
  }

  // Legacy fallback (pre-migrate)
  const users = await listUsers();
  for (const user of users) {
    const rows = await listAttendance(user.slug);
    const index = rows.findIndex((r) => r?.id === want);
    if (index >= 0) {
      return {
        kind: "user",
        slug: user.slug,
        user,
        index,
        row: rows[index],
        rows,
      };
    }
  }
  for (const file of [LOGS_FILE, UNMATCHED_FILE]) {
    const rows = await readJsonFile(file, []);
    const list = Array.isArray(rows) ? rows : [];
    const index = list.findIndex((r) => r?.id === want);
    if (index >= 0) {
      return { kind: "unmatched", file, index, row: list[index], rows: list };
    }
  }
  return null;
}

/**
 * Update an attendance record by id. Moves tree folders when date/employee changes.
 */
export async function updateAttendance(id, patch = {}) {
  const found = await findAttendanceById(id);
  if (!found) return null;

  const body = patch && typeof patch === "object" ? patch : {};
  let hours =
    body.hours != null && body.hours !== ""
      ? Math.max(0, Number(body.hours))
      : body.workingHours != null
        ? parseWorkingHours(body.workingHours)
        : found.row.hours != null
          ? Number(found.row.hours)
          : parseWorkingHours(found.row.workingHours);
  if (!Number.isFinite(hours)) hours = 0;
  const split = hoursSplit(hours);

  const laborTouched =
    Object.prototype.hasOwnProperty.call(body, "laborId") ||
    Object.prototype.hasOwnProperty.call(body, "laborRecordId");
  const clearLabor =
    laborTouched &&
    (body.laborId === null ||
      body.laborId === "_unmatched" ||
      body.laborId === "" ||
      body.laborRecordId === null);

  let targetUser = null;
  if (clearLabor) {
    targetUser = null;
  } else if (laborTouched) {
    const laborRecordIdIn =
      body.laborRecordId != null ? String(body.laborRecordId).trim() : "";
    const laborIdIn = body.laborId != null ? String(body.laborId).trim() : "";
    if (laborRecordIdIn) targetUser = await getUserById(laborRecordIdIn);
    if (!targetUser && laborIdIn && laborIdIn !== "_unmatched") {
      targetUser = await getUserByLaborId(laborIdIn);
    }
    if (!targetUser) {
      throw new Error("Employee not found.");
    }
  } else if (found.user) {
    targetUser = found.user;
  } else if (found.row.laborRecordId || found.row.laborId) {
    targetUser =
      (found.row.laborRecordId && (await getUserById(found.row.laborRecordId))) ||
      (found.row.laborId && (await getUserByLaborId(String(found.row.laborId)))) ||
      null;
  }

  const locationId =
    body.locationId != null
      ? String(body.locationId).trim()
      : String(found.row.locationId || "");
  const locationName =
    body.locationName != null
      ? String(body.locationName).trim()
      : String(found.row.locationName || "");

  const workingHours =
    body.workingHours != null
      ? String(body.workingHours)
      : body.hours != null
        ? String(split.hours)
        : String(found.row.workingHours ?? split.hours);

  const nextRow = {
    ...found.row,
    id: found.row.id || `att-${Date.now().toString(36)}`,
    locationId,
    locationName,
    workingHours,
    hours: split.hours,
    regularHours: split.regularHours,
    otHours: split.otHours,
    photoDataUrl: found.row.photoDataUrl || "",
  };

  if (targetUser) {
    nextRow.laborId = targetUser.laborId;
    nextRow.name = targetUser.name;
    nextRow.laborRecordId = targetUser.id;
    if (laborTouched) {
      nextRow.matched = true;
      nextRow.faceMismatch = false;
    }
  } else if (clearLabor) {
    nextRow.laborId = null;
    nextRow.name = null;
    nextRow.laborRecordId = null;
    nextRow.matched = false;
    nextRow.faceMismatch = true;
  }

  if (body.date != null && String(body.date).trim()) {
    nextRow.date = String(body.date).trim();
  }

  // Always persist to tree (migrate-on-write for legacy hits).
  if (found.kind === "tree") {
    await removeIdFromTreeFile(found.file, found.row.id);
  } else if (found.kind === "user") {
    const kept = found.rows.filter((_, i) => i !== found.index);
    await writeJsonFile(attendancePath(found.slug), kept);
  } else if (found.kind === "unmatched") {
    const next = found.rows.filter((_, i) => i !== found.index);
    await writeJsonFile(found.file, next);
  }

  const saved = await upsertTreeAttendance(
    {
      ...nextRow,
      matched: targetUser ? nextRow.matched !== false && !nextRow.faceMismatch : false,
      faceMismatch: targetUser ? Boolean(nextRow.faceMismatch) : true,
      laborId: targetUser ? nextRow.laborId : nextRow.laborId || "_unmatched",
      name: targetUser ? nextRow.name : nextRow.name || "Unknown worker",
    },
    targetUser,
  );

  if (!targetUser) {
    return {
      ...saved,
      slug: "_unmatched",
      faceMismatch: true,
      matched: false,
      laborId: saved.laborId || "_unmatched",
      name: saved.name || "Unknown worker",
    };
  }
  return saved;
}

export async function deleteAttendance(id) {
  const found = await findAttendanceById(id);
  if (!found) return false;
  if (found.kind === "tree") {
    return removeIdFromTreeFile(found.file, found.row.id);
  }
  if (found.kind === "user") {
    const kept = found.rows.filter((_, i) => i !== found.index);
    await writeJsonFile(attendancePath(found.slug), kept);
    return true;
  }
  const prev = await readJsonFile(found.file, []);
  const list = Array.isArray(prev) ? prev : [];
  const next = list.filter((r) => r?.id !== id);
  if (next.length === list.length) return false;
  await writeJsonFile(found.file, next);
  return true;
}

/** Copy legacy flat/user attendance into year/month/week/day/employee tree. */
export async function migrateAttendanceToTree() {
  await ensureDir(ATTENDANCE_DIR);
  const legacy = await listLegacyAttendance();
  let moved = 0;
  const treeIds = new Set(
    (await listTreeAttendance()).map((r) => r?.id).filter(Boolean),
  );

  for (const row of legacy) {
    if (!row?.id || treeIds.has(row.id)) continue;
    let user = null;
    if (row.laborRecordId) user = await getUserById(row.laborRecordId);
    if (!user && row.laborId && row.laborId !== "_unmatched") {
      user = await getUserByLaborId(String(row.laborId));
    }
    const built = buildAttendanceRow(row);
    await upsertTreeAttendance(built, user);
    treeIds.add(row.id);
    moved += 1;
  }

  // Archive legacy user attendance arrays (keep profile folders).
  if (moved > 0 || legacy.length > 0) {
    const users = await listUsers();
    for (const user of users) {
      const file = attendancePath(user.slug);
      const rows = await readJsonFile(file, []);
      if (Array.isArray(rows) && rows.length) {
        try {
          await fs.rename(file, `${file}.pre-tree`);
        } catch {
          /* already archived */
        }
        await writeJsonFile(file, []);
      }
    }
    for (const file of [LOGS_FILE, UNMATCHED_FILE]) {
      const rows = await readJsonFile(file, []);
      if (Array.isArray(rows) && rows.length) {
        try {
          await fs.access(`${file}.pre-tree`);
        } catch {
          try {
            await fs.rename(file, `${file}.pre-tree`);
          } catch {
            /* ignore */
          }
        }
        await writeJsonFile(file, []);
      }
    }
  }

  return { moved, treeRecords: treeIds.size };
}

export async function appendReject(entry) {
  await ensureDir(DATA_DIR);
  const rows = await readJsonFile(REJECTS_FILE, []);
  const list = Array.isArray(rows) ? rows : [];
  list.push(entry);
  await writeJsonFile(REJECTS_FILE, list);
}

// One-shot migrate labors.json + attendance_logs.json into data/user/<slug>/
export async function migrateFlatToUsers() {
  await ensureDir(USER_DIR);
  let labors = [];
  try {
    const raw = await fs.readFile(LABORS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) labors = parsed;
  } catch {
    /* no flat labors */
  }

  const existing = await listUsers();
  if (labors.length && existing.length === 0) {
    for (const labor of labors) {
      await saveUser({
        id: labor.id,
        name: labor.name,
        laborId: labor.laborId,
        country: labor.country,
        photoDataUrl: labor.photoDataUrl,
        photoName: labor.photoName,
      });
      // preserve timestamps if present
      const user = await getUserById(labor.id);
      if (user?.slug) {
        const profile = {
          ...user,
          createdAt: labor.createdAt || labor.updatedAt || user.createdAt,
          updatedAt: labor.updatedAt || user.updatedAt,
        };
        await writeJsonFile(profilePath(user.slug), profile);
      }
    }
  } else if (labors.length && existing.length > 0) {
    // merge any missing labors by id
    const have = new Set(existing.map((u) => u.id));
    for (const labor of labors) {
      if (!have.has(labor.id)) {
        await saveUser({
          id: labor.id,
          name: labor.name,
          laborId: labor.laborId,
          country: labor.country,
          photoDataUrl: labor.photoDataUrl,
          photoName: labor.photoName,
        });
      }
    }
  }

  // Migrate matched flat logs into per-user attendance.json (idempotent by id).
  // Keep unmatched / face-mismatch rows in attendance_logs.json (still in reports).
  async function readLogArray(file) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  let flatLogs = await readLogArray(LOGS_FILE);
  if (!flatLogs.length) {
    // Recover rows archived by older migrate that renamed the active unmatched store.
    const archived = await readLogArray(`${LOGS_FILE}.migrated`);
    if (archived.length) flatLogs = archived;
  }

  const keepUnmatched = [];
  for (const log of flatLogs) {
    if (!log?.matched || !log.laborId) {
      keepUnmatched.push(log);
      continue;
    }
    const user = await getUserByLaborId(log.laborId);
    if (!user) {
      keepUnmatched.push(log);
      continue;
    }
    const existingAtt = await listAttendance(user.slug);
    if (existingAtt.some((r) => r.id === log.id)) continue;
    await appendAttendance(user, {
      id: log.id,
      token: log.token,
      matched: true,
      faceMismatch: false,
      locationId: log.locationId,
      locationName: log.locationName,
      workingHours: log.workingHours,
      hours: log.hours,
      confidence: log.confidence,
      distance: log.distance,
      engine: log.engine,
      createdAt: log.createdAt,
    });
  }

  // Dedupe by id, prefer newest createdAt
  const byId = new Map();
  for (const row of keepUnmatched) {
    if (!row?.id) continue;
    const prev = byId.get(row.id);
    if (!prev || (Number(row.createdAt) || 0) >= (Number(prev.createdAt) || 0)) {
      byId.set(row.id, row);
    }
  }
  await writeJsonFile(LOGS_FILE, [...byId.values()]);

  // Archive legacy labors.json only (LOGS_FILE stays the unmatched attendance store)
  const usersNow = await listUsers();
  if (usersNow.length > 0) {
    try {
      await fs.access(LABORS_FILE);
      await fs.rename(LABORS_FILE, `${LABORS_FILE}.migrated`);
    } catch {
      /* already gone */
    }
  }

  return { users: usersNow.length };
}
