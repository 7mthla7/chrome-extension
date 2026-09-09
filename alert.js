const params = new URLSearchParams(window.location.search);
const label = params.get("label") || "Segment alert";
const dateText = params.get("date") || "";
const timeText = params.get("time") || "";

const labelElement = document.getElementById("alert-label");
const timeElement = document.getElementById("alert-time");
const dateElement = document.getElementById("alert-date");
const dismissButton = document.getElementById("dismiss-button");
const snoozeButton = document.getElementById("snooze-button");
const audio = document.getElementById("alert-audio");
const countdownLabel = document.getElementById("auto-close-label");

let repeatTimer = null;
let autoCloseTimer = null;
let countdownTimer = null;

if (labelElement) {
  labelElement.textContent = label;
}

if (timeElement) {
  timeElement.textContent = timeText ? `Due now at ${timeText}` : "Due now";
}

if (dateElement) {
  dateElement.textContent = dateText;
}

function setButtonsDisabled(disabled) {
  if (dismissButton) {
    dismissButton.disabled = disabled;
  }

  if (snoozeButton) {
    snoozeButton.disabled = disabled;
  }
}

function stopTimers() {
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
  }

  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }

  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function safeSendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime?.lastError) {
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

async function playAudio() {
  if (!audio) {
    return;
  }

  try {
    audio.currentTime = 0;
    await audio.play();
  } catch (error) {
    console.error("[alvaria-alerts] alert page audio failed", error);
  }
}

function startRepeatingAudio() {
  playAudio();
  repeatTimer = window.setInterval(() => {
    playAudio();
  }, 15000);
}

function startAutoClose() {
  let secondsLeft = 60;

  function tick() {
    if (countdownLabel) {
      countdownLabel.textContent = `Auto-closes in ${secondsLeft}s`;
    }
    secondsLeft -= 1;
    if (secondsLeft < 0) {
      stopTimers();
      window.close();
    }
  }

  tick();
  countdownTimer = window.setInterval(tick, 1000);
}

if (dismissButton) {
  dismissButton.addEventListener("click", () => {
    stopTimers();
    window.close();
  });
}

if (snoozeButton) {
  snoozeButton.addEventListener("click", async () => {
    setButtonsDisabled(true);

    const response = await safeSendMessage({
      type: "SNOOZE_SEGMENT_ALERT",
      segment: {
        dateText,
        startTimeText: timeText,
        label,
        priority: "snoozed"
      }
    });

    if (response && response.ok) {
      stopTimers();
      window.close();
      return;
    }

    setButtonsDisabled(false);
    console.warn("[alvaria-alerts] snooze failed");
  });
}

startRepeatingAudio();
startAutoClose();
