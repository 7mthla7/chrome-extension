/* ─────────────────────────────────────────────────────────────────────────────
   popup.js — Alarm browser extension popup
   ───────────────────────────────────────────────────────────────────────────── */

// ── Constants ─────────────────────────────────────────────────────────────────

const DISABLED_KEY = "disabledAlarms"; // chrome.storage.local key
const THEME_KEY    = "theme";          // "light" | "dark"

// ── Date / time helpers ───────────────────────────────────────────────────────

// Parse "h:mm AM" / "h:mm PM" (Alvaria time format) into { hours, minutes }.
function parseTimeText(timeText) {
  const match = timeText.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "AM") {
    if (hours === 12) hours = 0;
  } else {
    if (hours !== 12) hours += 12;
  }
  return { hours, minutes };
}

// Parse "M/D/YYYY" (after stripping the "Weekday, " prefix) into { year, month0, day }.
function parseDateText(dateText) {
  const parts = dateText.split(",");
  const normalized = parts.length > 1 ? parts.slice(1).join(",").trim() : dateText.trim();
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return {
    month0: parseInt(match[1], 10) - 1,
    day:    parseInt(match[2], 10),
    year:   parseInt(match[3], 10)
  };
}

function parseSegmentDate(segment) {
  const dateParts = parseDateText(segment.dateText);
  const timeParts = parseTimeText(segment.startTimeText);
  if (!dateParts || !timeParts) return null;
  return new Date(dateParts.year, dateParts.month0, dateParts.day, timeParts.hours, timeParts.minutes, 0, 0);
}

function compareSegments(left, right) {
  const leftDate  = parseSegmentDate(left);
  const rightDate = parseSegmentDate(right);
  if (!leftDate && !rightDate) return 0;
  if (!leftDate) return 1;
  if (!rightDate) return -1;
  return leftDate.getTime() - rightDate.getTime();
}

function buildCombinedSegments(state) {
  // Use scheduledSegments (maintained by background.js — fired alarms are
  // removed on trigger) plus manualSegments.  parsedSegments are the raw
  // scrape result and are never cleaned, so fired alarms would reappear if
  // we included them here.
  const combined = [
    ...(state.scheduledSegments || []),
    ...(state.manualSegments    || [])
  ];

  const now = Date.now();
  const uniqueSegments = new Map();
  for (const segment of combined) {
    const key = `${segment.dateText}|${segment.startTimeText}|${segment.label}`;
    if (uniqueSegments.has(key)) continue;
    // Skip segments with unparseable dates, and any that have already started.
    const segDate = parseSegmentDate(segment);
    if (!segDate || segDate.getTime() <= now) continue;
    uniqueSegments.set(key, segment);
  }
  return Array.from(uniqueSegments.values());
}

// "Today", "Tomorrow", or "Mon 6/16"
function friendlyDate(date) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d     = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((d - today) / 86400000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "numeric", day: "numeric" });
}

// Group header label, e.g. "TODAY — MON 6/16" or "TOMORROW — TUE 6/17"
function groupHeaderDate(date) {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const d     = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((d - today) / 86400000);
  const weekdayStr = date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const dateStr    = `${date.getMonth() + 1}/${date.getDate()}`;
  if (diffDays === 0) return `TODAY — ${weekdayStr} ${dateStr}`;
  if (diffDays === 1) return `TOMORROW — ${weekdayStr} ${dateStr}`;
  return `${weekdayStr} ${dateStr}`;
}

// "in 5m", "in 2h 30m", or "now"
function relativeTime(targetMs) {
  const diffMs = targetMs - Date.now();
  const mins   = Math.floor(diffMs / 60000);
  const hrs    = Math.floor(mins / 60);
  const remMin = mins % 60;

  if (diffMs < 60000) return "now";

  return hrs > 0 ? `in ${hrs}h ${remMin}m` : `in ${mins}m`;
}

// "9:00 AM"
function formatTime12h(date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Map a segment label to a CSS dot class
function dotClassForLabel(label) {
  const l = label.toLowerCase();
  if (l.includes("break"))               return "dot--break";
  if (l.includes("lunch") || l.includes("meal") || l.includes("dinner")) return "dot--meal";
  if (l.includes("meeting") || l.includes("training") || l.includes("special")) return "dot--special";
  if (l.includes("manual") || l.includes("ksc"))  return "dot--success";
  return "dot--muted";
}

// ── Disabled alarms (persistent) ─────────────────────────────────────────────

let disabledAlarms = new Set();

async function loadDisabledAlarms() {
  try {
    const stored = await chrome.storage.local.get(DISABLED_KEY);
    disabledAlarms = new Set(stored[DISABLED_KEY] || []);
  } catch {
    disabledAlarms = new Set();
  }
}

async function saveDisabledAlarms() {
  try {
    await chrome.storage.local.set({ [DISABLED_KEY]: [...disabledAlarms] });
  } catch {
    // non-critical
  }
}

function segmentKey(segment) {
  return `${segment.dateText}|${segment.startTimeText}|${segment.label}`;
}

function isDisabled(segment) {
  return disabledAlarms.has(segmentKey(segment));
}

function setDisabled(segment, disabled) {
  const key = segmentKey(segment);
  if (disabled) {
    disabledAlarms.add(key);
  } else {
    disabledAlarms.delete(key);
  }
  saveDisabledAlarms();
}

// ── Toggle switch widget ──────────────────────────────────────────────────────

let _toggleSerial = 0;

function createToggle(segment, onChanged) {
  const id    = `toggle-${++_toggleSerial}`;
  const wrap  = document.createElement("label");
  wrap.className   = "toggle-wrap";
  wrap.htmlFor     = id;
  wrap.setAttribute("title", "Enable / disable alarm");

  const input  = document.createElement("input");
  input.type   = "checkbox";
  input.id     = id;
  input.className = "toggle-input";
  input.checked   = !isDisabled(segment);
  input.setAttribute("aria-label", "Enable alarm");

  const track = document.createElement("span");
  track.className = "toggle-track";

  input.addEventListener("change", () => {
    setDisabled(segment, !input.checked);
    onChanged(!input.checked);
  });

  wrap.appendChild(input);
  wrap.appendChild(track);
  return wrap;
}

// ── Next-Up card ──────────────────────────────────────────────────────────────

function buildNextUpCard(segments) {
  const container = document.createElement("div");
  container.className = "next-up";

  const label = document.createElement("div");
  label.className = "next-up__label";
  label.textContent = "Next up";
  container.appendChild(label);

  // Find first enabled segment (all segments are already future-only)
  const next = segments
    .filter(s => !isDisabled(s))
    .sort(compareSegments)[0];

  if (!next) {
    const empty = document.createElement("div");
    empty.className = "next-up__empty";
    empty.textContent = "No upcoming alarms";
    container.appendChild(empty);
    return container;
  }

  const card = document.createElement("div");
  card.className = "next-up__card";

  const dot = document.createElement("span");
  dot.className = `next-up__dot ${dotClassForLabel(next.label)}`;

  const body = document.createElement("div");
  body.className = "next-up__body";

  const name = document.createElement("div");
  name.className = "next-up__name";
  name.textContent = next.label;

  const segDate = parseSegmentDate(next);

  const timeEl = document.createElement("div");
  timeEl.className = "next-up__time";
  timeEl.textContent = formatTime12h(segDate);

  const rel = document.createElement("div");
  rel.className = "next-up__relative";
  rel.textContent = relativeTime(segDate.getTime());

  body.appendChild(name);
  body.appendChild(timeEl);
  body.appendChild(rel);

  const toggle = createToggle(next, () => renderTimeline());
  toggle.className += " next-up__toggle";

  card.appendChild(dot);
  card.appendChild(body);
  card.appendChild(toggle);
  container.appendChild(card);
  return container;
}

// ── Individual alarm row ──────────────────────────────────────────────────────

function buildAlarmRow(segment) {
  const li = document.createElement("li");
  li.className = "alarm-row";

  const segDate = parseSegmentDate(segment);

  if (isDisabled(segment)) li.classList.add("alarm-row--disabled");

  // Dot
  const dot = document.createElement("span");
  dot.className = `alarm-dot ${dotClassForLabel(segment.label)}`;

  // Time
  const timeEl = document.createElement("span");
  timeEl.className = "alarm-row__time";
  timeEl.textContent = segDate ? formatTime12h(segDate) : segment.startTimeText;

  // Name
  const name = document.createElement("span");
  name.className = "alarm-row__name";
  name.textContent = segment.label;

  // Toggle
  const toggle = createToggle(segment, (nowDisabled) => {
    li.classList.toggle("alarm-row--disabled", nowDisabled);
    renderTimeline();
  });

  li.appendChild(dot);
  li.appendChild(timeEl);
  li.appendChild(name);
  li.appendChild(toggle);

  // Delete button — only for manual segments
  if (segment.priority === "manual") {
    const delBtn = document.createElement("button");
    delBtn.className  = "alarm-row__delete";
    delBtn.type       = "button";
    delBtn.setAttribute("aria-label", `Delete alarm: ${segment.label}`);
    delBtn.textContent = "✕";

    delBtn.addEventListener("click", async () => {
      delBtn.disabled = true;
      const response = await safeSendMessage({ type: "DELETE_MANUAL_SEGMENT", segment });
      if (response && response.ok) {
        renderState(response);
      } else {
        delBtn.disabled = false;
      }
    });

    li.appendChild(delBtn);
  }

  return li;
}

// ── Day-group section ─────────────────────────────────────────────────────────

function buildDayGroup(dateKey, segments) {
  const group = document.createElement("div");
  group.className = "day-group";

  // Parse any segment's dateText to get the real Date object
  const sampleDate = parseSegmentDate(segments[0]);

  const header = document.createElement("div");
  header.className = "day-group__header";

  const title = document.createElement("span");
  title.className = "day-group__title";
  title.textContent = sampleDate ? groupHeaderDate(sampleDate) : dateKey;

  const line = document.createElement("span");
  line.className = "day-group__line";

  header.appendChild(title);
  header.appendChild(line);

  const ul = document.createElement("ul");
  ul.className = "alarm-list";

  for (const seg of segments.sort(compareSegments)) {
    ul.appendChild(buildAlarmRow(seg));
  }

  group.appendChild(header);
  group.appendChild(ul);
  return group;
}

// ── Timeline renderer (main) ──────────────────────────────────────────────────

let _currentSegments = [];

function renderTimeline() {
  const root = document.getElementById("timeline-root");
  if (!root) return;

  root.textContent = "";

  const segments = _currentSegments;

  if (!segments.length) {
    const empty = document.createElement("div");
    empty.className = "timeline-empty";
    const icon = document.createElement("div");
    icon.className = "timeline-empty__icon";
    icon.textContent = "🔔";
    const msg = document.createElement("p");
    msg.textContent = "No alarms scheduled";
    empty.appendChild(icon);
    empty.appendChild(msg);
    root.appendChild(empty);
    return;
  }

  // Next-up card
  root.appendChild(buildNextUpCard(segments));

  // Group by date key (dateText field)
  const groups = new Map();
  for (const seg of segments) {
    const key = seg.dateText || "Unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(seg);
  }

  // Sort groups chronologically by the first segment in each group
  const sortedGroups = [...groups.entries()].sort(([, a], [, b]) =>
    compareSegments(a[0], b[0])
  );

  for (const [dateKey, segs] of sortedGroups) {
    root.appendChild(buildDayGroup(dateKey, segs));
  }
}

function renderState(state) {
  _currentSegments = buildCombinedSegments(state);
  renderTimeline();
  // refreshQrIfVisible is defined later in the file; only call it after init.
  if (typeof refreshQrIfVisible === "function") refreshQrIfVisible();
}

// ── Messaging ─────────────────────────────────────────────────────────────────

function safeSendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime?.lastError) {
          if (chrome.runtime.lastError.message === "The message port closed before a response was received.") {
            resolve(null);
            return;
          }
          console.warn("[alvaria-alerts] runtime message failed", chrome.runtime.lastError.message);
          resolve(null);
          return;
        }
        resolve(response ?? null);
      });
    } catch (error) {
      console.warn("[alvaria-alerts] extension context invalidated", error);
      resolve(null);
    }
  });
}

async function loadState() {
  const response = await safeSendMessage({ type: "GET_SEGMENTS" });
  renderState(response || { parsedSegments: [], manualSegments: [], scheduledSegments: [] });
}

// ── Manual form helpers ───────────────────────────────────────────────────────

function formatManualDate(dateValue) {
  if (!dateValue) return "";
  const [year, month, day] = dateValue.split("-").map(Number);
  if (!year || !month || !day) return "";
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.toLocaleDateString("en-US", { weekday: "long" })}, ${parsed.getMonth() + 1}/${parsed.getDate()}/${parsed.getFullYear()}`;
}

function formatManualTime(timeValue) {
  if (!timeValue) return "";
  const [hoursText, minutesText] = timeValue.split(":");
  const hours   = Number(hoursText);
  const minutes = Number(minutesText);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return "";
  const period     = hours >= 12 ? "PM" : "AM";
  const twelveHour = hours % 12 || 12;
  return `${twelveHour}:${String(minutes).padStart(2, "0")} ${period}`;
}

function getFormSegment() {
  return {
    dateText:      formatManualDate(document.getElementById("manual-date")?.value || ""),
    startTimeText: formatManualTime(document.getElementById("manual-time")?.value || ""),
    label:         document.getElementById("manual-label")?.value.trim() || "",
    priority:      "manual"
  };
}

// ── Header date ───────────────────────────────────────────────────────────────

function setAppDate() {
  const el = document.getElementById("app-date");
  if (el) {
    el.textContent = friendlyDate(new Date());
  }
}

// ── Settings panel toggle ─────────────────────────────────────────────────────

function openSettingsPanel() {
  const panel = document.getElementById("settings-panel");
  if (!panel) return;

  const dateInput = document.getElementById("manual-date");
  if (dateInput && !dateInput.value) {
    const now  = new Date();
    const yyyy = now.getFullYear();
    const mm   = String(now.getMonth() + 1).padStart(2, "0");
    const dd   = String(now.getDate()).padStart(2, "0");
    dateInput.value = `${yyyy}-${mm}-${dd}`;
  }

  panel.hidden = false;
  document.getElementById("manual-label")?.focus();
}

function closeSettingsPanel() {
  const panel = document.getElementById("settings-panel");
  if (!panel) return;
  panel.hidden = true;
}

// ── Event wiring ──────────────────────────────────────────────────────────────

const addAlarmBtn = document.getElementById("add-alarm-btn");
if (addAlarmBtn) {
  addAlarmBtn.addEventListener("click", () => openSettingsPanel());
}

const cancelBtn = document.getElementById("cancel-form");
if (cancelBtn) {
  cancelBtn.addEventListener("click", () => closeSettingsPanel());
}

const manualForm = document.getElementById("manual-form");
if (manualForm) {
  manualForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const dateInput  = document.getElementById("manual-date");
    const timeInput  = document.getElementById("manual-time");
    const labelInput = document.getElementById("manual-label");

    let valid = true;
    for (const input of [dateInput, timeInput, labelInput]) {
      if (!input) continue;
      if (!input.value.trim()) {
        input.classList.add("is-invalid");
        valid = false;
      } else {
        input.classList.remove("is-invalid");
      }
    }

    if (!valid) return;

    const response = await safeSendMessage({ type: "ADD_MANUAL_SEGMENT", segment: getFormSegment() });

    if (response && response.ok) {
      renderState(response);
      event.target.reset();
      closeSettingsPanel();
    }
  });

  manualForm.querySelectorAll("input").forEach((input) => {
    input.addEventListener("input", () => input.classList.remove("is-invalid"));
  });
}

// ── Theme (dark mode) ─────────────────────────────────────────────────────────

function applyTheme(theme) {
  if (theme === "dark") {
    document.body.setAttribute("data-theme", "dark");
  } else {
    document.body.removeAttribute("data-theme");
  }

  const btn = document.getElementById("theme-toggle");
  if (btn) {
    btn.textContent = theme === "dark" ? "☀️" : "🌙";
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
  }
}

async function loadTheme() {
  try {
    const stored = await chrome.storage.local.get(THEME_KEY);
    applyTheme(stored[THEME_KEY] === "dark" ? "dark" : "light");
  } catch {
    applyTheme("light");
  }
}

async function toggleTheme() {
  const isDark = document.body.getAttribute("data-theme") === "dark";
  const next   = isDark ? "light" : "dark";
  applyTheme(next);
  try {
    await chrome.storage.local.set({ [THEME_KEY]: next });
  } catch {
    // non-critical
  }
}

const themeToggle = document.getElementById("theme-toggle");
if (themeToggle) {
  themeToggle.addEventListener("click", toggleTheme);
}

// ── Refresh button ────────────────────────────────────────────────────────────

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", async () => {
    refreshBtn.classList.add("is-spinning");

    const response = await safeSendMessage({ type: "REFRESH_SEGMENTS" });

    await new Promise((r) => setTimeout(r, 600));
    refreshBtn.classList.remove("is-spinning");

    if (response && response.ok) {
      renderState(response);
    } else {
      await loadState();
    }
  });
}

// ── Pop-out button ────────────────────────────────────────────────────────────
// Clicking the ⧉ button opens popup.html as a standalone movable window.
// When already running as that window (?mode=window), the button is hidden
// via CSS and we add .is-window to <body> to expand the layout.

(function initPopout() {
  const isWindow = new URLSearchParams(window.location.search).get("mode") === "window";

  if (isWindow) {
    document.body.classList.add("is-window");
    return;
  }

  const popoutBtn = document.getElementById("popout-btn");
  if (!popoutBtn) return;

  popoutBtn.addEventListener("click", () => {
    chrome.windows.create({
      url: chrome.runtime.getURL("popup.html?mode=window"),
      type: "popup",
      width: 460,
      height: 600,
      focused: true,
    });
    window.close();
  });
})();

// ── Init ──────────────────────────────────────────────────────────────────────

setAppDate();
Promise.all([loadTheme(), loadDisabledAlarms()]).then(() => loadState());

// ── QR overlay ────────────────────────────────────────────────────────────────
// Library: qrcode-generator (qrcode.js), loaded as a plain <script> before
// this file. Exposes window.qrcode(typeNumber, errorCorrectionLevel).
//
// Format V1: compact schedule encoding so the entire 5-day schedule (~50 alarms)
// fits in a single QR code without an external server.
//
// Wire format (all ASCII, plain-text):
//   V1|<dict>|<days>
//
//   <dict>  = comma-separated entries: <id>=<escaped-label>
//             IDs: 0-9 A-Z a-z (up to 62 unique labels before falling back to 2-char)
//             Label escaping: ~ → ~0,  | → ~1,  , → ~2,  = → ~3
//
//   <days>  = pipe-separated day blocks: <MMDDYYYY>:<alarms>
//             <alarms> = semicolon-separated entries: <base36-minutes><id>
//             Times are DELTA-encoded: first alarm is absolute minutes-from-midnight,
//             subsequent alarms are the delta from the previous time in the same day.
//             Delta is always ≥ 0 (alarms are sorted ascending before encoding).
//
// Example (2 days, 3 alarms):
//   V1|0=Break,1=Lunch,2=KSC O&D T1|08262026:1e02,3c1,1e02|08272026:1e02,1e01
//
// QR is error-correction level L (2953 byte capacity) with alphanumeric mode where
// possible, giving ample room for a real 5-day 50-alarm schedule.

// ── Compact schedule encoder / decoder ──────────────────────────────────────

// Characters used as short IDs for dictionary labels.
// IMPORTANT: IDs must be unambiguously parseable from a base36 delta prefix.
// base36 uses digits 0-9 and lowercase a-z.  Uppercase A-Z are NOT valid base36
// digits, so using uppercase letters first guarantees that the ID character is
// always distinguishable from the end of the delta number.
// Order: A-Z (26) → then two-char "AA","AB",… fallback for >26 unique labels.
// With typical schedules having <10 unique labels, single uppercase chars suffice.
const _QR_ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

// Assign the shortest possible ID to each index (0 → "A", 25 → "Z", 26 → "AA"…)
function _qrId(index) {
  const base = _QR_ID_CHARS.length; // 26
  if (index < base) return _QR_ID_CHARS[index];
  // Two-character fallback for > 26 unique labels (rare in practice)
  return _QR_ID_CHARS[Math.floor(index / base) - 1] + _QR_ID_CHARS[index % base];
}

// Escape special characters inside a label so they don't collide with delimiters.
// ~ → ~0   | → ~1   , → ~2   = → ~3
function _escLabel(label) {
  return label
    .replace(/~/g,  "~0")
    .replace(/\|/g, "~1")
    .replace(/,/g,  "~2")
    .replace(/=/g,  "~3");
}

function _unescLabel(s) {
  return s
    .replace(/~3/g, "=")
    .replace(/~2/g, ",")
    .replace(/~1/g, "|")
    .replace(/~0/g, "~");
}

// Convert "h:mm AM/PM" to minutes from midnight (0–1439), or null on failure.
function _timeToMins(timeText) {
  const t = parseTimeText(timeText);
  if (!t) return null;
  return t.hours * 60 + t.minutes;
}

// Convert minutes from midnight back to "h:mm AM" / "h:mm PM".
function _minsToTime(mins) {
  const h24  = Math.floor(mins / 60);
  const min  = mins % 60;
  const ampm = h24 < 12 ? "AM" : "PM";
  const h12  = h24 % 12 || 12;
  return `${h12}:${String(min).padStart(2, "0")} ${ampm}`;
}

// Parse "M/D/YYYY" out of a full dateText (e.g. "Wednesday, 8/26/2026").
// Returns "MMDDYYYY" compact key, or null on failure.
function _dateKey(dateText) {
  const dp = parseDateText(dateText); // returns { month0, day, year }
  if (!dp) return null;
  const m = String(dp.month0 + 1).padStart(2, "0");
  const d = String(dp.day).padStart(2, "0");
  const y = String(dp.year);
  return m + d + y;
}

// Reconstruct a dateText string from a MMDDYYYY key.
// Returns "Weekday, M/D/YYYY" style (weekday is recomputed from the date).
// Uses UTC noon to avoid timezone-driven off-by-one-day errors.
function _dateKeyToText(key) {
  const month0 = parseInt(key.slice(0, 2), 10) - 1;
  const day    = parseInt(key.slice(2, 4), 10);
  const year   = parseInt(key.slice(4),    10);
  // Noon UTC avoids DST / timezone shifts that would change the date.
  const d  = new Date(Date.UTC(year, month0, day, 12, 0, 0));
  const wd = d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
  return `${wd}, ${month0 + 1}/${day}/${year}`;
}

/**
 * encodeSchedule(segments) → compact string (V1 format)
 *
 * segments: array of { dateText, startTimeText, label, priority, backgroundColor, textColor }
 * Returns a compact ASCII string suitable for QR encoding.
 */
function encodeSchedule(segments) {
  if (!segments || segments.length === 0) return "V1||";

  // ── 1. Sort chronologically ────────────────────────────────────────────────
  const sorted = [...segments].sort(compareSegments);

  // ── 2. Build label dictionary (order of first appearance) ─────────────────
  const labelToId = new Map();
  const idToEntry = []; // { id, label, priority, backgroundColor, textColor }
  for (const seg of sorted) {
    if (!labelToId.has(seg.label)) {
      const id = _qrId(labelToId.size);
      labelToId.set(seg.label, id);
      idToEntry.push({
        id,
        label:           seg.label,
        priority:        seg.priority        || "",
        backgroundColor: seg.backgroundColor || "",
        textColor:       seg.textColor       || ""
      });
    }
  }

  // ── 3. Encode dictionary ───────────────────────────────────────────────────
  // Format: <id>=<escapedLabel>,<id>=<escapedLabel>,...
  // Colors/priority are NOT stored — they are re-derived from the label on decode
  // (the popup's dotClassForLabel already does this, and the viewer does the same).
  const dictStr = idToEntry
    .map(e => `${e.id}=${_escLabel(e.label)}`)
    .join(",");

  // ── 4. Group alarms by day key ─────────────────────────────────────────────
  const dayMap = new Map(); // MMDDYYYY → sorted list of { mins, id }
  for (const seg of sorted) {
    const key  = _dateKey(seg.dateText);
    if (!key) continue;
    const mins = _timeToMins(seg.startTimeText);
    if (mins === null) continue;
    const id   = labelToId.get(seg.label);
    if (!dayMap.has(key)) dayMap.set(key, []);
    dayMap.get(key).push({ mins, id });
  }

  // ── 5. Encode each day with delta times ───────────────────────────────────
  // Day block: MMDDYYYY:<base36delta><id>;<base36delta><id>;...
  const dayParts = [];
  for (const [dateKey, alarms] of dayMap) {
    // Alarms are already sorted (we sorted segments globally above)
    let prev = 0;
    const alarmStrs = alarms.map(({ mins, id }, i) => {
      const delta = i === 0 ? mins : mins - prev;
      prev = mins;
      return delta.toString(36) + id;   // e.g. "1e0" = delta 1e(base36=66 mins), label "0"
    });
    dayParts.push(dateKey + ":" + alarmStrs.join(";"));
  }

  return "V1|" + dictStr + "|" + dayParts.join("|");
}

/**
 * decodeSchedule(encoded) → segments array
 *
 * Inverse of encodeSchedule(). Returns an array of segment objects with the
 * same shape as those produced by content.js (dateText, startTimeText, label,
 * priority, backgroundColor, textColor).
 *
 * Colors and priority are re-derived from the label using the same heuristics
 * the rest of the application uses (dotClassForLabel / getPriority).
 */
function decodeSchedule(encoded) {
  if (!encoded || !encoded.startsWith("V1|")) return [];

  // Strip "V1|" prefix, then split into dict block + day blocks
  const body     = encoded.slice(3);
  const pipeIdx  = body.indexOf("|");
  if (pipeIdx === -1) return [];

  const dictStr  = body.slice(0, pipeIdx);
  const daysStr  = body.slice(pipeIdx + 1);

  // ── Parse dictionary ───────────────────────────────────────────────────────
  const idToLabel = new Map();
  if (dictStr) {
    // Each entry is <id>=<escapedLabel>. IDs are 1 or 2 chars; we split on ","
    // but must not split inside escaped sequences — fortunately "," inside a
    // label is escaped to "~2", so a literal "," is always a separator.
    for (const entry of dictStr.split(",")) {
      const eqIdx = entry.indexOf("=");
      if (eqIdx === -1) continue;
      const id    = entry.slice(0, eqIdx);
      const label = _unescLabel(entry.slice(eqIdx + 1));
      idToLabel.set(id, label);
    }
  }

  // ── Parse day blocks ───────────────────────────────────────────────────────
  const segments = [];
  if (!daysStr) return segments;

  for (const dayBlock of daysStr.split("|")) {
    const colonIdx = dayBlock.indexOf(":");
    if (colonIdx === -1) continue;

    const dateKey  = dayBlock.slice(0, colonIdx);
    const dateText = _dateKeyToText(dateKey);
    const alarmsRaw = dayBlock.slice(colonIdx + 1);
    if (!alarmsRaw) continue;

    // IDs use only uppercase A-Z (never present in a base36 delta).
    // The first uppercase letter in each entry unambiguously marks
    // where the numeric delta ends and the label ID begins.
    let prev = 0;
    for (const entry of alarmsRaw.split(";")) {
      if (!entry) continue;
      const splitIdx = entry.search(/[A-Z]/);
      if (splitIdx <= 0) continue;            // missing delta or ID
      const deltaStr     = entry.slice(0, splitIdx);
      const idStr        = entry.slice(splitIdx);   // 1 or 2 uppercase chars
      const delta        = parseInt(deltaStr, 36);
      const absoluteMins = prev + delta;
      prev               = absoluteMins;

      const label = idToLabel.get(idStr);
      if (!label) continue;

      const timeText = _minsToTime(absoluteMins);
      const priority = _decodePriority(label);

      segments.push({
        dateText,
        startTimeText: timeText,
        label,
        priority,
        backgroundColor: "",
        textColor:       ""
      });
    }
  }

  return segments;
}

// Re-derive priority from label (mirrors content.js getPriority logic).
function _decodePriority(label) {
  const l = label.toLowerCase();
  return (l.includes("break") || l.includes("lunch") ||
          l.includes("meeting") || l.includes("training"))
    ? "priority" : "other";
}

// ── QR rendering helpers ─────────────────────────────────────────────────────

// QR capacity at error correction M (good balance of density vs reliability).
// Compact string (~344 chars) needs only version 14-M → 73×73 modules → crisp.
const QR_MAX_BYTES = 2331;  // version 40-M; compact strings are far below this
// HTML-escape helper.
function _htmlEsc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Draw a string onto canvas as a QR code (error correction M — reliable on screens).
function drawQrOnCanvas(canvas, text) {
  qrcode.stringToBytes = qrcode.stringToBytesFuncs["UTF-8"];

  const qr = qrcode(0, "M");   // M = good error correction, still plenty of capacity
  qr.addData(text, "Byte");
  qr.make();

  const moduleCount = qr.getModuleCount();
  const QUIET = 4;
  const total = moduleCount + QUIET * 2;
  // Use at least 3px per module for reliable phone scanning.
  // The card is 280px wide minus 40px padding = 240px usable; 3px × (73+8) = 243px for v14.
  const CELL  = Math.max(3, Math.floor(240 / total));

  canvas.width  = total * CELL;
  canvas.height = total * CELL;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000000";
  for (let r = 0; r < moduleCount; r++) {
    for (let c = 0; c < moduleCount; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect((c + QUIET) * CELL, (r + QUIET) * CELL, CELL, CELL);
      }
    }
  }
}

// Update hint text and download link.
function updateQrMeta(payload, isUrl, isOverCapacity) {
  const hint     = document.getElementById("qr-hint");
  const download = document.getElementById("qr-download");

  if (hint) {
    if (isOverCapacity) {
      hint.textContent = `Too large for QR (${payload.length} / ${QR_MAX_BYTES} chars). Remove some alarms.`;
      hint.style.color = "var(--warning, #f59e0b)";
    } else if (isUrl) {
      hint.textContent = "Scan to open your schedule →";
      hint.style.color = "";
    } else {
      hint.textContent = `${payload.length} chars · Scan with any QR app`;
      hint.style.color = "";
    }
  }

  if (download) {
    if (isOverCapacity) {
      download.removeAttribute("href");
      download.style.opacity = "0.4";
      download.style.pointerEvents = "none";
    } else {
      requestAnimationFrame(() => {
        const c = document.getElementById("qr-canvas");
        if (c) download.href = c.toDataURL("image/png");
      });
      download.style.opacity = "";
      download.style.pointerEvents = "";
    }
  }
}

// Render an error message onto the canvas.
function showQrError(canvas, message) {
  canvas.width  = 240;
  canvas.height = 240;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f7f8fa";
  ctx.fillRect(0, 0, 240, 240);
  ctx.fillStyle = "#ef4444";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const words = message.split(" ");
  let line = "", lines = [];
  for (const w of words) {
    if ((line + w).length > 26) { lines.push(line.trim()); line = ""; }
    line += w + " ";
  }
  lines.push(line.trim());
  const lineH = 18;
  const startY = 120 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, 120, startY + i * lineH));
}

// Open (or refresh) the QR overlay.
function openQrOverlay() {
  const overlay = document.getElementById("qr-overlay");
  const canvas  = document.getElementById("qr-canvas");
  if (!overlay || !canvas) return;

  overlay.hidden = false;

  const payload        = encodeSchedule(_currentSegments);
  const isOverCapacity = payload.length > QR_MAX_BYTES;

  if (isOverCapacity) {
    showQrError(canvas, `Payload too large (${payload.length} / ${QR_MAX_BYTES} chars). Remove some alarms.`);
  } else {
    try {
      drawQrOnCanvas(canvas, payload);
    } catch (err) {
      console.error("[alvaria-alerts] QR draw failed", err);
      showQrError(canvas, "QR generation failed");
    }
  }

  updateQrMeta(payload, false, isOverCapacity);
}

function closeQrOverlay() {
  const overlay = document.getElementById("qr-overlay");
  if (overlay) overlay.hidden = true;
}

// Re-render the QR whenever segment data changes and the overlay is open.
function refreshQrIfVisible() {
  const overlay = document.getElementById("qr-overlay");
  if (overlay && !overlay.hidden) openQrOverlay();
}

const qrBtn = document.getElementById("qr-btn");
if (qrBtn) qrBtn.addEventListener("click", openQrOverlay);

const qrClose = document.getElementById("qr-close");
if (qrClose) qrClose.addEventListener("click", closeQrOverlay);

const qrOverlay = document.getElementById("qr-overlay");
if (qrOverlay) {
  qrOverlay.addEventListener("click", (e) => {
    if (e.target === qrOverlay) closeQrOverlay();
  });
}

// ── esc helper (retained for any legacy callers) ──────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

