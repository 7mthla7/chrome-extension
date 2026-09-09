// Content script — runs on the Alvaria WFO dashboard after page load.

const ALERT_LABELS = new Set(["break", "lunch", "meeting", "training"]);
let lastSignature = "";

function normalizeLabel(label) {
  return label.replace(/\s+/g, " ").trim();
}

function isFreeLabel(label) {
  return label.toLowerCase() === "free";
}

function getPriority(label) {
  return ALERT_LABELS.has(label.toLowerCase()) ? "priority" : "other";
}

function parseSegments() {
  const widget = document.querySelector(".resolutionWidget");

  if (!widget) {
    return [];
  }

  const days = widget.querySelectorAll(":scope > div > .resolutionWidget-list > li");
  const segments = [];

  for (const day of days) {
    const dayHeader = day.querySelector(".se-widget-dayheader span");
    const dateText = dayHeader ? dayHeader.textContent.trim() : "";

    if (!dateText) {
      continue;
    }

    const rows = day.querySelectorAll(".resolutionWidget-state-list > li");

    for (const row of rows) {
      const timeElement = row.querySelector(".resolutionWidget-state-time span");
      const codeElements = row.querySelectorAll(".resolutionWidget-state [role='presentation']");
      const labelElement = codeElements[codeElements.length - 1];
      const stateBlock = row.querySelector(".resolutionWidget-state > div:last-child");
      const startTimeText = timeElement ? timeElement.textContent.trim() : "";
      const rawLabel = labelElement ? normalizeLabel(labelElement.textContent) : "";
      const backgroundColor = stateBlock ? window.getComputedStyle(stateBlock).backgroundColor : "";
      const textColor = stateBlock ? window.getComputedStyle(stateBlock).color : "";

      if (!startTimeText || !rawLabel || isFreeLabel(rawLabel)) {
        continue;
      }

      segments.push({
        dateText,
        startTimeText,
        label: rawLabel,
        priority: getPriority(rawLabel),
        backgroundColor,
        textColor
      });
    }
  }

  return segments;
}

function safeSendMessage(message) {
  // In MV3, sendMessage() with no callback returns a Promise.
  // When the service worker is sleeping or the context is gone that Promise
  // rejects, producing an "Uncaught (in promise)" console error at every
  // MutationObserver tick. We must handle both the synchronous throw (context
  // already invalidated at call time) and the async rejection.
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      // Rejection is expected when the service worker is temporarily inactive.
      // Nothing to do — background.js will reschedule when it wakes.
    });
  } catch {
    // chrome.runtime.sendMessage itself threw synchronously, meaning the
    // extension context is fully invalidated (e.g. extension was reloaded).
    // No action needed; the observer will simply not deliver this update.
  }
}

function publishSegments() {
  const segments = parseSegments();
  const signature = JSON.stringify(segments);

  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;
  safeSendMessage({ type: "SEGMENTS_PARSED", segments });
}

function startObserver() {
  const observer = new MutationObserver(() => {
    publishSegments();
  });

  observer.observe(document.body, { childList: true, subtree: true });
}

// Allow the background to trigger a fresh parse on demand (e.g. popup refresh button).
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "TRIGGER_PARSE") {
    // Force re-publish by clearing the cached signature first.
    lastSignature = "";
    publishSegments();
  }
});

(function main() {
  console.log("[alvaria-alerts] content script injected on", location.href);
  publishSegments();
  startObserver();
})();
