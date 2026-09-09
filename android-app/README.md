# Building the Android APK

The APK is built automatically in the cloud using **GitHub Actions** — no Android SDK or Java installation required on your machine.

---

## How to get the APK

### Step 1 — Push to GitHub

If you haven't already, push this repo to GitHub:

```bash
git add .
git commit -m "Add Android APK build"
git push origin main
```

### Step 2 — Watch the build

1. Open your repo on **github.com**
2. Click the **Actions** tab
3. You will see a workflow called **"Build Android APK"** running
4. The build takes about **3–5 minutes**

### Step 3 — Download the APK

1. Click on the completed workflow run
2. Scroll to the bottom of the page to the **Artifacts** section
3. Click **`alvaria-alarms-debug`** to download a `.zip` file
4. Unzip it — inside is **`app-debug.apk`**

### Step 4 — Install on your Android phone

1. Transfer `app-debug.apk` to your phone (email, Google Drive, USB, etc.)
2. On your phone, go to **Settings → Security → Install unknown apps** and allow your file manager or browser
3. Tap the APK file to install it
4. Open **Alvaria Alarms** from your app drawer

---

## What the APK contains

| File | Purpose |
|------|---------|
| `www/index.html` | The full alarm app (Dashboard, Schedule, Alarms, Settings) |
| `www/jsqr.min.js` | QR code scanner library — bundled locally, works offline |
| `www/sw.js` | Service worker for offline caching |
| `www/manifest.webmanifest` | PWA manifest |
| `www/icon-128.png` | App icon |

The app uses **Capacitor** to wrap the web app in a native Android WebView.  
Camera access for QR scanning uses the device's real camera via the WebView.

---

## Triggering the build manually

You can trigger a new APK build at any time without pushing:

1. Go to your repo → **Actions** tab
2. Click **"Build Android APK"** in the left sidebar
3. Click **"Run workflow"** → **"Run workflow"**

---

## Project structure

```
android-app/
  capacitor.config.json   ← app ID, name, web dir
  package.json            ← Capacitor dependencies
  package-lock.json       ← locked dependency versions
  www/
    index.html            ← the alarm app
    jsqr.min.js           ← QR scanner (local)
    sw.js                 ← service worker
    manifest.webmanifest  ← PWA manifest
    icon-128.png          ← app icon

.github/
  workflows/
    build-apk.yml         ← GitHub Actions CI build
```
