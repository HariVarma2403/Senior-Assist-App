import { GoogleGenAI, Modality } from '@google/genai';

// --- Service Worker Registration for Offline Support ---
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW Registered', reg))
      .catch(err => console.log('SW Registration Failed', err));
  });
}

// --- Utilities ---
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

// --- Constants ---
const DEFAULT_CONTACTS = [
  { id: '1', name: 'John Doe', relation: 'Son', phone: '555-0101' },
  { id: '2', name: 'Dr. Smith', relation: 'Cardiologist', phone: '555-9999', isDoctor: true },
];

const DEFAULT_MEDICINES = [
  { id: 'm1', name: 'Aspirin', dosage: '1 tablet', time: 'Morning', taken: false },
  { id: 'm2', name: 'Lisinopril', dosage: '10mg', time: 'Evening', taken: false },
];

const ICONS = {
  home: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
  meds: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/></svg>`,
  emergency: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>`,
  settings: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.1a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>`,
  mic: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/></svg>`,
  sun: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>`,
  moon: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>`,
  alert: `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  trash: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`,
  phone: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  heart: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/></svg>`,
  x: `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
};

// --- State Management ---
let state = {
  activeTab: 'home',
  isDarkMode: JSON.parse(localStorage.getItem('senior_assist_dark')) || false,
  showAssistant: false,
  isAlarmActive: false,
  medicines: JSON.parse(localStorage.getItem('senior_assist_meds')) || DEFAULT_MEDICINES,
  contacts: JSON.parse(localStorage.getItem('senior_assist_contacts')) || DEFAULT_CONTACTS,
  assistantActive: false,
  transcriptions: [],
  isOnline: navigator.onLine
};

function setState(updater) {
  const newState = typeof updater === 'function' ? updater(state) : { ...state, ...updater };
  state = newState;
  localStorage.setItem('senior_assist_meds', JSON.stringify(state.medicines));
  localStorage.setItem('senior_assist_contacts', JSON.stringify(state.contacts));
  localStorage.setItem('senior_assist_dark', JSON.stringify(state.isDarkMode));
  render();
}

// --- Connectivity Monitoring ---
window.addEventListener('online', () => setState({ isOnline: true }));
window.addEventListener('offline', () => setState({ isOnline: false }));

// --- Audio Panic Alarm ---
let alarmInterval = null;
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSiren(high) {
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(high ? 554.37 : 440.00, audioCtx.currentTime);
  gain.gain.setValueAtTime(0, audioCtx.currentTime);
  gain.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.05);
  gain.gain.linearRampToValueAtTime(0.4, audioCtx.currentTime + 0.35);
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
      if ('vibrate' in navigator) navigator.vibrate(400);
    }, 450);
    playSiren(true);
  }
}

// --- Gemini Voice Assistant ---
let assistantStream = null;
let assistantInCtx = null;
let assistantOutCtx = null;
let assistantSources = new Set();
let assistantNextStartTime = 0;
let assistantSession = null;

async function startAssistant() {
  if (!state.isOnline) {
    alert("Voice Assistant requires internet to work. Please connect to Wi-Fi or Data.");
    return;
  }
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
            source.onended = () => assistantSources.delete(source);
          }
          if (msg.serverContent?.interrupted) {
            assistantSources.forEach(s => { try { s.stop(); } catch(e) {} });
            assistantSources.clear();
            assistantNextStartTime = 0;
          }
          if (msg.serverContent?.outputTranscription) {
            updateTranscriptions(msg.serverContent.outputTranscription.text, 'output');
          }
          if (msg.serverContent?.inputTranscription) {
            updateTranscriptions(msg.serverContent.inputTranscription.text, 'input');
          }
          if (msg.toolCall) {
            for (const fc of msg.toolCall.functionCalls) {
              if (fc.name === 'add_medicine') {
                const { name, time, dosage } = fc.args;
                setState(s => ({ ...s, medicines: [...s.medicines, { id: Math.random().toString(36).substr(2, 9), name, time, dosage: dosage || 'As directed', taken: false }] }));
                assistantSession.sendToolResponse({ functionResponses: [{ id: fc.id, name: fc.name, response: { result: "Medicine added" } }] });
              }
            }
          }
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: "You are Senior Assist, a helper for elderly people. Be clear, loud, and compassionate. You can help them add medicines to their schedule.",
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
        tools: [{ functionDeclarations: [{
          name: 'add_medicine',
          description: 'Add a new medicine',
          parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, time: { type: 'STRING', enum: ['Morning', 'Afternoon', 'Evening', 'Night'] }, dosage: { type: 'STRING' } }, required: ['name', 'time'] }
        }] }],
        inputAudioTranscription: {},
        outputAudioTranscription: {}
      }
    });

    const source = assistantInCtx.createMediaStreamSource(stream);
    const processor = assistantInCtx.createScriptProcessor(4096, 1, 1);
    processor.onaudioprocess = (e) => {
      const data = e.inputBuffer.getChannelData(0);
      assistantSession.sendRealtimeInput({ media: createAudioBlob(data) });
    };
    source.connect(processor);
    processor.connect(assistantInCtx.destination);
    setState({ assistantActive: true });
  } catch (e) {
    console.error(e);
  }
}

function updateTranscriptions(text, type) {
  setState(s => ({ ...s, transcriptions: [...s.transcriptions.slice(-4), { text, type }] }));
}

function stopAssistant() {
  assistantStream?.getTracks().forEach(t => t.stop());
  assistantInCtx?.close();
  assistantOutCtx?.close();
  setState({ assistantActive: false, transcriptions: [] });
}

// --- Rendering Logic ---
function render() {
  const root = document.getElementById('root');
  document.body.className = `${state.isDarkMode ? 'bg-slate-900 text-white' : 'bg-gray-50 text-slate-900'} transition-colors duration-300`;

  root.innerHTML = `
    <div class="h-[100dvh] flex flex-col overflow-hidden">
      <!-- Header -->
      <header class="shrink-0 p-6 flex justify-between items-center border-b ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100 shadow-sm'}">
        <div class="flex items-center gap-3">
          <h1 class="text-3xl font-black text-blue-600">Senior<span class="text-slate-400">Assist</span></h1>
          ${!state.isOnline ? `<span class="bg-red-50 text-red-600 px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-widest border border-red-200">Offline</span>` : ''}
        </div>
        <button id="toggle-dark-mode-header" class="p-3 rounded-full ${state.isDarkMode ? 'bg-slate-800 text-yellow-400' : 'bg-gray-100 text-slate-500'}">
          ${state.isDarkMode ? ICONS.sun : ICONS.moon}
        </button>
      </header>

      <!-- Content Area -->
      <main class="flex-1 overflow-y-auto px-6 pt-4 pb-24 max-w-2xl mx-auto w-full custom-scrollbar view-transition">
        ${renderActiveTab()}
      </main>

      <!-- Bottom Navigation -->
      <nav class="shrink-0 px-4 pb-8 pt-4 flex justify-around items-center border-t ${state.isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-gray-100 shadow-lg'} fixed bottom-0 left-0 right-0 z-40">
        ${['home', 'meds', 'emergency', 'settings'].map(tab => `
          <button data-tab="${tab}" class="flex flex-col items-center gap-1 transition-all ${state.activeTab === tab ? 'text-blue-600 scale-110' : 'text-gray-400'}">
            <div class="p-2 rounded-2xl ${state.activeTab === tab ? 'bg-blue-50' : ''}">
              ${ICONS[tab]}
            </div>
            <span class="text-[10px] font-black uppercase tracking-wider">${tab}</span>
          </button>
        `).join('')}
      </nav>

      <!-- Assistant Modal -->
      ${state.showAssistant ? renderAssistantModal() : ''}
    </div>
  `;

  attachEvents();
}

function renderActiveTab() {
  if (state.activeTab === 'home') return renderHome();
  if (state.activeTab === 'meds') return renderMeds();
  if (state.activeTab === 'emergency') return renderEmergency();
  if (state.activeTab === 'settings') return renderSettings();
  return renderHome();
}

function renderHome() {
  const upcoming = state.medicines.filter(m => !m.taken);
  return `
    <div class="space-y-8 animate-in fade-in duration-500">
      <section class="bg-blue-600 p-8 rounded-[40px] text-white shadow-2xl relative overflow-hidden">
        <h2 class="text-4xl font-black mb-2">Good Day!</h2>
        <p class="text-xl opacity-90 font-medium">How are you feeling today?</p>
        <button id="open-assistant" class="mt-8 flex items-center gap-4 bg-white text-blue-600 px-8 py-5 rounded-full font-black text-2xl shadow-xl active:scale-95 transition-transform ${!state.isOnline ? 'opacity-50' : ''}">
          ${ICONS.mic} Talk to Me
        </button>
        <div class="absolute -right-10 -bottom-10 opacity-10 rotate-12 scale-150">
          ${ICONS.home}
        </div>
      </section>

      <section class="grid grid-cols-2 gap-5">
        <div data-tab-btn="meds" class="p-7 rounded-[40px] ${state.isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-blue-50'} border-2 shadow-sm flex flex-col gap-5 cursor-pointer active:scale-95 transition-all">
          <div class="w-16 h-16 bg-blue-100 rounded-3xl flex items-center justify-center text-blue-600">${ICONS.meds}</div>
          <div><h3 class="text-2xl font-black">Meds</h3><p class="${state.isDarkMode ? 'text-gray-400' : 'text-gray-500'} font-bold">${upcoming.length} remaining</p></div>
        </div>
        <div data-tab-btn="emergency" class="p-7 rounded-[40px] ${state.isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-red-50'} border-2 shadow-sm flex flex-col gap-5 cursor-pointer active:scale-95 transition-all">
          <div class="w-16 h-16 bg-red-100 rounded-3xl flex items-center justify-center text-red-500">${ICONS.emergency}</div>
          <div><h3 class="text-2xl font-black">Help</h3><p class="${state.isDarkMode ? 'text-gray-400' : 'text-gray-500'} font-bold">Panic Alarm</p></div>
        </div>
      </section>

      ${upcoming.length > 0 ? `
        <div class="flex justify-between items-end px-2">
           <h3 class="text-2xl font-black">Upcoming</h3>
           <span class="text-blue-500 font-black uppercase text-xs tracking-widest">Next dose</span>
        </div>
        <div class="space-y-4">
          ${upcoming.map(m => `
            <div class="p-7 rounded-[40px] border-2 border-dashed ${state.isDarkMode ? 'border-slate-700 bg-slate-800/50' : 'border-blue-100 bg-white'} flex justify-between items-center cursor-pointer active:bg-blue-50 transition-colors" onclick="window.toggleMed('${m.id}')">
              <div>
                <p class="text-blue-500 font-black uppercase text-xs mb-1 tracking-widest">${m.time}</p>
                <h4 class="text-2xl font-black">${m.name}</h4>
                <p class="text-gray-400 text-sm font-bold">${m.dosage || '1 unit'}</p>
              </div>
              <div class="w-12 h-12 rounded-full border-4 border-blue-100 flex items-center justify-center">
                 <div class="w-6 h-6 rounded-full bg-blue-50"></div>
              </div>
            </div>
          `).join('')}
        </div>
      ` : `
        <div class="p-10 text-center border-2 border-dashed border-gray-200 rounded-[40px]">
           <p class="text-gray-400 font-black">All medicines taken! Great job.</p>
        </div>
      `}
    </div>
  `;
}

function renderEmergency() {
  return `
    <div class="space-y-8 animate-in slide-in-from-bottom-8 duration-500">
      <div class="text-center">
         <h2 class="text-4xl font-black">Emergency</h2>
         <p class="text-gray-500 font-bold mt-1">Get help instantly (Works Offline)</p>
      </div>

      <button id="panic-btn" class="w-full py-16 rounded-[60px] shadow-2xl flex flex-col items-center justify-center gap-6 border-b-[12px] transition-all active:scale-95 ${state.isAlarmActive ? 'bg-red-600 border-red-800 animate-pulse ring-[20px] ring-red-100' : 'bg-red-500 border-red-700'}">
        <div class="p-8 bg-white/20 rounded-full text-white scale-125">${ICONS.alert}</div>
        <span class="text-white text-4xl font-black uppercase tracking-tighter">${state.isAlarmActive ? 'STOP ALARM' : 'PANIC ALARM'}</span>
      </button>

      <div class="flex justify-between items-center px-2">
         <h3 class="text-2xl font-black">Quick Contacts</h3>
         <button id="add-contact-btn" class="p-2 text-blue-600">${ICONS.plus}</button>
      </div>

      <div class="grid gap-4">
        ${state.contacts.map(c => `
          <div class="flex items-center gap-5 p-7 rounded-[44px] ${state.isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100'} border-2 shadow-sm">
            <div class="p-5 rounded-3xl ${c.isDoctor ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-slate-700'}">
              ${c.isDoctor ? ICONS.heart : ICONS.user}
            </div>
            <div class="flex-1 overflow-hidden">
              <span class="text-[10px] font-black uppercase tracking-widest ${c.isDoctor ? 'text-blue-500' : 'text-gray-400'}">${c.relation}</span>
              <h4 class="text-2xl font-black truncate">${c.name}</h4>
              <p class="text-gray-400 font-bold text-sm">${c.phone}</p>
            </div>
            <a href="tel:${c.phone}" class="bg-green-500 text-white p-5 rounded-full shadow-lg shadow-green-100 active:scale-90 transition-transform">
              ${ICONS.phone}
            </a>
          </div>
        `).join('')}
      </div>

      <div class="p-8 bg-blue-50 rounded-[40px] border-2 border-blue-100 text-center">
         <p class="text-blue-800 font-bold italic">Panic Alarm and contacts are available even without internet.</p>
      </div>
    </div>
  `;
}

function renderMeds() {
  const slots = ['Morning', 'Afternoon', 'Evening', 'Night'];
  return `
    <div class="space-y-6 animate-in slide-in-from-right-8 duration-500">
      <div class="flex justify-between items-center">
        <h2 class="text-4xl font-black">Medicines</h2>
        <button id="show-add-med" class="bg-blue-600 text-white p-5 rounded-full shadow-xl active:rotate-90 transition-transform">${ICONS.plus}</button>
      </div>
      
      <div id="add-med-form" class="hidden bg-white p-8 rounded-[44px] border-2 border-blue-100 shadow-2xl space-y-5 animate-in zoom-in-95">
        <h4 class="text-2xl font-black text-slate-800">Add New Pill</h4>
        <input id="new-med-name" type="text" placeholder="Pill Name (e.g. Vitamin C)" class="w-full p-5 rounded-2xl bg-gray-50 border-2 border-transparent focus:border-blue-500 outline-none text-xl font-bold">
        <div class="grid grid-cols-2 gap-3">
           ${slots.map(s => `
             <button onclick="document.querySelectorAll('.time-btn').forEach(b=>b.classList.remove('bg-blue-600','text-white')); this.classList.add('bg-blue-600','text-white'); window.selectedTime='${s}'" class="time-btn p-4 rounded-xl border-2 font-bold transition-all">${s}</button>
           `).join('')}
        </div>
        <button id="save-med" class="w-full bg-blue-600 text-white py-6 rounded-2xl font-black text-2xl shadow-xl active:scale-95 transition-all">SAVE MEDICATION</button>
      </div>

      <div class="space-y-4">
        ${state.medicines.map(m => `
          <div class="flex items-center justify-between p-7 rounded-[44px] border-2 transition-all ${m.taken ? 'bg-green-50 border-green-200' : (state.isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-100')}">
            <div class="flex items-center gap-5 flex-1 cursor-pointer" onclick="window.toggleMed('${m.id}')">
              <div class="w-12 h-12 rounded-full border-4 ${m.taken ? 'bg-green-500 border-green-200' : 'border-gray-100'} flex items-center justify-center transition-all">
                ${m.taken ? '<span class="text-white">✓</span>' : ''}
              </div>
              <div>
                <h4 class="text-2xl font-black ${m.taken ? 'line-through text-gray-400' : ''}">${m.name}</h4>
                <div class="flex items-center gap-2 text-blue-500">
                   <div class="w-2 h-2 rounded-full bg-blue-500"></div>
                   <p class="font-black text-xs uppercase tracking-widest">${m.time}</p>
                </div>
              </div>
            </div>
            <button onclick="window.deleteMed('${m.id}')" class="p-4 text-red-300 hover:text-red-500 transition-colors">${ICONS.trash}</button>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderSettings() {
  return `
    <div class="space-y-8 animate-in fade-in duration-500">
      <div class="text-center">
         <h2 class="text-4xl font-black">Settings</h2>
         <p class="text-gray-500 font-bold mt-1">App preferences</p>
      </div>

      <div class="bg-white rounded-[44px] ${state.isDarkMode ? 'bg-slate-800 border-slate-700' : 'border-gray-100'} border-2 overflow-hidden shadow-sm">
         <div class="p-8 flex items-center justify-between border-b ${state.isDarkMode ? 'border-slate-700' : 'border-gray-100'}">
            <div class="flex items-center gap-4">
               <div class="p-4 bg-yellow-100 text-yellow-600 rounded-2xl">${ICONS.sun}</div>
               <div><h4 class="text-xl font-black">Dark Mode</h4><p class="text-gray-400 text-sm font-bold">Better for night use</p></div>
            </div>
            <button id="toggle-dark-mode-settings" class="w-16 h-10 rounded-full ${state.isDarkMode ? 'bg-blue-600' : 'bg-gray-200'} p-1 transition-all">
               <div class="w-8 h-8 bg-white rounded-full shadow-md transition-all ${state.isDarkMode ? 'translate-x-6' : ''}"></div>
            </button>
         </div>

         <div class="p-8 flex items-center justify-between border-b ${state.isDarkMode ? 'border-slate-700' : 'border-gray-100'}">
            <div class="flex items-center gap-4">
               <div class="p-4 bg-blue-100 text-blue-600 rounded-2xl">${ICONS.mic}</div>
               <div><h4 class="text-xl font-black">Voice Feedback</h4><p class="text-gray-400 text-sm font-bold">Audible assistant replies</p></div>
            </div>
            <div class="text-blue-500 font-black">ALWAYS ON</div>
         </div>

         <button onclick="window.resetApp()" class="w-full p-8 flex items-center gap-4 text-left hover:bg-red-50 transition-colors group">
            <div class="p-4 bg-red-100 text-red-600 rounded-2xl group-hover:bg-red-200 transition-colors">${ICONS.trash}</div>
            <div><h4 class="text-xl font-black text-red-600">Reset Data</h4><p class="text-gray-400 text-sm font-bold">Clear all medicines and contacts</p></div>
         </button>
      </div>

      <div class="bg-blue-600 p-8 rounded-[44px] text-white shadow-xl text-center">
         <h4 class="text-2xl font-black mb-1">Senior Assist v1.0</h4>
         <p class="opacity-80 font-bold">Designed for easy accessibility.</p>
         <div class="mt-4 pt-4 border-t border-white/20 text-xs font-black tracking-widest opacity-60">
            MADE FOR SENIORS • OFFLINE ENABLED
         </div>
      </div>
    </div>
  `;
}

function renderAssistantModal() {
  return `
    <div class="fixed inset-0 z-50 bg-blue-600 flex flex-col p-8 text-white animate-in slide-in-from-bottom duration-300">
      <div class="flex justify-end">
        <button id="close-assistant" class="p-4 bg-white/10 rounded-full active:scale-90">
           ${ICONS.x}
        </button>
      </div>
      <div class="flex-1 flex flex-col items-center justify-center text-center space-y-10">
        ${!state.isOnline ? `
          <div class="p-12 bg-white/20 rounded-full">
             <div class="scale-150">${ICONS.sun}</div>
          </div>
          <h2 class="text-4xl font-black">Offline Mode</h2>
          <p class="text-xl opacity-80 font-bold">The Voice Assistant needs internet. Medicine reminders and Alarm work fine offline!</p>
          <button onclick="setState({showAssistant: false})" class="bg-white text-blue-600 px-12 py-5 rounded-full font-black text-2xl">GO BACK</button>
        ` : !state.assistantActive ? `
          <div class="p-12 bg-white/20 rounded-full pulse-blue">
             <div class="scale-150">${ICONS.mic}</div>
          </div>
          <div class="space-y-2">
             <h2 class="text-5xl font-black">Ready</h2>
             <p class="text-xl opacity-80 font-bold">I am listening for you.</p>
          </div>
          <button id="start-voice" class="bg-white text-blue-600 px-16 py-7 rounded-full font-black text-3xl shadow-2xl active:scale-95 transition-transform">START ASSISTANT</button>
        ` : `
          <div class="h-32 flex items-center gap-3">
            ${[1, 2, 3, 4, 5, 6].map(i => `<div class="w-5 bg-white rounded-full animate-bounce" style="height:${30 + Math.random() * 80}px; animation-delay:${i * 0.1}s"></div>`).join('')}
          </div>
          <div class="w-full max-w-lg bg-black/10 p-8 rounded-[50px] space-y-6 text-2xl max-h-[40vh] overflow-y-auto custom-scrollbar">
            ${state.transcriptions.length === 0 ? '<p class="opacity-50 italic">Listening...</p>' : ''}
            ${state.transcriptions.map(t => `
              <div class="${t.type === 'input' ? 'text-right opacity-70 italic text-xl' : 'text-left font-black'} transition-all">${t.text}</div>
            `).join('')}
          </div>
          <button id="stop-voice" class="bg-red-500 text-white px-12 py-6 rounded-full font-black text-2xl shadow-xl active:scale-95">STOP ASSISTANT</button>
        `}
      </div>
      <div class="pb-8 text-center opacity-60 text-sm font-bold">
         Try saying: "Add Vitamin C to my morning schedule"
      </div>
    </div>
  `;
}

// --- Interaction Helpers ---
window.toggleMed = (id) => {
  setState(s => ({ ...s, medicines: s.medicines.map(m => m.id === id ? { ...m, taken: !m.taken } : m) }));
};

window.deleteMed = (id) => {
  setState(s => ({ ...s, medicines: s.medicines.filter(m => m.id !== id) }));
};

window.resetApp = () => {
  if (confirm('Are you sure you want to clear all data?')) {
    localStorage.clear();
    location.reload();
  }
};

function attachEvents() {
  document.getElementById('toggle-dark-mode-header')?.addEventListener('click', () => setState({ isDarkMode: !state.isDarkMode }));
  document.getElementById('toggle-dark-mode-settings')?.addEventListener('click', () => setState({ isDarkMode: !state.isDarkMode }));
  
  document.querySelectorAll('[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.scrollTo(0, 0);
      setState({ activeTab: btn.dataset.tab });
    });
  });

  document.querySelectorAll('[data-tab-btn]').forEach(btn => {
    btn.addEventListener('click', () => {
      window.scrollTo(0, 0);
      setState({ activeTab: btn.dataset.tabBtn });
    });
  });

  document.getElementById('panic-btn')?.addEventListener('click', toggleAlarm);
  document.getElementById('open-assistant')?.addEventListener('click', () => setState({ showAssistant: true }));
  document.getElementById('close-assistant')?.addEventListener('click', () => { stopAssistant(); setState({ showAssistant: false }); });
  document.getElementById('start-voice')?.addEventListener('click', startAssistant);
  document.getElementById('stop-voice')?.addEventListener('click', stopAssistant);

  document.getElementById('show-add-med')?.addEventListener('click', () => {
    const form = document.getElementById('add-med-form');
    form.classList.toggle('hidden');
    form.scrollIntoView({ behavior: 'smooth' });
  });

  document.getElementById('save-med')?.addEventListener('click', () => {
    const name = document.getElementById('new-med-name').value;
    const time = window.selectedTime || 'Morning';
    if (name) {
      setState(s => ({ ...s, medicines: [...s.medicines, { id: Math.random().toString(36).substr(2, 9), name, time, taken: false }] }));
      document.getElementById('new-med-name').value = '';
      document.getElementById('add-med-form').classList.add('hidden');
    }
  });

  // Emergency Add Contact Placeholder
  document.getElementById('add-contact-btn')?.addEventListener('click', () => {
    alert('This feature is coming soon! For now, use the default emergency contacts.');
  });
}

// Init
window.selectedTime = 'Morning';
render();