const STORAGE_KEY = "scheduledSegments";
const PARSED_KEY = "parsedSegments";
const MANUAL_KEY = "manualSegments";
const ALARM_PREFIX = "segment:";

function normalizeDateText(dateText) {
  const parts = dateText.split(",");
  return parts.length > 1 ? parts.slice(1).join(",").trim() : dateText.trim();
}

// Parse a time string of the form "h:mm AM" or "h:mm PM" (Alvaria format).
// Returns { hours24, minutes } or null if the string is not recognised.
function parseTimeText(timeText) {
  const match = timeText.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  const period = match[3].toUpperCase();
  if (period === "AM") {
    if (hours === 12) hours = 0;          // 12:xx AM → 0 hours
  } else {
    if (hours !== 12) hours += 12;        // 1–11 PM → 13–23; 12 PM stays 12
  }
  return { hours, minutes };
}

// Parse a date string of the form "M/D/YYYY" (after weekday prefix is stripped).
// Returns { year, month0, day } or null.
function parseDateText(dateText) {
  const normalized = normalizeDateText(dateText);
  const match = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return null;
  return {
    month0: parseInt(match[1], 10) - 1,  // 0-based month for Date constructor
    day: parseInt(match[2], 10),
    year: parseInt(match[3], 10)
  };
}

function toTimestamp(dateText, timeText) {
  const dateParts = parseDateText(dateText);
  const timeParts = parseTimeText(timeText);
  if (!dateParts || !timeParts) return null;
  const d = new Date(dateParts.year, dateParts.month0, dateParts.day, timeParts.hours, timeParts.minutes, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function buildAlarmName(segment) {
  return `${ALARM_PREFIX}${segment.key}`;
}

function buildSegmentKey(segment) {
  return `${segment.dateText}|${segment.startTimeText}|${segment.label}`;
}

function toScheduledSegment(segment) {
  const when = toTimestamp(segment.dateText, segment.startTimeText);

  if (!when || when <= Date.now()) {
    return null;
  }

  return {
    ...segment,
    key: buildSegmentKey(segment),
    when
  };
}

async function getStoredSegments() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || [];
}

async function setStoredSegments(segments) {
  await chrome.storage.local.set({ [STORAGE_KEY]: segments });
}

async function clearScheduledAlarms() {
  const alarms = await chrome.alarms.getAll();
  const segmentAlarms = alarms.filter((alarm) => alarm.name.startsWith(ALARM_PREFIX));
  await Promise.all(segmentAlarms.map((alarm) => chrome.alarms.clear(alarm.name)));
}

async function scheduleSegments(combined) {
  const scheduledSegments = combined
    .map(toScheduledSegment)
    .filter(Boolean)
    .sort((left, right) => left.when - right.when);

  await clearScheduledAlarms();
  await setStoredSegments(scheduledSegments);

  await Promise.all(
    scheduledSegments.map((segment) =>
      chrome.alarms.create(buildAlarmName(segment), { when: segment.when })
    )
  );

  return scheduledSegments;
}

async function getFullState() {
  const stored = await chrome.storage.local.get([STORAGE_KEY, PARSED_KEY, MANUAL_KEY]);
  return {
    parsedSegments: stored[PARSED_KEY] || [],
    manualSegments: stored[MANUAL_KEY] || [],
    scheduledSegments: stored[STORAGE_KEY] || []
  };
}

async function openAlertPage(segment) {
  const params = new URLSearchParams({
    label: segment.label,
    date: segment.dateText,
    time: segment.startTimeText
  });

  await chrome.windows.create({
    url: `${chrome.runtime.getURL("alert.html")}?${params.toString()}`,
    type: "popup",
    width: 460,
    height: 360,
    focused: true
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith(ALARM_PREFIX)) {
    return;
  }

  const segments = await getStoredSegments();
  const segment = segments.find((item) => buildAlarmName(item) === alarm.name);

  if (!segment) {
    return;
  }

  // Remove fired segment from storage so it no longer appears as upcoming.
  await setStoredSegments(segments.filter((item) => buildAlarmName(item) !== alarm.name));

  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon-128.png"),
      title: "Alvaria segment alert",
      message: `${segment.label} starts now (${segment.startTimeText})`
    });
  } catch (error) {
    console.error("[alvaria-alerts] notification failed", error);
  }

  try {
    await openAlertPage(segment);
  } catch (error) {
    console.error("[alvaria-alerts] alert page failed", error);
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SEGMENTS_PARSED") {
    (async () => {
      try {
        await chrome.storage.local.set({ [PARSED_KEY]: message.segments });
        const stored = await chrome.storage.local.get(MANUAL_KEY);
        const manualSegments = stored[MANUAL_KEY] || [];
        await scheduleSegments([...message.segments, ...manualSegments]);
      } catch (error) {
        console.error("[alvaria-alerts] failed to schedule segments", error);
      }
    })();
    return false;
  }

  if (message.type === "GET_SEGMENTS") {
    getFullState().then((state) => sendResponse(state)).catch(() => sendResponse(null));
    return true;
  }

  if (message.type === "REFRESH_SEGMENTS") {
    (async () => {
      try {
        // Find the Alvaria dashboard tab and ask the content script to re-parse.
        const tabs = await chrome.tabs.query({ url: "https://kroger.hosted.aspect-cloud.net/WFO/default/Home/Dashboard*" });
        if (tabs.length > 0) {
          chrome.tabs.sendMessage(tabs[0].id, { type: "TRIGGER_PARSE" }).catch(() => {
            // Tab exists but content script not ready — ignore.
          });
        }
        // Return current state immediately; the popup will re-fetch after the
        // content script fires SEGMENTS_PARSED on its own cycle.
        const state = await getFullState();
        sendResponse({ ok: true, ...state });
      } catch (error) {
        console.error("[alvaria-alerts] refresh failed", error);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message.type === "ADD_MANUAL_SEGMENT") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get([PARSED_KEY, MANUAL_KEY]);
        const parsedSegments = stored[PARSED_KEY] || [];
        const manualSegments = stored[MANUAL_KEY] || [];
        const updated = [...manualSegments, message.segment];
        await chrome.storage.local.set({ [MANUAL_KEY]: updated });
        const scheduledSegments = await scheduleSegments([...parsedSegments, ...updated]);
        sendResponse({ ok: true, parsedSegments, manualSegments: updated, scheduledSegments });
      } catch (error) {
        console.error("[alvaria-alerts] failed to add manual segment", error);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message.type === "SNOOZE_SEGMENT_ALERT") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get([PARSED_KEY, MANUAL_KEY]);
        const parsedSegments = stored[PARSED_KEY] || [];
        const manualSegments = stored[MANUAL_KEY] || [];
        const snoozedTime = new Date(Date.now() + 5 * 60 * 1000);
        const snoozedSegment = {
          ...message.segment,
          dateText: `${snoozedTime.toLocaleDateString("en-US", { weekday: "long" })}, ${snoozedTime.getMonth() + 1}/${snoozedTime.getDate()}/${snoozedTime.getFullYear()}`,
          startTimeText: snoozedTime.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        };
        const updated = [...manualSegments, snoozedSegment];
        await chrome.storage.local.set({ [MANUAL_KEY]: updated });
        await scheduleSegments([...parsedSegments, ...updated]);
        sendResponse({ ok: true });
      } catch (error) {
        console.error("[alvaria-alerts] failed to snooze segment", error);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  if (message.type === "DELETE_MANUAL_SEGMENT") {
    (async () => {
      try {
        const stored = await chrome.storage.local.get([PARSED_KEY, MANUAL_KEY]);
        const parsedSegments = stored[PARSED_KEY] || [];
        const manualSegments = stored[MANUAL_KEY] || [];
        const keyToDelete = buildSegmentKey(message.segment);
        const updated = manualSegments.filter(
          (s) => buildSegmentKey(s) !== keyToDelete
        );
        await chrome.storage.local.set({ [MANUAL_KEY]: updated });
        const scheduledSegments = await scheduleSegments([...parsedSegments, ...updated]);
        sendResponse({ ok: true, parsedSegments, manualSegments: updated, scheduledSegments });
      } catch (error) {
        console.error("[alvaria-alerts] failed to delete manual segment", error);
        sendResponse({ ok: false });
      }
    })();
    return true;
  }

  return false;
});
