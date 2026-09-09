# Alvaria segment alerts plan

## Top-Level Overview
Create a minimal Chrome extension that runs on the live Alvaria dashboard at [`https://kroger.hosted.aspect-cloud.net/WFO/default/Home/Dashboard`](https://kroger.hosted.aspect-cloud.net/WFO/default/Home/Dashboard), reads schedule segments from the Schedule Resolution widget, and creates alerts exactly at each segment start time using the segment label as the notification text. Alerting should prioritize `Break`, `Lunch`, `Meeting`, and `Training`, while keeping other non-`Free` labels in scope if they appear on the live page. The saved sample page confirms the DOM pattern to target: the widget container in [`resolutionWidget`](Workforce%20Engagement%20Management.html:1061), day headers in [`se-widget-dayheader`](Workforce%20Engagement%20Management.html:1066), segment lists in [`resolutionWidget-state-list`](Workforce%20Engagement%20Management.html:1150), start times in [`resolutionWidget-state-time`](Workforce%20Engagement%20Management.html:1158), and labels rendered from [`stateSpanCodeTemplate`](Workforce%20Engagement%20Management.html:1164). The extension should rely on the user’s authenticated browser session on the live page rather than attempting login itself. Public API research is explicitly deferred until implementation, with DOM parsing as the default approach.

## Sub-Tasks

### 1. Create the minimal extension scaffold
- **Intent** — Establish the smallest Chrome extension structure needed to run on the authenticated Alvaria page and support page parsing plus notifications.
- **Expected Outcomes** — A new extension exists with a manifest, a content script for page parsing, and a background service worker for notification scheduling.
- **Todo List**
  1. Add a Manifest V3 file with permissions only for Alvaria page access, alarms, notifications, and storage.
  2. Register a content script for the Alvaria dashboard URL so it runs after the authenticated page loads.
  3. Register a background service worker to own alarms and notifications.
  4. Keep the initial scaffold minimal unless implementation proves a popup or options page is required.
- **Relevant Context** — Live target URL is [`https://kroger.hosted.aspect-cloud.net/WFO/default/Home/Dashboard`](https://kroger.hosted.aspect-cloud.net/WFO/default/Home/Dashboard); current workspace has only the sample page [`Workforce Engagement Management.html`](Workforce%20Engagement%20Management.html).
- **Status** — [ ] pending

### 2. Parse schedule segments from the live Schedule Resolution widget
- **Intent** — Reuse the DOM structure proven by the sample HTML to extract each segment’s day, start time, and label from the live authenticated page.
- **Expected Outcomes** — The content script can detect the Schedule Resolution widget when it appears and produce a normalized list of segment records from the current schedule.
- **Todo List**
  1. Target the Schedule Resolution widget rooted in [`resolutionWidget`](Workforce%20Engagement%20Management.html:1061).
  2. Read each day header from [`se-widget-dayheader`](Workforce%20Engagement%20Management.html:1066).
  3. Read each segment row from [`resolutionWidget-state-list`](Workforce%20Engagement%20Management.html:1150).
  4. Extract the segment start time from [`resolutionWidget-state-time`](Workforce%20Engagement%20Management.html:1158).
  5. Extract the segment label from the rendered code span based on [`stateSpanCodeTemplate`](Workforce%20Engagement%20Management.html:1164).
  6. Exclude default all-day `Free` states from alerting.
  7. Prioritize alerts for `Break`, `Lunch`, `Meeting`, and `Training`, while keeping other non-`Free` labels available if present on the live page.
  8. Add page observation so the parser reruns when Alvaria updates the widget dynamically after login or navigation.
- **Relevant Context** — Sample DOM evidence in [`Workforce Engagement Management.html`](Workforce%20Engagement%20Management.html:1061-1570).
- **Status** — [ ] pending

### 3. Convert parsed segments into exact-time alert schedules
- **Intent** — Turn parsed day and time values into future timestamps that can drive Chrome alarms without duplicating or firing past alerts.
- **Expected Outcomes** — Each upcoming segment start becomes one scheduled alarm keyed to the segment’s identity and time.
- **Todo List**
  1. Normalize each parsed segment into a consistent structure with date, time, label, and a stable unique key.
  2. Convert the displayed Alvaria day header and start time text into local `Date` values.
  3. Filter out segment start times that are already in the past.
  4. Replace prior alarms when the schedule changes so the extension stays aligned with the current live page.
  5. Persist the latest parsed segment snapshot only as needed to coordinate content and background scripts.
- **Relevant Context** — Start time text examples are visible in [`Workforce Engagement Management.html`](Workforce%20Engagement%20Management.html:1159-1563); alert rule is exactly at segment start time with label text from the segment span, excluding `Free` and prioritizing `Break`, `Lunch`, `Meeting`, and `Training`.
- **Status** — [ ] pending

### 4. Fire notifications at segment start times
- **Intent** — Deliver the user-visible alert when a scheduled segment begins, using the segment label as the notification text.
- **Expected Outcomes** — Chrome notifications appear at the exact segment start time for each upcoming segment.
- **Todo List**
  1. Handle Chrome alarm events in the background service worker.
  2. Create a notification whose message includes the segment label and, if needed for clarity, the scheduled time.
  3. Ensure alarm payload lookup is robust enough to map each alarm back to the correct segment.
  4. Keep notification behavior minimal and aligned with the user requirement; avoid extra snooze or customization features unless later requested.
- **Relevant Context** — User requirement is exact-time alerts using the segment label as notification text; browser session login is handled manually on the live Alvaria site; `Free` should not alert, and `Break`, `Lunch`, `Meeting`, and `Training` are the first labels to support.
- **Status** — [ ] pending

### 5. Validate against the sample page and document live-use constraints
- **Intent** — Verify the parser against the provided saved HTML and document the key runtime dependency: the user must already be logged into Alvaria for the content script to read the live dashboard.
- **Expected Outcomes** — The implementation is testable against the sample HTML structure and the extension usage steps are clear for the live site.
- **Todo List**
  1. Validate that the parser selectors work against the saved sample structure in [`Workforce Engagement Management.html`](Workforce%20Engagement%20Management.html:1061-1570).
  2. Confirm the extension only attempts to read page content after the live dashboard is available to the authenticated user session.
  3. Add short usage notes describing that login is performed by the user in Chrome and the extension reads the resulting live DOM.
  4. Defer any public Alvaria API investigation until implementation, with DOM parsing remaining the baseline unless documented APIs prove clearly better.
  5. Run the relevant extension validation available for the created files.
- **Relevant Context** — The target page requires login, but the extension can still run on the live URL once the user has authenticated in the browser.
- **Status** — [ ] pending
