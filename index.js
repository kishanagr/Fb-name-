const express = require('express');
const fs = require('fs');
const login = require('ws3-fca');

const app = express();
const PORT = process.env.PORT || 3000;

// appstate.json पढ़ना
let appState;
try {
  appState = JSON.parse(fs.readFileSync('appstate.json', 'utf-8'));
} catch (err) {
  console.error('❌ appstate.json पढ़ने में समस्या:', err);
  process.exit(1);
}

// स्थायी कॉन्फ़िगरेशन
const GROUP_THREAD_ID = '24196335160017473';
const LOCKED_GROUP_NAME = '🤪 EXIT FUNNY KIDX + TUSHAR BOKA CHUDKE DAFAN 😂';

// frontend html को एक स्ट्रिंग में रखें
const htmlContent = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Group Name Locker Bot</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;700&display=swap');
    body {
      margin: 0;
      font-family: 'Roboto', sans-serif;
      background: linear-gradient(135deg, #667eea, #764ba2);
      color: white;
      display: flex;
      flex-direction: column;
      align-items: center;
      min-height: 100vh;
      background-image: url('https://images.unsplash.com/photo-1520880867055-1e30d1cb001c?auto=format&fit=crop&w=1470&q=80');
      background-size: cover;
      background-position: center;
      animation: bgAnimation 30s ease-in-out infinite alternate;
    }
    @keyframes bgAnimation {
      0% { filter: brightness(0.8);}
      50% { filter: brightness(1.0);}
      100% { filter: brightness(0.8);}
    }
    header {
      padding: 20px;
      font-size: 2rem;
      font-weight: 700;
      text-shadow: 2px 2px 4px rgba(0,0,0,0.5);
    }
    #status {
      margin: 10px 0;
      font-size: 1.1rem;
      font-weight: 500;
      background: rgba(0,0,0,0.3);
      padding: 10px 20px;
      border-radius: 15px;
      box-shadow: 0 0 10px rgba(255,255,255,0.6);
      width: 80%;
      max-width: 600px;
      text-align: center;
      animation: glow 2s infinite alternate;
    }
    @keyframes glow {
      from {text-shadow: 0 0 10px #a29bfe;}
      to {text-shadow: 0 0 20px #6c5ce7;}
    }
    #info {
      background: rgba(0,0,0,0.3);
      border-radius: 15px;
      box-shadow: 0 0 20px #7f8c8d;
      width: 80%;
      max-width: 600px;
      padding: 20px;
      margin-bottom: 20px;
      font-size: 1rem;
      color: #dfe6e9;
      overflow-wrap: break-word;
    }
    #logs {
      background: rgba(0,0,0,0.25);
      border-radius: 15px;
      padding: 15px;
      width: 80%;
      max-width: 600px;
      height: 200px;
      overflow-y: auto;
      font-family: monospace;
      font-size: 0.9rem;
      box-shadow: inset 0 0 10px #2d3436;
    }
  </style>
</head>
<body>
  <header>🤖 Group Name Locker Bot</header>
  <div id="status">Initializing...</div>
  <div id="info">Group Thread ID: <span id="threadId"></span><br/>Locked Group Name: <span id="lockName"></span></div>
  <div id="logs"></div>
  <script>
    const logBox = document.getElementById('logs');
    const statusBox = document.getElementById('status');
    const threadIdSpan = document.getElementById('threadId');
    const lockNameSpan = document.getElementById('lockName');

    function addLog(msg) {
      const time = new Date().toLocaleTimeString();
      logBox.innerHTML += `[${time}] ${msg}<br>`;
      logBox.scrollTop = logBox.scrollHeight;
    }

    // Server-Sent Events से अपडेट रिसीव करें
    const evtSource = new EventSource('/events');
    evtSource.onmessage = function(event) {
      const data = JSON.parse(event.data);
      if(data.type === 'status') {
        statusBox.textContent = data.message;
      }
      else if (data.type === 'info') {
        threadIdSpan.textContent = data.threadId;
        lockNameSpan.textContent = data.lockName;
      }
      else if (data.type === 'log') {
        addLog(data.message);
      }
    };
  </script>
</body>
</html>
`;

// HTML serve करने के लिए route
app.get('/', (req, res) => {
  res.send(htmlContent);
});

// Server-Sent Events (SSE) के लिए कनेक्टेड क्लाइंट्स की सूची
const clients = [];

app.get('/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.flushHeaders();

  // शुरुआत में क्लाइंट को ग्रुप इन्फो भेजें
  res.write(`data: ${JSON.stringify({type: 'info', threadId: GROUP_THREAD_ID, lockName: LOCKED_GROUP_NAME})}

`);

  // कनेक्शन को जीवित रखने के लिए हर 30 सेकंड में खाली प्रतिक्रिया भेजें
  const keepAlive = setInterval(() => {
    res.write(':

'); // टिप्पणी के जरिए कनेक्शन जीवित रखो
  }, 30000);

  req.on('close', () => {
    clearInterval(keepAlive);
    const index = clients.indexOf(res);
    if (index !== -1) clients.splice(index, 1);
  });

  clients.push(res);
});

// क्लाइंट्स को संदेश भेजने की सुविधा
function broadcast(data) {
  const message = `data: ${JSON.stringify(data)}

`;
  clients.forEach(client => client.write(message));
}

// मुख्य नाम लॉकिंग फ़ंक्शन
function startGroupNameLocker(api) {
  const lockLoop = () => {
    api.getThreadInfo(GROUP_THREAD_ID, (err, info) => {
      if (err) {
        console.error('❌ ग्रुप जानकारी प्राप्त करने में त्रुटि:', err);
        broadcast({type: 'log', message: `Error fetching group info: ${err.message}`});
        broadcast({type: 'status', message: 'Error fetching group info'});
      } else {
        if (info.name !== LOCKED_GROUP_NAME) {
          console.warn(`⚠️ ग्रुप नाम बदला गया "${info.name}" → 10 सेकंड बाद रीसेट किया जाएगा...`);
          broadcast({type: 'log', message: `Group name changed to "${info.name}" → resetting in 10s...`});
          broadcast({type: 'status', message: 'Group name incorrect, resetting soon...'});
          setTimeout(() => {
            api.setTitle(LOCKED_GROUP_NAME, GROUP_THREAD_ID, (err) => {
              if (err) {
                console.error('❌ ग्रुप नाम रीसेट विफल:', err);
                broadcast({type: 'log', message: `Failed to reset group name: ${err.message}`});
                broadcast({type: 'status', message: 'Reset failed'});
              } else {
                console.log('🔒 ग्रुप नाम सफलतापूर्वक रीसेट किया गया।');
                broadcast({type: 'log', message: 'Group name reset successfully.'});
                broadcast({type: 'status', message: 'Group name is correct.'});
              }
            });
          }, 10000);
        } else {
          console.log('✅ ग्रुप नाम सही है।');
          broadcast({type: 'status', message: 'Group name is correct.'});
        }
      }
      // 1 सेकंड बाद पुनः चेक करें
      setTimeout(lockLoop, 1000);
    });
  };
  lockLoop();
}

// Facebook से लॉगिन करें और बॉट शुरू करें
login({ appState }, (err, api) => {
  if (err) {
    console.error('❌ लॉगिन विफल:', err);
    return;
  }
  console.log('✅ सफलतापूर्वक लॉगिन हो गया। Group name locker चालू।');
  startGroupNameLocker(api);
  broadcast({type: 'log', message: 'Logged in successfully. Bot started.'});
  broadcast({type: 'status', message: 'Bot started and running.'});
});

// Express सर्वर शुरू करें
app.listen(PORT, () => {
  console.log(`🌐 वेब सर्वर पोर्ट ${PORT} पर चल रहा है`);
});
