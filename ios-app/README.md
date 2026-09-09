# Building the iOS IPA

The IPA is built automatically in the cloud using **GitHub Actions** on a macOS runner — no Xcode or Mac required on your machine.

> **Note:** iOS apps must be signed before they can be installed on a real device. The CI build produces an **unsigned** IPA suitable for testing via [AltStore](https://altstore.io/) or a development build signed with your own Apple Developer certificate. Distribution on the App Store requires a paid Apple Developer account.

---

## How to get the IPA

### Step 1 — Push to GitHub

If you haven't already, push this repo to GitHub:

```bash
git add .
git commit -m "Add iOS IPA build"
git push origin main
```

### Step 2 — Watch the build

1. Open your repo on **github.com**
2. Click the **Actions** tab
3. You will see a workflow called **"Build iOS IPA"** running
4. The build takes about **10–15 minutes** (macOS runners are slower to provision)

### Step 3 — Download the IPA

1. Click on the completed workflow run
2. Scroll to the bottom of the page to the **Artifacts** section
3. Click **`alarm-ios`** to download a `.zip` file
4. Unzip it — inside is **`App.ipa`**

### Step 4 — Install on your iPhone (via AltStore — no Mac needed)

1. Install **AltStore** on your iPhone by following the guide at [altstore.io](https://altstore.io/)
2. Open AltStore on your iPhone → tap **My Apps** → tap **+**
3. Pick the downloaded `App.ipa` file
4. AltStore signs and installs the app using your personal Apple ID (free, no paid account required)
5. Open **Alarm** from your home screen

> **Tip:** AltStore-installed apps expire after 7 days unless refreshed. Open AltStore and tap **Refresh All** to renew. Apps signed with a paid Apple Developer account (via Xcode or TestFlight) do not expire.

---

## Signing for distribution (optional)

To build a properly signed IPA for TestFlight or App Store submission, add the following secrets to your GitHub repository (**Settings → Secrets and variables → Actions**):

| Secret | Description |
|--------|-------------|
| `IOS_SIGNING_CERTIFICATE_P12_BASE64` | Base64-encoded `.p12` signing certificate |
| `IOS_SIGNING_CERTIFICATE_PASSWORD` | Password for the `.p12` file |
| `IOS_PROVISIONING_PROFILE_BASE64` | Base64-encoded `.mobileprovision` file |

Then update [`ExportOptions.plist`](ExportOptions.plist) to set `method` to `app-store` or `development` and add your `teamID` and `provisioningProfiles` entries.

---

## What the IPA contains

| File | Purpose |
|------|---------|
| `www/index.html` | The full alarm app (Dashboard, Schedule, Alarms, Settings) |
| `www/jsqr.min.js` | QR code scanner library — bundled locally, works offline |
| `www/sw.js` | Service worker for offline caching |
| `www/manifest.webmanifest` | PWA manifest |
| `www/icon-128.png` | App icon |

The app uses **Capacitor** to wrap the web app in a native iOS WKWebView.  
Camera access for QR scanning uses the device's real camera via the WebView.  
Local notifications are delivered natively through iOS's notification system.

---

## Triggering the build manually

You can trigger a new IPA build at any time without pushing:

1. Go to your repo → **Actions** tab
2. Click **"Build iOS IPA"** in the left sidebar
3. Click **"Run workflow"** → **"Run workflow"**

---

## Project structure

```
ios-app/
  capacitor.config.json   ← app ID, name, web dir, iOS settings
  package.json            ← Capacitor dependencies
  package-lock.json       ← locked dependency versions (generated on first build)
  ExportOptions.plist     ← xcodebuild export settings
  www/
    index.html            ← the alarm app
    jsqr.min.js           ← QR scanner (local)
    sw.js                 ← service worker
    manifest.webmanifest  ← PWA manifest
    icon-128.png          ← app icon

.github/
  workflows/
    build-ipa.yml         ← GitHub Actions CI build (macOS)
    build-apk.yml         ← GitHub Actions CI build (Android)
```

---

## Comparison: Android vs iOS

| | Android | iOS |
|---|---|---|
| Build runner | `ubuntu-latest` | `macos-latest` |
| Build tool | Gradle | Xcode |
| Output | `app-debug.apk` | `App.ipa` |
| Sideload tool | Enable "Install unknown apps" | AltStore / TestFlight |
| Build time | ~3–5 min | ~10–15 min |
| Signing required | No (debug APK) | Yes (self-sign via AltStore OK) |
