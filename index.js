/**
 * index.js
 * Full working Group Name Locker with embedded neon UI
 * - appstate.json upload / paste support
 * - start / stop bot
 * - auto-load appstate.json if present
 * - uses fca-unofficial if available, otherwise ws3-fca
 * - robust logging and error handling
 *
 * NOTE: keep your original appstate.json private. This file expects
 *       to be run in Node (v20 recommended). Install dependencies via:
 *         npm install express multer body-parser fca-unofficial ws3-fca
 *
 * If hosting environment provides only one of the libs, great.
 */

const fs = require("fs");
const path = require("path");
const express = require("express");
const bodyParser = require("body-parser");
const multer = require("multer");

// try to load fca-unofficial first, fall back to ws3-fca if present
let loginLib = null;
try {
  loginLib = require("fca-unofficial");
  console.log("Using fca-unofficial for Facebook login API.");
} catch (e1) {
  try {
    loginLib = require("ws3-fca");
    console.log("Using ws3-fca for Facebook login API.");
  } catch (e2) {
    console.error("Neither 'fca-unofficial' nor 'ws3-fca' is installed. Please install one of them.");
    // do not exit immediately; server can still start but /start will fail
    loginLib = null;
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// multer setup for file uploads
const upload = multer({ dest: path.join(process.cwd(), "uploads") });

// middleware
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

// state
let api = null;
let botRunning = false;
let groupID = "";       // current group id from UI/start payload
let lockedName = "";    // current locked name from UI/start payload
let appState = null;    // parsed appstate json object
let internalLogs = [];  // small ring buffer of logs for UI polling
const MAX_LOG_LINES = 500;

// helper: push log (console + internal buffer)
function pushLog(line) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] ${line}`;
  console.log(msg);
  internalLogs.push(msg);
  if (internalLogs.length > MAX_LOG_LINES) internalLogs.shift();
}

// If appstate.json exists on disk at startup, load it (auto-login later)
const APPSTATE_PATH = path.join(process.cwd(), "appstate.json");
try {
  if (fs.existsSync(APPSTATE_PATH)) {
    const raw = fs.readFileSync(APPSTATE_PATH, "utf8");
    appState = JSON.parse(raw);
    pushLog("Found existing appstate.json on disk — loaded for auto login.");
    // attempt auto login in background (do not auto-start locker)
    attemptAutoLogin();
  } else {
    pushLog("No appstate.json found on disk. Use UI to upload or paste it.");
  }
} catch (e) {
  pushLog("Error reading appstate.json at startup: " + (e.message || e));
}

// Serve embedded full UI (neon animated gradient + controls)
app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Group Name Locker — Panel</title>
<link rel="icon" href="data:;base64,iVBORw0KGgo=">
<style>
  :root{
    --bg1:#021018; --accent1:#7df9d8; --accent2:#7b61ff; --card: rgba(255,255,255,0.03);
  }
  html,body{height:100%;margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial;}
  body{
    display:flex;align-items:center;justify-content:center;
    background:
      radial-gradient(800px 400px at 10% 10%, rgba(123,97,255,0.06), transparent 6%),
      radial-gradient(700px 350px at 90% 90%, rgba(125,249,216,0.04), transparent 6%),
      linear-gradient(180deg,var(--bg1), #02101a 80%);
    color:#e6f7f2;padding:30px;
  }
  .panel{
    width:100%;max-width:1100px;border-radius:14px;padding:18px;display:grid;grid-template-columns:1fr 420px;gap:18px;
    background: linear-gradient(180deg, rgba(255,255,255,0.01), rgba(255,255,255,0.005));
    box-shadow: 0 12px 48px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.02);
  }
  @media(max-width:980px){ .panel{grid-template-columns:1fr;padding:12px} }
  .left{padding:12px}
  .title{font-size:28px;font-weight:800;color:var(--accent1);text-shadow:0 6px 30px rgba(123,97,255,0.06)}
  .desc{color:#bfeee0;margin-top:8px}
  .big-card{margin-top:12px;background: linear-gradient(90deg, rgba(255,255,255,0.02), rgba(0,0,0,0.06));padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,0.02)}
  .neon{color:var(--accent1);font-weight:900;display:inline-block}
  .right{padding:12px;min-height:320px}
  label{display:block;margin:8px 0 6px;color:#bfeee0;font-size:13px}
  input[type="text"], textarea { width:100%; padding:10px;border-radius:8px;border:1px solid rgba(255,255,255,0.03); background: rgba(0,0,0,0.14); color:#e6f7f2; outline:none; font-size:14px; }
  .file-row{display:flex;gap:8px;align-items:center}
  .btn{padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-weight:700;background:linear-gradient(90deg,var(--accent1),var(--accent2));color:#001214}
  .btn.ghost{background:transparent;border:1px solid rgba(255,255,255,0.04);color:#bfeee0}
  .log{margin-top:12px;background:rgba(0,0,0,0.34);border-radius:10px;padding:10px;min-height:180px;max-height:420px;overflow:auto;font-family:ui-monospace,monospace;font-size:13px;color:#bfeee0;border:1px solid rgba(255,255,255,0.02)}
  .small{font-size:12px;color:#9bd6c8}
  .muted{color:#98d1c2}
</style>
</head>
<body>
  <div class="panel" role="main">
    <div class="left">
      <div class="title">YK TRICKS INDIA — Group Locker</div>
      <div class="desc">Upload your appstate.json (safe machine), set Group Thread ID & Locked Name, and start the bot. Works with fca-unofficial & ws3-fca.</div>

      <div class="big-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:800;color:var(--accent1)">Neon Locker Control</div>
            <div class="small" style="margin-top:6px">Auto-login if appstate.json exists. Use file upload or paste text below.</div>
          </div>
          <div class="muted">Server-side bot</div>
        </div>

        <div style="margin-top:12px">
          <label>Upload appstate.json</label>
          <div class="file-row">
            <input id="fileInput" type="file" accept=".json" />
            <button id="uploadBtn" class="btn ghost">Upload File</button>
          </div>
          <div class="small muted" style="margin-top:6px">Or paste entire JSON content and Save</div>
          <textarea id="appstateText" rows="6" placeholder='Paste appstate.json content here'></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button id="saveTextBtn" class="btn ghost">Save From Text</button>
            <button id="clearAppstateBtn" class="btn ghost">Delete Saved appstate</button>
          </div>
        </div>

      </div>

      <div style="margin-top:12px" class="big-card">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-weight:800">Instructions</div>
          <div class="small muted">Read carefully</div>
        </div>
        <ol style="color:#bfeee0;margin-top:8px">
          <li>Upload/paste your <code>appstate.json</code>.</li>
          <li>Enter Group Thread ID (the numeric id after /t/ in messages URL).</li>
          <li>Enter exact Locked Group Name (match spaces & emojis).</li>
          <li>Click Start — watch logs for activity.</li>
        </ol>
      </div>

    </div>

    <div class="right">
      <label>Group Thread ID</label>
      <input id="groupIdInput" type="text" placeholder="e.g. 24196335160017473" />

      <label>Locked Group Name</label>
      <input id="lockedNameInput" type="text" placeholder="Enter locked group name exactly" />

      <div style="display:flex;gap:8px;align-items:center;margin-top:10px">
        <button id="startBtn" class="btn">Start Bot</button>
        <button id="stopBtn" class="btn ghost">Stop Bot</button>
        <div style="margin-left:auto" class="small muted">Status: <span id="srvStatus">idle</span></div>
      </div>

      <div class="log" id="logBox">[system] Ready.</div>
    </div>
  </div>

<script>
  const fileInput = document.getElementById('fileInput');
  const uploadBtn = document.getElementById('uploadBtn');
  const appstateText = document.getElementById('appstateText');
  const saveTextBtn = document.getElementById('saveTextBtn');
  const clearAppstateBtn = document.getElementById('clearAppstateBtn');
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const groupIdInput = document.getElementById('groupIdInput');
  const lockedNameInput = document.getElementById('lockedNameInput');
  const logBox = document.getElementById('logBox');
  const srvStatus = document.getElementById('srvStatus');

  function log(msg){
    const at = new Date().toLocaleTimeString();
    logBox.innerText += '\\n[' + at + '] ' + msg;
    logBox.scrollTop = logBox.scrollHeight;
  }

  uploadBtn.addEventListener('click', async () => {
    if (!fileInput.files || fileInput.files.length === 0) { log('No file selected.'); return; }
    const file = fileInput.files[0];
    const fd = new FormData();
    fd.append('appstate', file);
    log('Uploading appstate.json...');
    try {
      const r = await fetch('/upload', { method: 'POST', body: fd });
      const j = await r.json();
      log(j.message || 'Upload done.');
      if (j.ok) srvStatus.innerText = 'appstate saved';
    } catch (e) {
      log('Upload failed: ' + (e.message || e));
    }
  });

  saveTextBtn.addEventListener('click', async () => {
    const text = appstateText.value.trim();
    if (!text) { log('No appstate text to save.'); return; }
    log('Saving appstate from text...');
    try {
      const r = await fetch('/save-text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ appstate: text }) });
      const j = await r.json();
      log(j.message || 'Saved from text.');
      if (j.ok) srvStatus.innerText = 'appstate saved';
    } catch (e) {
      log('Save failed: ' + (e.message || e));
    }
  });

  clearAppstateBtn.addEventListener('click', async () => {
    log('Deleting saved appstate.json on server...');
    try {
      const r = await fetch('/delete-appstate', { method: 'POST' });
      const j = await r.json();
      log(j.message || 'Deleted.');
      if (j.ok) srvStatus.innerText = 'no appstate';
    } catch (e) {
      log('Delete failed: ' + (e.message || e));
    }
  });

  startBtn.addEventListener('click', async () => {
    const gid = groupIdInput.value.trim();
    const locked = lockedNameInput.value.trim();
    if (!gid || !locked) { log('Please provide both Group ID and Locked Name.'); return; }
    log('Starting bot...');
    srvStatus.innerText = 'starting';
    try {
      const r = await fetch('/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ groupID: gid, lockedName: locked }) });
      const j = await r.json();
      log(j.message || 'Start response');
      if (j.ok) srvStatus.innerText = 'running';
    } catch (e) {
      log('Start failed: ' + (e.message || e));
      srvStatus.innerText = 'error';
    }
  });

  stopBtn.addEventListener('click', async () => {
    log('Stopping bot (will stop locker loop)...');
    try {
      const r = await fetch('/stop', { method: 'POST' });
      const j = await r.json();
      log(j.message || 'Stopped.');
      srvStatus.innerText = 'stopped';
    } catch (e) {
      log('Stop failed: ' + (e.message || e));
    }
  });

  // poll server logs (last lines)
  setInterval(async () => {
    try {
      const r = await fetch('/_status');
      if (!r.ok) return;
      const j = await r.json();
      if (j.logs && j.logs.length) {
        j.logs.forEach(l => log(l));
      }
    } catch (e) { /* ignore */ }
  }, 5000);
</script>
</body>
</html>`);
});

// Endpoint: upload appstate.json (file)
app.post("/upload", upload.single("appstate"), (req, res) => {
  try {
    if (!req.file) return res.json({ ok: false, message: "No file uploaded" });
    const tmp = req.file.path;
    const dest = APPSTATE_PATH;
    fs.copyFileSync(tmp, dest);
    fs.unlinkSync(tmp);
    const raw = fs.readFileSync(dest, "utf8");
    appState = JSON.parse(raw);
    pushLog("appstate.json uploaded and saved to disk.");
    return res.json({ ok: true, message: "appstate.json uploaded and saved." });
  } catch (e) {
    pushLog("Upload error: " + (e.message || e));
    return res.status(500).json({ ok: false, message: "Upload failed: " + (e.message || e) });
  }
});

// Endpoint: save appstate from pasted text
app.post("/save-text", (req, res) => {
  try {
    const raw = req.body.appstate;
    if (!raw) return res.json({ ok: false, message: "No appstate content provided" });
    // try parse
    const parsed = JSON.parse(raw);
    fs.writeFileSync(APPSTATE_PATH, JSON.stringify(parsed, null, 2), "utf8");
    appState = parsed;
    pushLog("appstate.json saved from pasted text.");
    return res.json({ ok: true, message: "appstate.json saved from text." });
  } catch (e) {
    pushLog("Save-text error: " + (e.message || e));
    return res.status(500).json({ ok: false, message: "Save failed: " + (e.message || e) });
  }
});

// Endpoint: delete saved appstate
app.post("/delete-appstate", (req, res) => {
  try {
    if (fs.existsSync(APPSTATE_PATH)) fs.unlinkSync(APPSTATE_PATH);
    appState = null;
    pushLog("Deleted appstate.json from disk.");
    return res.json({ ok: true, message: "Deleted appstate.json." });
  } catch (e) {
    pushLog("Delete appstate error: " + (e.message || e));
    return res.status(500).json({ ok: false, message: "Delete failed: " + (e.message || e) });
  }
});

// Endpoint: status/poll logs
app.get("/_status", (req, res) => {
  // return last 20 logs
  const last = internalLogs.slice(-20);
  res.json({ logs: last });
});

// Start Bot endpoint
app.post("/start", async (req, res) => {
  try {
    if (!appState) return res.json({ ok: false, message: "No appstate.json found. Upload or paste it first." });
    const body = req.body || {};
    groupID = String(body.groupID || "").trim();
    lockedName = String(body.lockedName || "").trim();
    if (!groupID || !lockedName) return res.json({ ok: false, message: "groupID and lockedName required." });

    if (!loginLib) {
      pushLog("Login library not available. Cannot start.");
      return res.json({ ok: false, message: "Login library not installed on server." });
    }

    if (botRunning) return res.json({ ok: true, message: "Bot already running." });

    pushLog("Attempting login using stored appstate...");
    // login API differences handled: both libs accept { appState } callback form
    loginLib({ appState }, (err, apiInstance) => {
      if (err) {
        pushLog("Login failed: " + (err && err.message ? err.message : err));
        return res.json({ ok: false, message: "Login failed: " + (err && err.message ? err.message : err) });
      }
      api = apiInstance;
      botRunning = true;
      pushLog("Login successful. Starting group name locker for thread: " + groupID);
      startGroupNameLocker(api);
      return res.json({ ok: true, message: "Bot started and logged in successfully." });
    });
  } catch (e) {
    pushLog("Start endpoint error: " + (e.message || e));
    return res.status(500).json({ ok: false, message: "Start failed: " + (e.message || e) });
  }
});

// Stop bot endpoint
app.post("/stop", (req, res) => {
  try {
    botRunning = false;
    pushLog("Bot locker loop requested to stop.");
    return res.json({ ok: true, message: "Bot stop requested." });
  } catch (e) {
    pushLog("Stop error: " + (e.message || e));
    return res.status(500).json({ ok: false, message: "Stop failed." });
  }
});

// Core locker logic — works with both fca-unofficial and ws3-fca APIs
function startGroupNameLocker(apiInstance) {
  // try to normalize api function names
  const getThreadInfo = apiInstance.getThreadInfo ? apiInstance.getThreadInfo.bind(apiInstance) : (id, cb) => apiInstance.getThreadInfo(id, cb);
  const setTitle = (title, threadID, cb) => {
    // some apis use setTitle(title, threadID, cb), others use setTitle(threadID, title, cb)
    try {
      if (apiInstance.setTitle.length === 3) {
        // try title, threadID, cb
        return apiInstance.setTitle(title, threadID, cb);
      } else {
        // fallback
        return apiInstance.setTitle(threadID, title, cb);
      }
    } catch (e) {
      try { return apiInstance.setTitle(threadID, title, cb); } catch (er) { return cb(er); }
    }
  };

  pushLog("Locker loop initialized. Monitoring thread: " + groupID);
  const loop = () => {
    if (!botRunning) {
      pushLog("Bot running flag false — locker loop stopped.");
      return;
    }
    try {
      // call getThreadInfo (callback-style)
      getThreadInfo(groupID, (err, info) => {
        if (err) {
          pushLog("Error fetching thread info: " + (err && err.message ? err.message : err));
        } else {
          // info may be object, ensure name exists
          const actualName = (info && (info.thread_name || info.name || info.title)) || null;
          if (!actualName) {
            pushLog("Could not read group name from thread info. Raw info: " + JSON.stringify(info));
          } else if (actualName !== lockedName) {
            pushLog('Detected name change: "' + actualName + '" → resetting to "' + lockedName + '"');
            // attempt reset with setTitle wrapper
            setTitle(lockedName, groupID, (err) => {
              if (err) pushLog("Failed to reset group name: " + (err && err.message ? err.message : err));
              else pushLog("Group name reset successfully.");
            });
          } else {
            // log lightly
            pushLog("Group name is correct: " + actualName);
          }
        }
      });
    } catch (e) {
      pushLog("Locker exception: " + (e && e.message ? e.message : e));
    }
    // schedule next run
    setTimeout(loop, 2000);
  };

  // start loop
  loop();
}

// auto-login helper (attempt only to prepare session; does not start locker)
function attemptAutoLogin() {
  if (!appState) return;
  if (!loginLib) { pushLog("No login library available for auto-login."); return; }
  try {
    pushLog("Attempting auto login using existing appstate...");
    loginLib({ appState }, (err, apiInstance) => {
      if (err) {
        pushLog("Auto login failed: " + (err && err.message ? err.message : err));
        return;
      }
      api = apiInstance;
      pushLog("Auto login success. You may now provide groupID & lockedName and click Start.");
      // do not auto-start locker for safety
    });
  } catch (e) {
    pushLog("Auto-login exception: " + (e && e.message ? e.message : e));
  }
}

// start server
app.listen(PORT, () => {
  console.log("Server running at http://localhost:" + PORT);
  pushLog("Server started on port " + PORT);
});
  
