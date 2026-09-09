// parser-test.js — validates content.js parsing logic against test-page.html using jsdom
"use strict";

const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const html = fs.readFileSync(path.join(__dirname, "test-page.html"), "utf8");
const dom = new JSDOM(html);
const { document } = dom.window;

// ---- Inline the parsing logic from content.js ----
const ALERT_LABELS = new Set(["break", "lunch", "meeting", "training"]);

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
  if (!widget) return [];

  const days = widget.querySelectorAll(":scope > div > .resolutionWidget-list > li");
  const segments = [];

  for (const day of days) {
    const dayHeader = day.querySelector(".se-widget-dayheader span");
    const dateText = dayHeader ? dayHeader.textContent.trim() : "";
    if (!dateText) continue;

    const rows = day.querySelectorAll(".resolutionWidget-state-list > li");
    for (const row of rows) {
      const timeElement = row.querySelector(".resolutionWidget-state-time span");
      const codeElements = row.querySelectorAll(".resolutionWidget-state [role='presentation']");
      const labelElement = codeElements[codeElements.length - 1];
      const startTimeText = timeElement ? timeElement.textContent.trim() : "";
      const label = labelElement ? normalizeLabel(labelElement.textContent) : "";

      if (!startTimeText || !label || isFreeLabel(label)) continue;

      segments.push({ dateText, startTimeText, label, priority: getPriority(label) });
    }
  }

  return segments;
}

// ---- Run tests ----
let pass = 0;
let fail = 0;

function assert(description, condition) {
  if (condition) {
    console.log("  PASS:", description);
    pass++;
  } else {
    console.error("  FAIL:", description);
    fail++;
  }
}

const segments = parseSegments();
console.log("\nParsed segments:", JSON.stringify(segments, null, 2));

console.log("\n--- Assertions ---");
assert("widget found", segments !== null);
assert("Saturday Free-only day yields 0 segments", !segments.some(s => s.dateText === "Saturday, 8/15/2026"));
assert("Monday has 4 segments (Free rows excluded)", segments.filter(s => s.dateText === "Monday, 8/17/2026").length === 4);
assert("1:00 PM KSC O&D T1 is 'other'", segments.some(s => s.startTimeText === "1:00 PM" && s.label === "KSC O&D T1" && s.priority === "other"));
assert("3:10 PM Break is 'priority'", segments.some(s => s.startTimeText === "3:10 PM" && s.label === "Break" && s.priority === "priority"));
assert("5:30 PM Lunch is 'priority'", segments.some(s => s.startTimeText === "5:30 PM" && s.label === "Lunch" && s.priority === "priority"));
assert("6:00 PM Free is excluded", !segments.some(s => s.startTimeText === "6:00 PM"));
assert("Total segments = 4", segments.length === 4);

console.log(`\nResult: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
