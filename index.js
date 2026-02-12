
import { GoogleGenAI, Modality } from '@google/genai';

// --- Global State & Initialization ---
const INITIAL_STATE = {
  hasDoneIntro: localStorage.getItem('senior_assist_intro_done') === 'true',
  introStep: 0,
  activeTab: new URLSearchParams(window.location.search).get('tab') || 'home',
  user: JSON.parse(localStorage.getItem('senior_assist_user')) || null,
  userName: localStorage.getItem('senior_assist_name') || '',
  isDarkMode: localStorage.getItem('senior_assist_dark') === 'true',
  notificationsEnabled: localStorage.getItem('senior_assist_notif') === 'true',
  medicines: JSON.parse(localStorage.getItem('senior_assist_meds')) || [],
  contacts: JSON.parse(localStorage.getItem('senior_assist_contacts')) || [
    { id: '1', name: 'Emergency Services', phone: '911', relation: 'SOS' }
  ],
  isAlarmActive: false,
  showAssistant: false,
  assistantActive: false,
  isOnline: navigator.onLine,
  modalType: null, // 'med' or 'contact'
  dailyTip: localStorage.getItem('senior_assist_tip') || 'Loading health tip...',
};

window.state = { ...INITIAL_STATE };
let state = window.state;

function setState(updater) {
  const newState = typeof updater === 'function' ? updater(window.state) : { ...window.state, ...updater };
  window.state = newState;
  state = window.state;
  
  localStorage.setItem('senior_assist_meds', JSON.stringify(state.medicines));
  localStorage.setItem('senior_assist_contacts', JSON.stringify(state.contacts));
  localStorage.setItem('senior_assist_dark', state.isDarkMode.toString());
  localStorage.setItem('senior_assist_notif', state.notificationsEnabled.toString());
  localStorage.setItem('senior_assist_name', state.userName);
  localStorage.setItem('senior_assist_user', JSON.stringify(state.user));
  localStorage.setItem('senior_assist_intro_done', state.hasDoneIntro.toString());
  localStorage.setItem('senior_assist_tip', state.dailyTip);
  
  document.body.classList.toggle('dark-mode', state.isDarkMode);
  render();
}
window.setState = setState;

// --- AI Service ---
async function generateDailyTip() {
  if (!state.isOnline || !process.env.API_KEY) return;
  try {
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: `You are a helpful senior care assistant. Provide a very short (15 words max), encouraging health tip for ${state.userName || 'a senior'} today. Focus on hydration, mobility, or mental wellness. No jargon.`,
    });
    if (response.text) setState({ dailyTip: response.text });
  } catch (e) {
    console.error("Gemini Error:", e);
  }
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
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.start(); osc.stop(audioCtx.currentTime + 0.4);
}

window.toggleAlarm = () => {
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
};

// --- Intro Flow ---
window.nextIntro = () => {
  if (state.introStep === 3) {
    const nameInput = document.getElementById('intro-name-input');
    const finalName = nameInput ? nameInput.nameInput = nameInput.value.trim() : state.userName;
    if (finalName) setState({ userName: finalName, hasDoneIntro: true, introStep: 0 });
    else alert("Please tell me your name so I can greet you!");
  } else {
    setState(s => ({ ...s, introStep: s.introStep + 1 }));
  }
};

// --- Assistant Logic ---
let assistantStream, assistantInCtx, assistantOutCtx, assistantSession, assistantNextStartTime = 0;
window.startAssistant = async () => {
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
          }
        },
        onerror: (e) => console.error("Assistant Socket Error:", e),
        onclose: () => setState({ assistantActive: false })
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: `You are Senior Assist. Help user as ${state.userName || 'Friend'}. Give short, clear spoken help.`,
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } }
      }
    });

    const source = assistantInCtx.createMediaStreamSource(stream);
    const processor = assistantInCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      if (assistantSession) {
        assistantSession.sendRealtimeInput({ media: createAudioBlob(e.inputBuffer.getChannelData(0)) });
      }
    };
    source.connect(processor); processor.connect(assistantInCtx.destination);
    setState({ assistantActive: true });
  } catch (e) { 
    console.error("Failed to start assistant:", e); 
    alert("Microphone access is required for the assistant.");
  }
};

window.stopAssistant = () => {
  assistantStream?.getTracks().forEach(t => t.stop());
  assistantInCtx?.close(); assistantOutCtx?.close();
  setState({ assistantActive: false });
};

// --- Modal Handlers ---
window.saveFromModal = () => {
  const v1 = document.getElementById('modal-input-1').value;
  const v2 = document.getElementById('modal-input-2').value;
  const v3 = document.getElementById('modal-input-3')?.value;
  if (!v1 || !v2) return alert("Please fill in the required fields.");

  if (state.modalType === 'med') {
    setState(s => ({ ...s, medicines: [...s.medicines, { id: Date.now().toString(), name: v1, time: v2, label: v3 || 'General', taken: false }], modalType: null }));
  } else if (state.modalType === 'contact') {
    setState(s => ({ ...s, contacts: [...s.contacts, { id: Date.now().toString(), name: v1, phone: v2, relation: v3 || 'Family' }], modalType: null }));
  }
};

// --- Icons ---
const ICONS = {
  home: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  meds: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>`,
  contacts: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  emergency: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
  mic: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  x: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>`,
  phone: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`,
  bell: `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`
};

// --- Render Core ---
function render() {
  const root = document.getElementById('root');
  if (!root) return;
  if (!state.hasDoneIntro) { root.innerHTML = renderIntro(); return; }

  const bgClass = state.isDarkMode ? 'bg-slate-950 text-white' : 'bg-gray-50 text-slate-900';
  const borderClass = state.isDarkMode ? 'border-slate-800' : 'border-gray-100';
  const navBgClass = state.isDarkMode ? 'bg-slate-900/95 border-slate-800' : 'bg-white/95 border-gray-100';

  root.innerHTML = `
    <div class="h-full w-full max-md:h-screen flex flex-col overflow-hidden md:max-w-xl md:h-[90vh] md:rounded-[60px] md:shadow-2xl md:border-8 md:border-black/5 ${bgClass} relative">
      <header class="p-6 safe-top flex justify-between items-center bg-inherit border-b ${borderClass}">
        <div class="flex items-center gap-3">
          <h1 class="text-2xl font-black text-blue-600">Senior Assist</h1>
          ${!state.isOnline ? `<span class="bg-red-500 text-white px-2 py-1 rounded text-[10px] font-bold uppercase">Offline</span>` : ''}
        </div>
        <button onclick="setState({isDarkMode: !state.isDarkMode})" class="p-2 rounded-full active:scale-90 transition-all ${state.isDarkMode ? 'text-yellow-400 bg-slate-800' : 'text-slate-400 bg-gray-100'}">
          ${state.isDarkMode ? ICONS.sun : ICONS.moon}
        </button>
      </header>

      <main class="flex-1 overflow-y-auto px-6 pt-4 pb-28 custom-scrollbar view-transition">
        ${renderTabContent()}
      </main>

      <nav class="absolute bottom-0 left-0 right-0 safe-bottom border-t p-4 flex justify-around items-center z-50 backdrop-blur-lg ${navBgClass}">
        ${['home', 'meds', 'contacts', 'emergency', 'settings'].map(tab => `
          <button onclick="setState({activeTab: '${tab}'})" class="flex flex-col items-center gap-1 ${state.activeTab === tab ? 'text-blue-600 scale-110' : 'text-gray-400 opacity-60'} transition-all">
            <div class="p-2 rounded-2xl ${state.activeTab === tab ? (state.isDarkMode ? 'bg-blue-900/40' : 'bg-blue-50') : ''}">${ICONS[tab]}</div>
            <span class="text-[10px] font-black uppercase tracking-widest">${tab === 'meds' ? 'Meds' : tab}</span>
          </button>
        `).join('')}
      </nav>

      ${state.showAssistant ? renderAssistantModal() : ''}
      ${state.modalType ? renderEntityModal() : ''}
    </div>
  `;
}

function renderIntro() {
  const steps = [
    { title: "Welcome!", desc: "I am Senior Assist, your companion for a healthy and safe life.", icon: ICONS.star, color: "bg-blue-600", textColor: "text-white" },
    { title: "Stay on Track", desc: "Never miss your pills again. I'll remind you exactly when it's time.", icon: ICONS.meds, color: "bg-white", textColor: "text-slate-900" },
    { title: "Always Safe", desc: "One big button alerts your loved ones and sounds a loud alarm.", icon: ICONS.emergency, color: "bg-red-500", textColor: "text-white" },
    { title: "Ready?", desc: "What is your name? I'd love to know who I'm helping.", icon: null, color: "bg-blue-50", textColor: "text-slate-900", isSetup: true }
  ];
  const step = steps[state.introStep] || steps[0];
  return `
    <div class="h-screen w-full flex flex-col ${step.color} ${step.textColor} transition-all duration-700 animate-in fade-in overflow-hidden">
      <div class="flex-1 flex flex-col items-center justify-center p-12 text-center space-y-10">
        ${step.icon ? `<div class="p-8 rounded-[40px] ${step.color === 'bg-white' ? 'bg-blue-50 text-blue-600' : 'bg-white/20'} animate-bounce">${step.icon}</div>` : ''}
        <div class="space-y-4 max-w-sm">
          <h2 class="text-5xl font-black leading-tight">${step.title}</h2>
          <p class="text-2xl font-medium opacity-80 leading-relaxed">${step.desc}</p>
        </div>
        ${step.isSetup ? `<input id="intro-name-input" type="text" placeholder="Your name..." value="${state.userName}" class="w-full p-8 rounded-[30px] text-3xl font-black bg-white shadow-2xl border-none text-slate-900 text-center">` : ''}
      </div>
      <div class="p-12 flex flex-col items-center gap-8">
        <button onclick="window.nextIntro()" class="w-full max-w-sm py-8 rounded-[40px] text-3xl font-black shadow-2xl active:scale-95 transition-transform ${step.color === 'bg-white' ? 'bg-blue-600 text-white' : 'bg-white text-blue-600'}">
          ${state.introStep === steps.length - 1 ? 'GET STARTED' : 'CONTINUE'}
        </button>
      </div>
    </div>
  `;
}

function renderTabContent() {
  const cardBgClass = state.isDarkMode ? 'bg-slate-900 border-slate-800 text-white' : 'bg-white border-gray-100 text-slate-900';
  const labelColorClass = state.isDarkMode ? 'text-slate-400' : 'text-gray-500';

  if (state.activeTab === 'home') return `
    <div class="space-y-6 animate-in fade-in">
      <div class="bg-blue-600 p-8 rounded-[40px] text-white shadow-xl relative overflow-hidden">
        <div class="relative z-10">
          <h2 class="text-3xl font-black mb-1">Hello, ${state.userName.split(' ')[0] || 'Friend'}!</h2>
          <p class="text-lg opacity-80 font-medium italic">"${state.dailyTip}"</p>
          <button onclick="setState({showAssistant: true})" class="mt-8 flex items-center gap-3 bg-white text-blue-600 px-8 py-5 rounded-full font-black text-xl shadow-lg active:scale-95 transition-transform">
            ${ICONS.mic} Voice Help
          </button>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div onclick="setState({activeTab: 'meds'})" class="p-6 rounded-[40px] border-2 flex flex-col gap-4 active:scale-95 transition-transform cursor-pointer ${cardBgClass}">
          <div class="w-14 h-14 bg-blue-100/10 rounded-3xl flex items-center justify-center text-blue-600">${ICONS.meds}</div>
          <h3 class="text-xl font-black">Medicines</h3>
        </div>
        <div onclick="setState({activeTab: 'contacts'})" class="p-6 rounded-[40px] border-2 flex flex-col gap-4 active:scale-95 transition-transform cursor-pointer ${cardBgClass}">
          <div class="w-14 h-14 bg-purple-100/10 rounded-3xl flex items-center justify-center text-purple-600">${ICONS.contacts}</div>
          <h3 class="text-xl font-black">Contacts</h3>
        </div>
      </div>
    </div>
  `;

  if (state.activeTab === 'meds') return `
    <div class="space-y-6">
      <div class="flex justify-between items-center">
        <h2 class="text-3xl font-black">Medicines</h2>
        <button onclick="setState({modalType: 'med'})" class="bg-blue-600 text-white p-4 rounded-full shadow-lg active:scale-90 transition-transform">${ICONS.plus}</button>
      </div>
      <div class="space-y-4">
        ${state.medicines.length === 0 ? '<p class="text-center opacity-40 p-10 font-bold">No meds tracked yet.</p>' : ''}
        ${state.medicines.map(m => `
          <div class="flex items-center justify-between p-6 rounded-[40px] border-2 ${m.taken ? (state.isDarkMode ? 'bg-green-900/20 border-green-800' : 'bg-green-50/50 border-green-200') : cardBgClass}">
            <div class="flex items-center gap-4 flex-1 cursor-pointer" onclick="setState(s => ({medicines: s.medicines.map(item => item.id === '${m.id}' ? {...item, taken: !item.taken} : item)}))">
              <div class="w-10 h-10 rounded-full border-4 flex items-center justify-center ${m.taken ? 'bg-green-500 border-green-500 text-white' : 'border-gray-200'}">
                ${m.taken ? '✓' : ''}
              </div>
              <div>
                <h4 class="text-xl font-bold">${m.name}</h4>
                <p class="text-sm font-medium ${labelColorClass}">${m.time} • ${m.label}</p>
              </div>
            </div>
            <button onclick="setState(s => ({medicines: s.medicines.filter(item => item.id !== '${m.id}')}))" class="p-4 text-red-300 hover:text-red-500 transition-colors">${ICONS.trash}</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
  
  if (state.activeTab === 'contacts') return `
    <div class="space-y-6">
      <div class="flex justify-between items-center">
        <h2 class="text-3xl font-black">Contacts</h2>
        <button onclick="setState({modalType: 'contact'})" class="bg-blue-600 text-white p-4 rounded-full shadow-lg active:scale-90 transition-transform">${ICONS.plus}</button>
      </div>
      <div class="space-y-4">
        ${state.contacts.map(c => `
          <div class="flex items-center justify-between p-6 rounded-[40px] border-2 ${cardBgClass}">
            <div class="flex-1">
              <h4 class="text-xl font-bold">${c.name}</h4>
              <p class="text-sm font-medium ${labelColorClass}">${c.relation}</p>
            </div>
            <div class="flex items-center gap-2">
              <a href="tel:${c.phone}" class="w-16 h-16 bg-green-500 text-white rounded-full flex items-center justify-center shadow-lg active:scale-90 transition-transform">
                ${ICONS.phone}
              </a>
              <button onclick="setState(s => ({contacts: s.contacts.filter(item => item.id !== '${c.id}')}))" class="p-4 text-red-300 hover:text-red-500 transition-colors">${ICONS.trash}</button>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

  if (state.activeTab === 'emergency') return `
    <div class="space-y-8 text-center animate-in zoom-in">
      <div class="py-10">
        <h2 class="text-4xl font-black mb-4">Emergency</h2>
        <p class="text-xl font-medium opacity-60">Tap below to sound the alarm and alert help.</p>
      </div>
      <button onclick="window.toggleAlarm()" class="w-full py-24 rounded-[60px] ${state.isAlarmActive ? 'bg-red-600 animate-pulse' : 'bg-red-500'} text-white shadow-2xl active:scale-95 transition-all">
        <div class="flex flex-col items-center gap-4">
          <div class="scale-[2] mb-4">${ICONS.emergency}</div>
          <span class="text-4xl font-black uppercase tracking-tighter">${state.isAlarmActive ? 'STOP' : 'HELP'}</span>
        </div>
      </button>
    </div>
  `;

  if (state.activeTab === 'settings') return `
    <div class="space-y-8">
      <h2 class="text-3xl font-black">Settings</h2>
      
      <div class="rounded-[40px] border-2 p-8 space-y-8 ${cardBgClass}">
        ${state.user ? `
          <div class="flex items-center gap-4 p-4 rounded-3xl ${state.isDarkMode ? 'bg-blue-900/30' : 'bg-blue-50'}">
            <img src="${state.user.picture}" class="w-16 h-16 rounded-full border-2 border-white shadow-sm">
            <div class="flex-1 min-w-0">
              <p class="font-black text-blue-600 text-xs">LOGGED IN AS</p>
              <p class="text-xl font-bold truncate">${state.user.name}</p>
            </div>
          </div>
          <button onclick="window.logout()" class="w-full py-4 text-center font-bold text-red-500 hover:bg-red-50/10 rounded-2xl transition-colors">Sign Out</button>
        ` : `
          <div class="flex flex-col items-center gap-4">
            <p class="font-bold opacity-60">Sync your settings</p>
            <div id="google-signin-btn" class="flex justify-center min-h-[40px]"></div>
          </div>
        `}
        
        <div class="flex items-center justify-between border-t pt-6 ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <div class="flex items-center gap-4">
            <div class="text-blue-600">${ICONS.bell}</div>
            <h4 class="text-xl font-black">Reminders</h4>
          </div>
          <button onclick="setState(s => ({notificationsEnabled: !s.notificationsEnabled}))" class="w-16 h-10 rounded-full ${state.notificationsEnabled ? 'bg-blue-600' : 'bg-gray-200'} p-1 transition-colors relative">
            <div class="w-8 h-8 bg-white rounded-full transition-transform shadow-sm ${state.notificationsEnabled ? 'translate-x-6' : 'translate-x-0'}"></div>
          </button>
        </div>

        <div class="flex items-center justify-between border-t pt-6 ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <div class="flex items-center gap-4">
            <div class="text-blue-600">${ICONS.moon}</div>
            <h4 class="text-xl font-black">Dark Mode</h4>
          </div>
          <button onclick="setState({isDarkMode: !state.isDarkMode})" class="w-16 h-10 rounded-full ${state.isDarkMode ? 'bg-blue-600' : 'bg-gray-200'} p-1 transition-colors relative">
            <div class="w-8 h-8 bg-white rounded-full transition-transform shadow-sm ${state.isDarkMode ? 'translate-x-6' : 'translate-x-0'}"></div>
          </button>
        </div>
        
        <div class="border-t pt-6 ${state.isDarkMode ? 'border-slate-800' : 'border-gray-100'}">
          <button onclick="if(confirm('Wipe everything?')) {localStorage.clear(); location.reload()}" class="w-full py-4 rounded-3xl font-black active:scale-95 transition-all ${state.isDarkMode ? 'bg-red-900/40 text-red-400' : 'bg-red-50 text-red-600'}">
            WIPE ALL DATA
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderAssistantModal() {
  return `
    <div class="fixed inset-0 z-[100] bg-blue-600 flex flex-col p-8 text-white animate-in slide-in-from-bottom">
      <div class="flex justify-between items-center">
        <span class="text-xl font-black">Voice Assistant</span>
        <button onclick="stopAssistant(); setState({showAssistant: false})" class="p-4 bg-white/10 rounded-full active:scale-90 transition-transform">${ICONS.x}</button>
      </div>
      <div class="flex-1 flex flex-col items-center justify-center text-center space-y-12">
        ${!state.assistantActive ? `
          <div class="w-32 h-32 bg-white/10 rounded-full flex items-center justify-center mb-4">
            ${ICONS.mic}
          </div>
          <button onclick="window.startAssistant()" class="bg-white text-blue-600 px-16 py-8 rounded-full font-black text-3xl shadow-2xl active:scale-95 transition-transform">START LISTENING</button>
        ` : `
          <div class="h-32 flex items-end gap-3">
            ${[1, 2, 3, 4, 5, 6].map(i => `<div class="w-6 bg-white rounded-full animate-bounce" style="height: ${30 + Math.random() * 70}%; animation-delay: ${i * 0.1}s"></div>`).join('')}
          </div>
          <p class="text-2xl font-bold animate-pulse">Listening...</p>
          <button onclick="window.stopAssistant()" class="bg-red-500 px-12 py-6 rounded-full font-black text-2xl shadow-xl active:scale-95 transition-transform">STOP</button>
        `}
      </div>
      <p class="text-center opacity-70 font-medium max-w-xs mx-auto">Tell me about your meds or ask any question. I am here for you.</p>
    </div>
  `;
}

function renderEntityModal() {
  const isMed = state.modalType === 'med';
  const modalBgClass = state.isDarkMode ? 'bg-slate-900 text-white' : 'bg-white text-slate-900';
  const inputBgClass = state.isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-gray-50 border-gray-100 text-slate-900';

  return `
    <div class="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md flex items-end p-4 animate-in fade-in">
      <div class="w-full rounded-[50px] p-10 space-y-8 shadow-2xl max-w-lg mx-auto ${modalBgClass} border-t-4 border-blue-600">
        <div class="flex justify-between items-center">
          <h3 class="text-3xl font-black">${isMed ? 'Add Medicine' : 'Add Contact'}</h3>
          <button onclick="setState({modalType: null})" class="text-gray-400 p-2 hover:text-red-500 transition-colors">${ICONS.x}</button>
        </div>
        <div class="space-y-4">
          <input id="modal-input-1" type="text" placeholder="${isMed ? 'Medicine Name' : 'Full Name'}" class="w-full p-6 rounded-3xl border-2 text-xl font-bold transition-all focus:border-blue-500 outline-none ${inputBgClass}">
          <input id="modal-input-2" type="${isMed ? 'time' : 'tel'}" placeholder="${isMed ? 'Time' : 'Phone Number'}" class="w-full p-6 rounded-3xl border-2 text-xl font-bold transition-all focus:border-blue-500 outline-none ${inputBgClass}">
          <input id="modal-input-3" type="text" placeholder="${isMed ? 'Label (e.g. Morning)' : 'Relation (e.g. Family)'}" class="w-full p-6 rounded-3xl border-2 text-xl font-bold transition-all focus:border-blue-500 outline-none ${inputBgClass}">
        </div>
        <button onclick="window.saveFromModal()" class="w-full bg-blue-600 text-white py-6 rounded-3xl font-black text-2xl shadow-xl active:scale-95 transition-transform">SAVE</button>
      </div>
    </div>
  `;
}

// Initial Call
generateDailyTip();
render();
