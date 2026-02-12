
import { GoogleGenAI, Modality } from '@google/genai';

// --- Service Worker Registration ---
let swRegistration = null;
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => {
        console.log('SW Registered');
        swRegistration = reg;
      })
      .catch(err => console.log('SW Failed', err));
  });
}

// --- Audio Utilities ---
const encode = (bytes) => {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
};

const decode = (base64) => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);
  return bytes;
};

async function decodeAudioData(data, ctx, sampleRate, numChannels) {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const createAudioBlob = (data) => {
  const l = data.length;
  const int16 = new Int16Array(l);
  for (let i = 0; i < l; i++) int16[i] = data[i] * 32768;
  return {
    data: encode(new Uint8Array(int16.buffer)),
    mimeType: 'audio/pcm;rate=16000',
  };
};

// --- Constants & Icons ---
const ICONS = {
  home: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  meds: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>`,
  emergency: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  sync: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`
};

// --- State Management ---
let state = {
  hasDoneIntro: JSON.parse(localStorage.getItem('senior_assist_intro_done')) || false,
  introStep: 0,
  activeTab: 'home',
  user: JSON.parse(localStorage.getItem('senior_assist_user')) || null,
  userName: localStorage.getItem('senior_assist_name') || '',
  isDarkMode: JSON.parse(localStorage.getItem('senior_assist_dark')) || false,
  notificationsEnabled: JSON.parse(localStorage.getItem('senior_assist_notif')) || false,
  medicines: JSON.parse(localStorage.getItem('senior_assist_meds')) || [
    { id: '1', name: 'Vitamin C', time: '08:00', label: 'Morning', taken: false },
    { id: '2', name: 'Calcium', time: '18:00', label: 'Evening', taken: false }
  ],
  contacts: JSON.parse(localStorage.getItem('senior_assist_contacts')) || [
    { id: '1', name: 'John Doe', relation: 'Son', phone: '555-0101' },
    { id: '2', name: 'Dr. Smith', relation: 'Clinic', phone: '555-9999' }
  ],
  isAlarmActive: false,
  showAssistant: false,
  assistantActive: false,
  transcriptions: [],
  isOnline: navigator.onLine,
  modalType: null,
  syncing: false
};

function setState(updater) {
  const newState = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
  state = newState;
  window.state = state; 
  localStorage.setItem('senior_assist_meds', JSON.stringify(state.medicines));
  localStorage.setItem('senior_assist_contacts', JSON.stringify(state.contacts));
  localStorage.setItem('senior_assist_dark', JSON.stringify(state.isDarkMode));
  localStorage.setItem('senior_assist_notif', JSON.stringify(state.notificationsEnabled));
  localStorage.setItem('senior_assist_name', state.userName);
  localStorage.setItem('senior_assist_user', JSON.stringify(state.user));
  localStorage.setItem('senior_assist_intro_done', JSON.stringify(state.hasDoneIntro));
  render();
}
window.setState = setState;
window.state = state;

window.addEventListener('online', () => setState({ isOnline: true }));
window.addEventListener('offline', () => setState({ isOnline: false }));

// --- Intro Flow Functions ---
window.nextIntro = () => {
  if (state.introStep === 3) {
    const nameInput = document.getElementById('intro-name-input');
    if (nameInput && nameInput.value) {
      setState({ userName: nameInput.value, hasDoneIntro: true });
    } else if (state.userName) {
      setState({ hasDoneIntro: true });
    } else {
      alert("Please tell me your name so I can greet you!");
    }
  } else {
    setState(s => ({ ...s, introStep: s.introStep + 1 }));
  }
};

// --- Google Sign-In Integration ---
function parseJwt(token) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
  return JSON.parse(jsonPayload);
}

window.handleCredentialResponse = (response) => {
  const payload = parseJwt(response.credential);
  setState({
    user: {
      name: payload.name,
      email: payload.email,
      picture: payload.picture
    },
    userName: payload.name,
    syncing: true,
    hasDoneIntro: true // Skip intro if they sign in immediately from a hypothetical login wall (or just update name)
  });
  setTimeout(() => setState({ syncing: false }), 2000);
};

window.logout = () => {
  if (confirm("Log out from Google?")) {
    setState({ user: null });
  }
};

function initGoogleSignIn() {
  if (window.google && state.activeTab === 'settings') {
    window.google.accounts.id.initialize({
      client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', 
      callback: window.handleCredentialResponse
    });
    const btn = document.getElementById('google-signin-btn');
    if (btn) {
      window.google.accounts.id.renderButton(btn, { 
        theme: state.isDarkMode ? 'dark' : 'outline', 
        size: 'large',
        shape: 'pill',
        text: 'signin_with',
        width: 320
      });
    }
  }
}

// --- Notification Logic ---
async function requestNotificationPermission() {
  if (!('Notification' in window)) return alert("Browser does not support notifications.");
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    setState({ notificationsEnabled: true });
    sendNotification("Notifications Active", "I will remind you when it's time for your medicine.");
  } else {
    setState({ notificationsEnabled: false });
  }
}
window.requestNotificationPermission = requestNotificationPermission;

function sendNotification(title, body) {
  if (!state.notificationsEnabled) return;
  if (swRegistration) {
    swRegistration.showNotification(title, {
      body,
      icon: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png',
      badge: 'https://cdn-icons-png.flaticon.com/512/3063/3063822.png',
      vibrate: [200, 100, 200],
      tag: 'medicine-reminder'
    });
  } else {
    new Notification(title, { body });
  }
}

// Heartbeat
setInterval(() => {
  if (!state.notificationsEnabled) return;
  const now = new Date();
  const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  state.medicines.forEach(med => {
    if (med.time === currentTime && !med.taken) {
      sendNotification("Medicine Time!", `It's time to take your ${med.name}.`);
    }
  });
}, 60000);

// --- Alarm Logic ---
let alarmInterval = null;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
function playSiren(high) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(high ? 587.33 : 440.00, audioCtx.currentTime);
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.05);
  gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.4);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.4);
}

function toggleAlarm() {
  if (state.isAlarmActive) {
    clearInterval(alarmInterval);
    setState({ isAlarmActive: false });
  } else {
    setState({ isAlarmActive: true });
    let toggle = false;
    alarmInterval = setInterval(() => {
      playSiren(toggle);
      toggle = !toggle;
      if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
    }, 500);
  }
}
window.toggleAlarm = toggleAlarm;

// --- Gemini Voice Integration ---
let assistantStream, assistantInCtx, assistantOutCtx, assistantSession, assistantNextStartTime = 0;
let assistantSources = new Set();

async function startAssistant() {
  if (!state.isOnline) return alert("Internet required for Voice Assistant.");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    assistantStream = stream;
    assistantInCtx = new AudioContext({ sampleRate: 16000 });
    assistantOutCtx = new AudioContext({ sampleRate: 24000 });
    
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    assistantSession = await ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onmessage: async (msg) => {
          const audio = msg.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
          if (audio) {
            const buffer = await decodeAudioData(decode(audio), assistantOutCtx, 24000, 1);
            const source = assistantOutCtx.createBufferSource();
            source.buffer = buffer;
            source.connect(assistantOutCtx.destination);
            const now = Math.max(assistantNextStartTime, assistantOutCtx.currentTime);
            source.start(now);
            assistantNextStartTime = now + buffer.duration;
            assistantSources.add(source);
          }
          if (msg.serverContent?.outputTranscription) updateTranscriptions(msg.serverContent.outputTranscription.text, 'output');
          if (msg.serverContent?.inputTranscription) updateTranscriptions(msg.serverContent.inputTranscription.text, 'input');
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: `You are Senior Assist. Greet user as ${state.user ? state.user.name : state.userName || 'Friend'}. Keep answers short, loud, and helpful.`,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      }
    });

    const source = assistantInCtx.createMediaStreamSource(stream);
    const processor = assistantInCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => assistantSession.sendRealtimeInput({ media: createAudioBlob(e.inputBuffer.getChannelData(0)) });
    source.connect(processor);
    processor.connect(assistantInCtx.destination);
    setState({ assistantActive: true });
  } catch (e) { console.error(e); }
}
window.startAssistant = startAssistant;

function updateTranscriptions(text, type) {
  setState(s => ({ ...s, transcriptions: [...s.transcriptions.slice(-3), { text, type }] }));
}

function stopAssistant() {
  assistantStream?.getTracks().forEach(t => t.stop());
  assistantInCtx?.close(); assistantOutCtx?.close();
  setState({ assistantActive: false, transcriptions: [] });
}
window.stopAssistant = stopAssistant;

// --- Main Components ---
function render() {
  const root = document.getElementById('root');
  
  // Choose between Intro or Main App
  if (!state.hasDoneIntro) {
    root.innerHTML = renderIntro();
    return;
  }

  document.body.className = `${state.isDarkMode ? 'bg-slate-950 text-white' : 'bg-gray-50 text-slate-900'} transition-colors duration-300`;
  
  root.innerHTML = `
    <div class="h-screen flex flex-col overflow-hidden max-w-lg mx-auto border-x ${state.isDarkMode ? 'border-slate-800' : 'border-gray-200'}">
      <header class="p-6 flex justify-between items-center bg-inherit border-b ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-black text-blue-600">Senior<span class="opacity-40">Assist</span></h1>
          ${!state.isOnline ? `<span class="bg-red-500 text-white px-2 py-1 rounded text-[10px] font-bold uppercase">Offline</span>` : ''}
          ${state.user ? `
            <div class="flex items-center gap-1 text-green-500 ${state.syncing ? 'opacity-100' : 'opacity-40'}">
              <div class="${state.syncing ? 'animate-sync' : ''}">${ICONS.sync}</div>
              <span class="text-[8px] font-bold uppercase tracking-widest">${state.syncing ? 'Syncing' : 'Synced'}</span>
            </div>
          ` : ''}
        </div>
        <div class="flex items-center gap-2">
          ${state.user ? `<img src="${state.user.picture}" class="w-8 h-8 rounded-full border-2 border-blue-500">` : ''}
          <button onclick="setState({isDarkMode: !state.isDarkMode})" class="p-2 rounded-full hover:bg-black/5 active:scale-90 transition-all ${state.isDarkMode ? 'text-yellow-400' : 'text-slate-400'}">
            ${state.isDarkMode ? ICONS.sun : ICONS.moon}
          </button>
        </div>
      </header>

      <main class="flex-1 overflow-y-auto px-6 pt-4 pb-28 custom-scrollbar view-transition">
        ${renderTabContent()}
      </main>

      <nav class="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-inherit border-t p-4 flex justify-around items-center z-50 ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100 shadow-lg'}">
        ${['home', 'meds', 'emergency', 'settings'].map(tab => `
          <button onclick="setState({activeTab: '${tab}'})" class="flex flex-col items-center gap-1 ${state.activeTab === tab ? 'text-blue-600 scale-110' : 'text-gray-400 opacity-60'} transition-all">
            <div class="p-2 rounded-2xl ${state.activeTab === tab ? 'bg-blue-50' : ''}">${ICONS[tab === 'meds' ? 'meds' : tab === 'emergency' ? 'emergency' : tab]}</div>
            <span class="text-[10px] font-black uppercase tracking-widest">${tab}</span>
          </button>
        `).join('')}
      </nav>

      ${state.showAssistant ? renderAssistantModal() : ''}
      ${state.modalType ? renderEntityModal() : ''}
    </div>
  `;
  if (state.activeTab === 'settings') {
    setTimeout(initGoogleSignIn, 100);
  }
}

function renderIntro() {
  const steps = [
    {
      title: "Welcome!",
      desc: "I am Senior Assist, your friendly companion for a healthy and safe life.",
      icon: ICONS.star,
      color: "bg-blue-600",
      textColor: "text-white"
    },
    {
      title: "Stay on Track",
      desc: "Never miss your pills again. I'll remind you exactly when it's time to take them.",
      icon: ICONS.meds,
      color: "bg-white",
      textColor: "text-slate-900"
    },
    {
      title: "Always Safe",
      desc: "In an emergency, one big button alerts your loved ones and sounds a loud alarm.",
      icon: ICONS.emergency,
      color: "bg-red-500",
      textColor: "text-white"
    },
    {
      title: "Let's Get Started",
      desc: "What is your name? I'd love to know who I'm helping.",
      icon: null,
      color: "bg-blue-50",
      textColor: "text-slate-900",
      isSetup: true
    }
  ];

  const step = steps[state.introStep];

  return `
    <div class="h-screen w-full flex flex-col ${step.color} ${step.textColor} transition-all duration-700 animate-in fade-in">
      <div class="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-10">
        ${step.icon ? `<div class="p-8 rounded-[40px] ${step.color === 'bg-white' ? 'bg-blue-50 text-blue-600' : 'bg-white/20'} animate-bounce">${step.icon}</div>` : ''}
        
        <div class="space-y-4 max-w-sm">
          <h2 class="text-5xl font-black leading-tight">${step.title}</h2>
          <p class="text-2xl font-medium opacity-80 leading-relaxed">${step.desc}</p>
        </div>

        ${step.isSetup ? `
          <div class="w-full max-w-sm">
            <input id="intro-name-input" type="text" placeholder="Type your name..." value="${state.userName}" class="w-full p-8 rounded-[30px] text-3xl font-black bg-white shadow-2xl border-none focus:ring-4 ring-blue-500 text-slate-900 text-center placeholder:opacity-20">
          </div>
        ` : ''}
      </div>

      <div class="p-12 flex flex-col items-center gap-8">
        <div class="flex gap-3">
          ${steps.map((_, i) => `<div class="h-3 rounded-full transition-all duration-500 ${i === state.introStep ? 'w-12 bg-current' : 'w-3 bg-current opacity-20'}"></div>`).join('')}
        </div>
        
        <button onclick="window.nextIntro()" class="w-full max-w-sm py-8 rounded-[40px] text-3xl font-black shadow-2xl active:scale-95 transition-transform ${step.color === 'bg-white' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}">
          ${state.introStep === steps.length - 1 ? 'GET STARTED' : 'CONTINUE'}
        </button>
      </div>
    </div>
  `;
}

function renderTabContent() {
  if (state.activeTab === 'home') return `
    <div class="space-y-8 animate-in fade-in duration-500">
      <div class="bg-blue-600 p-8 rounded-[40px] text-white shadow-xl relative overflow-hidden">
        <h2 class="text-3xl font-black mb-1">Hello, ${state.user ? state.user.name.split(' ')[0] : state.userName.split(' ')[0] || 'Friend'}!</h2>
        <p class="text-lg opacity-80 font-medium">Ready to help you today.</p>
        <button onclick="setState({showAssistant: true})" class="mt-8 flex items-center gap-3 bg-white text-blue-600 px-8 py-5 rounded-full font-black text-xl shadow-lg active:scale-95 transition-transform">
          ${ICONS.mic} Talk to Me
        </button>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div onclick="setState({activeTab: 'meds'})" class="p-6 rounded-[40px] border-2 ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-blue-50'} shadow-sm flex flex-col gap-4 cursor-pointer">
          <div class="w-14 h-14 bg-blue-100 rounded-3xl flex items-center justify-center text-blue-600">${ICONS.meds}</div>
          <div><h3 class="text-xl font-black">Meds</h3><p class="text-xs opacity-50 font-bold uppercase tracking-widest">${state.medicines.filter(m=>!m.taken).length} remaining</p></div>
        </div>
        <div onclick="setState({activeTab: 'emergency'})" class="p-6 rounded-[40px] border-2 ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-red-50'} shadow-sm flex flex-col gap-4 cursor-pointer">
          <div class="w-14 h-14 bg-red-100 rounded-3xl flex items-center justify-center text-red-500">${ICONS.emergency}</div>
          <div><h3 class="text-xl font-black">Help</h3><p class="text-xs opacity-50 font-bold uppercase tracking-widest">Alarm & SOS</p></div>
        </div>
      </div>
    </div>
  `;

  if (state.activeTab === 'meds') return `
    <div class="space-y-6">
      <div class="flex justify-between items-center">
        <h2 class="text-3xl font-black">Medicines</h2>
        <button onclick="setState({modalType: 'med'})" class="bg-blue-600 text-white p-4 rounded-full shadow-lg">${ICONS.plus}</button>
      </div>
      <div class="space-y-4">
        ${state.medicines.map(m => `
          <div class="flex items-center justify-between p-6 rounded-[40px] border-2 transition-all ${m.taken ? 'bg-green-50 border-green-200' : state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100'}">
            <div class="flex items-center gap-4 flex-1 cursor-pointer" onclick="window.toggleMed('${m.id}')">
              <div class="w-10 h-10 rounded-full border-4 ${m.taken ? 'bg-green-500 border-green-200' : 'border-gray-200'} flex items-center justify-center">
                ${m.taken ? '✓' : ''}
              </div>
              <div><h4 class="text-xl font-bold ${m.taken ? 'line-through opacity-40' : ''}">${m.name}</h4><p class="text-xs uppercase font-black opacity-50 tracking-widest">${m.time} (${m.label})</p></div>
            </div>
            <button onclick="window.deleteMed('${m.id}')" class="p-2 opacity-20 hover:opacity-100 transition-opacity">${ICONS.trash}</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  if (state.activeTab === 'emergency') return `
    <div class="space-y-8">
      <div class="text-center">
        <h2 class="text-3xl font-black">SOS Center</h2>
        <p class="opacity-50 font-bold">Press the button for immediate attention</p>
      </div>
      <button onclick="toggleAlarm()" class="w-full py-20 rounded-[60px] shadow-2xl flex flex-col items-center justify-center gap-6 border-b-[10px] transition-all active:scale-95 ${state.isAlarmActive ? 'bg-red-600 border-red-800 animate-pulse ring-[30px] ring-red-500/10' : 'bg-red-500 border-red-700 shadow-red-500/20'}">
        <div class="p-6 bg-white/20 rounded-full text-white">${ICONS.alert}</div>
        <span class="text-white text-3xl font-black uppercase tracking-tighter">${state.isAlarmActive ? 'STOP ALARM' : 'PANIC ALARM'}</span>
      </button>
      <div class="flex justify-between items-center px-2"><h3 class="text-xl font-black uppercase tracking-widest opacity-40">SOS Contacts</h3><button onclick="setState({modalType: 'contact'})" class="text-blue-600 font-bold">Add New</button></div>
      <div class="space-y-3">
        ${state.contacts.map(c => `
          <div class="flex items-center gap-4 p-6 rounded-[40px] ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100'} border-2">
            <div class="flex-1">
              <span class="text-[10px] font-black uppercase opacity-40 tracking-widest">${c.relation}</span>
              <h4 class="text-xl font-black">${c.name}</h4>
              <p class="text-sm opacity-50 font-bold">${c.phone}</p>
            </div>
            <div class="flex gap-2">
              <button onclick="window.deleteContact('${c.id}')" class="p-3 text-red-500 opacity-20 hover:opacity-100">${ICONS.trash}</button>
              <a href="tel:${c.phone}" class="bg-green-500 text-white p-4 rounded-full shadow-lg active:scale-90 transition-transform">${ICONS.phone}</a>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  if (state.activeTab === 'settings') return `
    <div class="space-y-8 animate-in slide-in-from-bottom-10">
      <div class="text-center"><h2 class="text-3xl font-black">Settings</h2><p class="opacity-50 font-bold">Personalize your experience</p></div>
      <div class="bg-white ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'border-gray-100'} border-2 rounded-[40px] overflow-hidden">
        
        <div class="p-8 border-b ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <label class="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-4">Account & Sync</label>
          ${state.user ? `
            <div class="flex items-center gap-4 mb-4">
              <img src="${state.user.picture}" class="w-16 h-16 rounded-full border-4 border-blue-100">
              <div>
                <h4 class="text-xl font-black">${state.user.name}</h4>
                <p class="text-sm opacity-50 font-bold">${state.user.email}</p>
                <div class="flex items-center gap-1 text-green-500 mt-1">
                   ${ICONS.sync} <span class="text-[10px] uppercase font-black">Synced to Cloud</span>
                </div>
              </div>
            </div>
            <button onclick="window.logout()" class="w-full py-4 rounded-2xl border-2 border-red-100 text-red-600 font-black uppercase text-xs tracking-widest hover:bg-red-50 transition-colors">Sign Out</button>
          ` : `
            <div class="p-4 bg-blue-50 ${state.isDarkMode ? 'bg-blue-900/20' : ''} rounded-2xl mb-4">
              <p class="text-sm font-bold text-blue-600">Sign in with Gmail to sync your medicine reminders and contacts across all devices.</p>
            </div>
            <div id="google-signin-btn" class="flex justify-center"></div>
          `}
        </div>

        <div class="p-8 border-b ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <label class="text-[10px] font-black uppercase tracking-widest opacity-40 block mb-2">My Display Name</label>
          <input type="text" value="${state.user ? state.user.name : state.userName}" onchange="setState({userName: this.value})" class="w-full bg-transparent text-2xl font-black focus:outline-none focus:text-blue-600 transition-colors" ${state.user ? 'disabled' : ''}>
        </div>
        
        <div class="p-8 flex items-center justify-between border-b ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <div><h4 class="text-xl font-black">Reminders</h4><p class="text-sm opacity-50 font-bold">Get medicine notifications</p></div>
          <button onclick="window.requestNotificationPermission()" class="w-14 h-8 rounded-full ${state.notificationsEnabled ? 'bg-green-500' : 'bg-gray-200'} p-1 transition-all"><div class="w-6 h-6 bg-white rounded-full shadow-md transition-all ${state.notificationsEnabled ? 'translate-x-6' : ''}"></div></button>
        </div>

        <div class="p-8 flex items-center justify-between border-b ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <div><h4 class="text-xl font-black">Dark Mode</h4><p class="text-sm opacity-50 font-bold">Easier for reading at night</p></div>
          <button onclick="setState({isDarkMode: !state.isDarkMode})" class="w-14 h-8 rounded-full ${state.isDarkMode ? 'bg-blue-600' : 'bg-gray-200'} p-1 transition-all"><div class="w-6 h-6 bg-white rounded-full shadow-md transition-all ${state.isDarkMode ? 'translate-x-6' : ''}"></div></button>
        </div>
        
        <button onclick="window.resetApp()" class="w-full p-8 text-left hover:bg-red-50 transition-colors">
          <h4 class="text-xl font-black text-red-600">Reset App</h4>
          <p class="text-sm opacity-50 font-bold">Clear all your saved data</p>
        </button>
      </div>
      <div class="text-center opacity-30 font-black text-[10px] uppercase tracking-[0.3em]">Senior Assist v1.4 • Onboarding Ready</div>
    </div>
  `;
}

function renderAssistantModal() {
  return `
    <div class="fixed inset-0 z-[100] bg-blue-600 flex flex-col p-8 text-white animate-in slide-in-from-bottom duration-300">
      <div class="flex justify-end"><button onclick="stopAssistant(); setState({showAssistant: false})" class="p-4 bg-white/10 rounded-full active:scale-90">${ICONS.x}</button></div>
      <div class="flex-1 flex flex-col items-center justify-center text-center space-y-10">
        ${!state.assistantActive ? `
          <div class="p-12 bg-white/20 rounded-full pulse-blue"><div class="scale-150">${ICONS.mic}</div></div>
          <div class="space-y-2"><h2 class="text-5xl font-black">Hello!</h2><p class="text-xl opacity-80 font-bold">I am ready to help.</p></div>
          <button onclick="startAssistant()" class="bg-white text-blue-600 px-16 py-7 rounded-full font-black text-3xl shadow-2xl active:scale-95 transition-transform">START ASSISTANT</button>
        ` : `
          <div class="h-32 flex items-center gap-3">
            ${[1, 2, 3, 4, 5, 6].map(i => `<div class="w-5 bg-white rounded-full animate-bounce" style="height:${30 + Math.random() * 80}px; animation-delay:${i * 0.1}s"></div>`).join('')}
          </div>
          <div class="w-full max-sm bg-black/10 p-8 rounded-[50px] space-y-6 text-2xl max-h-[40vh] overflow-y-auto custom-scrollbar">
            ${state.transcriptions.map(t => `<div class="${t.type === 'input' ? 'text-right opacity-60 italic text-xl' : 'text-left font-black'}">${t.text}</div>`).join('')}
          </div>
          <button onclick="stopAssistant()" class="bg-red-500 text-white px-12 py-6 rounded-full font-black text-2xl shadow-xl active:scale-95">STOP ASSISTANT</button>
        `}
      </div>
    </div>
  `;
}

function renderEntityModal() {
  const isMed = state.modalType === 'med';
  return `
    <div class="fixed inset-0 z-[100] bg-black/50 backdrop-blur-md flex items-end p-4 animate-in fade-in duration-300">
      <div class="w-full bg-white rounded-[50px] p-10 space-y-8 animate-in slide-in-from-bottom duration-500 ${state.isDarkMode ? 'bg-slate-900 text-white' : ''}">
        <div class="flex justify-between items-center"><h3 class="text-3xl font-black">${isMed ? 'Add Medicine' : 'Add Contact'}</h3><button onclick="setState({modalType: null})" class="opacity-20">${ICONS.x}</button></div>
        <div class="space-y-4">
          <input id="modal-input-1" type="text" placeholder="${isMed ? 'Med Name' : 'Full Name'}" class="w-full p-6 rounded-3xl bg-gray-50 border-2 border-transparent focus:border-blue-500 outline-none text-xl font-bold ${state.isDarkMode ? 'bg-slate-800' : ''}">
          <input id="modal-input-2" type="${isMed ? 'time' : 'tel'}" placeholder="${isMed ? '' : 'Phone Number'}" class="w-full p-6 rounded-3xl bg-gray-50 border-2 border-transparent focus:border-blue-500 outline-none text-xl font-bold ${state.isDarkMode ? 'bg-slate-800' : ''}">
          ${isMed ? `<input id="modal-input-3" type="text" placeholder="Label (e.g. Morning)" class="w-full p-6 rounded-3xl bg-gray-50 border-2 border-transparent focus:border-blue-500 outline-none text-xl font-bold ${state.isDarkMode ? 'bg-slate-800' : ''}">` : ''}
          ${!isMed ? `<input id="modal-input-3" type="text" placeholder="Relation (Son, Doctor...)" class="w-full p-6 rounded-3xl bg-gray-50 border-2 border-transparent focus:border-blue-500 outline-none text-xl font-bold ${state.isDarkMode ? 'bg-slate-800' : ''}">` : ''}
        </div>
        <button onclick="window.saveFromModal()" class="w-full bg-blue-600 text-white py-6 rounded-3xl font-black text-2xl shadow-xl active:scale-95 transition-all">SAVE NOW</button>
      </div>
    </div>
  `;
}

// --- Global Functions ---
window.toggleMed = (id) => setState(s => ({ ...s, medicines: s.medicines.map(m => m.id === id ? { ...m, taken: !m.taken } : m) }));
window.deleteMed = (id) => setState(s => ({ ...s, medicines: s.medicines.filter(m => m.id !== id) }));
window.deleteContact = (id) => setState(s => ({ ...s, contacts: s.contacts.filter(c => c.id !== id) }));
window.resetApp = () => confirm('This will clear all data and show the intro again. Continue?') && (localStorage.clear(), location.reload());

window.saveFromModal = () => {
  const v1 = document.getElementById('modal-input-1').value;
  const v2 = document.getElementById('modal-input-2').value;
  const v3 = document.getElementById('modal-input-3')?.value;
  if (!v1 || !v2) return alert("Fill all fields");

  if (state.modalType === 'med') {
    setState(s => ({ ...s, medicines: [...s.medicines, { id: Date.now().toString(), name: v1, time: v2, label: v3 || 'Morning', taken: false }], modalType: null }));
  } else {
    setState(s => ({ ...s, contacts: [...s.contacts, { id: Date.now().toString(), name: v1, phone: v2, relation: v3 || 'Family' }], modalType: null }));
  }
};

// Initial Sync & Render
window.state = state;
render();
