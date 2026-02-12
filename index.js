
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

// --- Icons ---
const ICONS = {
  home: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  meds: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>`,
  emergency: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  alert: `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  sync: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  appstore: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg>`
};

// --- State Management ---
let state = {
  hasDoneIntro: localStorage.getItem('senior_assist_intro_done') === 'true',
  introStep: 0,
  activeTab: 'home',
  user: JSON.parse(localStorage.getItem('senior_assist_user')) || null,
  userName: localStorage.getItem('senior_assist_name') || '',
  isDarkMode: localStorage.getItem('senior_assist_dark') === 'true',
  notificationsEnabled: localStorage.getItem('senior_assist_notif') === 'true',
  medicines: JSON.parse(localStorage.getItem('senior_assist_meds')) || [
    { id: '1', name: 'Vitamin C', time: '08:00', label: 'Morning', taken: false },
    { id: '2', name: 'Calcium', time: '18:00', label: 'Evening', taken: false }
  ],
  contacts: JSON.parse(localStorage.getItem('senior_assist_contacts')) || [
    { id: '1', name: 'Family', relation: 'Son', phone: '555-0101' },
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
  localStorage.setItem('senior_assist_dark', state.isDarkMode.toString());
  localStorage.setItem('senior_assist_notif', state.notificationsEnabled.toString());
  localStorage.setItem('senior_assist_name', state.userName);
  localStorage.setItem('senior_assist_user', JSON.stringify(state.user));
  localStorage.setItem('senior_assist_intro_done', state.hasDoneIntro.toString());
  render();
}
window.setState = setState;

window.addEventListener('online', () => setState({ isOnline: true }));
window.addEventListener('offline', () => setState({ isOnline: false }));

// --- Logic ---
window.nextIntro = () => {
  if (state.introStep === 3) {
    const nameInput = document.getElementById('intro-name-input');
    const finalName = nameInput ? nameInput.value.trim() : state.userName;
    if (finalName) setState({ userName: finalName, hasDoneIntro: true, introStep: 0 });
    else alert("Please tell me your name!");
  } else setState(s => ({ ...s, introStep: s.introStep + 1 }));
};

// --- Google Auth ---
function parseJwt(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64));
  } catch (e) { return null; }
}

window.handleCredentialResponse = (response) => {
  const payload = parseJwt(response.credential);
  if (payload) {
    setState({
      user: { name: payload.name, email: payload.email, picture: payload.picture },
      userName: payload.name,
      syncing: true,
      hasDoneIntro: true
    });
    setTimeout(() => setState({ syncing: false }), 2000);
  }
};

window.logout = () => confirm("Log out from Google?") && setState({ user: null });

function initGoogleSignIn() {
  if (window.google && state.activeTab === 'settings') {
    try {
      window.google.accounts.id.initialize({
        client_id: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com', 
        callback: window.handleCredentialResponse
      });
      const btn = document.getElementById('google-signin-btn');
      if (btn) window.google.accounts.id.renderButton(btn, { theme: state.isDarkMode ? 'dark' : 'outline', size: 'large', shape: 'pill', text: 'signin_with', width: 320 });
    } catch (e) {}
  }
}

// --- Alarm ---
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
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.4);
}

function toggleAlarm() {
  if (state.isAlarmActive) {
    clearInterval(alarmInterval);
    setState({ isAlarmActive: false });
  } else {
    setState({ isAlarmActive: true });
    let t = false;
    alarmInterval = setInterval(() => { playSiren(t); t = !t; if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]); }, 500);
  }
}
window.toggleAlarm = toggleAlarm;

// --- Assistant ---
let assistantStream, assistantInCtx, assistantOutCtx, assistantSession, assistantNextStartTime = 0;
async function startAssistant() {
  if (!state.isOnline) return alert("Offline!");
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
            source.buffer = buffer; source.connect(assistantOutCtx.destination);
            const now = Math.max(assistantNextStartTime, assistantOutCtx.currentTime);
            source.start(now); assistantNextStartTime = now + buffer.duration;
          }
          if (msg.serverContent?.outputTranscription) updateTranscriptions(msg.serverContent.outputTranscription.text, 'output');
          if (msg.serverContent?.inputTranscription) updateTranscriptions(msg.serverContent.inputTranscription.text, 'input');
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: `You are Senior Assist. Help ${state.userName}. Keep it simple and clear.`,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      }
    });
    const source = assistantInCtx.createMediaStreamSource(stream);
    const processor = assistantInCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => assistantSession?.sendRealtimeInput({ media: createAudioBlob(e.inputBuffer.getChannelData(0)) });
    source.connect(processor); processor.connect(assistantInCtx.destination);
    setState({ assistantActive: true });
  } catch (e) {}
}
window.startAssistant = startAssistant;
function updateTranscriptions(text, type) { setState(s => ({ ...s, transcriptions: [...(s.transcriptions || []).slice(-3), { text, type }] })); }
function stopAssistant() { assistantStream?.getTracks().forEach(t => t.stop()); assistantInCtx?.close(); assistantOutCtx?.close(); setState({ assistantActive: false, transcriptions: [] }); }
window.stopAssistant = stopAssistant;

// --- Components ---
function render() {
  const root = document.getElementById('root');
  if (!root) return;
  if (!state.hasDoneIntro) { root.innerHTML = renderIntro(); return; }
  document.body.className = `${state.isDarkMode ? 'bg-slate-950 text-white' : 'bg-gray-50 text-slate-900'} transition-colors duration-300 overflow-hidden`;
  root.innerHTML = `
    <div class="h-screen flex flex-col overflow-hidden max-w-lg mx-auto border-x ${state.isDarkMode ? 'border-slate-800' : 'border-gray-200'}">
      <header class="p-6 flex justify-between items-center bg-inherit border-b ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-black text-blue-600">Senior Assist</h1>
          ${!state.isOnline ? `<span class="bg-red-500 text-white px-2 py-1 rounded text-[10px] font-bold">Offline</span>` : ''}
        </div>
        <button onclick="setState({isDarkMode: !state.isDarkMode})" class="p-2 rounded-full ${state.isDarkMode ? 'text-yellow-400' : 'text-slate-400'}">
          ${state.isDarkMode ? ICONS.sun : ICONS.moon}
        </button>
      </header>
      <main class="flex-1 overflow-y-auto px-6 pt-4 pb-28 custom-scrollbar view-transition">
        ${renderTabContent()}
      </main>
      <nav class="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-inherit border-t p-4 flex justify-around items-center z-50 ${state.isDarkMode ? 'border-slate-800 bg-slate-950' : 'border-gray-100 shadow-lg bg-white'}">
        ${['home', 'meds', 'emergency', 'settings'].map(tab => `
          <button onclick="setState({activeTab: '${tab}'})" class="flex flex-col items-center gap-1 ${state.activeTab === tab ? 'text-blue-600' : 'text-gray-400 opacity-60'}">
            <div class="p-2 rounded-2xl ${state.activeTab === tab ? 'bg-blue-50' : ''}">${ICONS[tab === 'meds' ? 'meds' : tab === 'emergency' ? 'emergency' : tab]}</div>
            <span class="text-[10px] font-black uppercase tracking-widest">${tab}</span>
          </button>
        `).join('')}
      </nav>
      ${state.showAssistant ? renderAssistantModal() : ''}
      ${state.modalType ? renderEntityModal() : ''}
    </div>
  `;
  if (state.activeTab === 'settings') setTimeout(initGoogleSignIn, 100);
}

function renderIntro() {
  const steps = [
    { title: "Welcome!", desc: "I am Senior Assist, your companion for a healthy life.", icon: ICONS.star, color: "bg-blue-600", textColor: "text-white" },
    { title: "Always Safe", desc: "In an emergency, one big button alerts your loved ones.", icon: ICONS.emergency, color: "bg-red-500", textColor: "text-white" },
    { title: "Ready?", desc: "What is your name? I'd love to help you.", icon: null, color: "bg-blue-50", textColor: "text-slate-900", isSetup: true }
  ];
  const step = steps[state.introStep] || steps[0];
  return `
    <div class="h-screen w-full flex flex-col ${step.color} ${step.textColor} transition-all duration-700 p-12 text-center">
      <div class="flex-1 flex flex-col items-center justify-center space-y-10">
        ${step.icon ? `<div class="p-8 rounded-[40px] bg-white/20 animate-bounce">${step.icon}</div>` : ''}
        <h2 class="text-5xl font-black">${step.title}</h2>
        <p class="text-2xl font-medium opacity-80">${step.desc}</p>
        ${step.isSetup ? `<input id="intro-name-input" type="text" placeholder="Your name" class="w-full p-8 rounded-[30px] text-3xl font-black text-center text-slate-900">` : ''}
      </div>
      <button onclick="window.nextIntro()" class="w-full py-8 rounded-[40px] text-3xl font-black bg-white text-blue-600 shadow-2xl">CONTINUE</button>
    </div>
  `;
}

function renderTabContent() {
  if (state.activeTab === 'home') return `
    <div class="space-y-8 animate-in fade-in">
      <div class="bg-blue-600 p-8 rounded-[40px] text-white shadow-xl">
        <h2 class="text-3xl font-black mb-1">Hello, ${state.userName || 'Friend'}!</h2>
        <p class="text-lg opacity-80 font-medium">Ready to help you today.</p>
        <button onclick="setState({showAssistant: true})" class="mt-8 flex items-center gap-3 bg-white text-blue-600 px-8 py-5 rounded-full font-black text-xl">${ICONS.mic} Talk to Me</button>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div onclick="setState({activeTab: 'meds'})" class="p-6 rounded-[40px] border-2 bg-white flex flex-col gap-4">
          <div class="w-14 h-14 bg-blue-100 rounded-3xl flex items-center justify-center text-blue-600">${ICONS.meds}</div>
          <h3 class="text-xl font-black">Meds</h3>
        </div>
        <div onclick="setState({activeTab: 'emergency'})" class="p-6 rounded-[40px] border-2 bg-white flex flex-col gap-4">
          <div class="w-14 h-14 bg-red-100 rounded-3xl flex items-center justify-center text-red-500">${ICONS.emergency}</div>
          <h3 class="text-xl font-black">SOS</h3>
        </div>
      </div>
    </div>
  `;
  if (state.activeTab === 'settings') return `
    <div class="space-y-6">
      <h2 class="text-3xl font-black">Settings</h2>
      
      <div class="bg-blue-700 p-8 rounded-[40px] text-white space-y-4">
        <div class="flex items-center gap-4">
           <div class="bg-white p-4 rounded-3xl text-blue-700">${ICONS.appstore}</div>
           <div><h3 class="text-2xl font-black">Publish to Stores</h3><p class="text-sm opacity-80">Google Play & App Store</p></div>
        </div>
        <div class="p-6 bg-white/10 rounded-3xl space-y-4 text-sm leading-relaxed">
           <p>1. <strong>Icon:</strong> Use the "Health Heart" logo below (512x512px).</p>
           <p>2. <strong>Android:</strong> Use PWABuilder to generate a TWA package (.aab).</p>
           <p>3. <strong>iOS:</strong> Use Capacitor to wrap this HTML/JS into an Xcode project.</p>
           <div class="pt-4 flex flex-col items-center">
              <div class="w-24 h-24 bg-blue-600 rounded-[20px] shadow-2xl flex items-center justify-center border-4 border-white/20">
                 <svg viewBox="0 0 24 24" width="48" height="48" fill="white"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>
              </div>
              <span class="text-[10px] mt-2 font-black uppercase opacity-60">Proposed Store Icon</span>
           </div>
        </div>
      </div>

      <div class="bg-white border-2 rounded-[40px] p-8 space-y-6 ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : ''}">
         <button onclick="window.resetApp()" class="w-full text-left">
           <h4 class="text-xl font-black text-red-600">Reset Application</h4>
           <p class="text-sm opacity-50 font-bold">Wipe all data and restart</p>
         </button>
      </div>
    </div>
  `;
  return `<div class="py-20 text-center opacity-20 font-black">Section under construction</div>`;
}

function renderAssistantModal() { return `<div class="fixed inset-0 z-[100] bg-blue-600 flex flex-col p-8 text-white"><div class="flex justify-end"><button onclick="stopAssistant(); setState({showAssistant: false})" class="p-4 bg-white/10 rounded-full">${ICONS.x}</button></div><div class="flex-1 flex flex-col items-center justify-center space-y-10"><h2 class="text-5xl font-black">Talk to Me</h2><button onclick="startAssistant()" class="bg-white text-blue-600 px-16 py-7 rounded-full font-black text-3xl">START</button></div></div>`; }
function renderEntityModal() { return ``; }

window.resetApp = () => confirm('Wipe data?') && (localStorage.clear(), location.reload());
render();
