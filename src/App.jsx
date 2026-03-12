import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as analyticsIsSupported } from "firebase/analytics";
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { 
  getFirestore, collection, onSnapshot, addDoc, doc, setDoc, deleteDoc, updateDoc
} from 'firebase/firestore';

// --- Firebase Initialization ---
// GitHub Pages does NOT provide `__initial_auth_token` / `__app_id`.
// Keep the config in-code for now, but make runtime behavior robust.
const firebaseConfig = {
  apiKey: "AIzaSyC0nI2JVHGbO0CUywA4Xa28dBWPo5DHxNA",
  authDomain: "new-customers-eee3a.firebaseapp.com",
  projectId: "new-customers-eee3a",
  storageBucket: "new-customers-eee3a.firebasestorage.app",
  messagingSenderId: "16173551692",
  appId: "1:16173551692:web:6e7f98af195c7d7c56e4e9",
  measurementId: "G-0EH8V9MP1C"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
void (async () => {
  try {
    if (await analyticsIsSupported()) {
      getAnalytics(app);
    }
  } catch {
    // Analytics is optional; avoid breaking the app if it isn't supported.
  }
})();
const auth = getAuth(app);
const db = getFirestore(app);
const appId =
  (import.meta?.env?.VITE_FIREBASE_APP_ID?.trim?.() || '') ||
  (typeof __app_id !== 'undefined' ? __app_id : '') ||
  'displate-workshop';

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('intro');
  const [firebaseError, setFirebaseError] = useState(null);
  
  // Collaborative State
  const [badIdeas, setBadIdeas] = useState([]);
  const [errcIdeas, setErrcIdeas] = useState([]);
  const [pitches, setPitches] = useState([]);
  const [workshopState, setWorkshopState] = useState({ 
    topThree: [], 
    timer: { isRunning: false, remaining: 10800000, targetEndTime: 0 } // 3 hours in ms
  });

  // Local UI State
  const [newBadIdea, setNewBadIdea] = useState('');
  const [errcInputs, setErrcInputs] = useState({ eliminate: '', reduce: '', raise: '', create: '' });
  const [pitchForm, setPitchForm] = useState({ name: '', concept: '', audience: '', impact: 'CAC' });
  const [flippedCards, setFlippedCards] = useState({});
  const [timerDisplay, setTimerDisplay] = useState('03:00:00');

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  // --- 1. Authentication ---
  useEffect(() => {
    const initAuth = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        setFirebaseError(err);
        console.error("Authentication failed:", err);
      }
    };
    initAuth();
    const unsub = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsub();
  }, []);

  // --- 2. Real-time Data Sync ---
  useEffect(() => {
    if (!user) return;

    // Listen to Anti-Problem Ideas
    const badIdeasRef = collection(db, 'artifacts', appId, 'public', 'data', 'bad_ideas');
    const unsubBad = onSnapshot(badIdeasRef, (snap) => {
      setBadIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt));
    }, (err) => {
      setFirebaseError(err);
      console.error(err);
    });

    // Listen to ERRC Grid
    const errcRef = collection(db, 'artifacts', appId, 'public', 'data', 'errc_ideas');
    const unsubErrc = onSnapshot(errcRef, (snap) => {
      setErrcIdeas(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt));
    }, (err) => {
      setFirebaseError(err);
      console.error(err);
    });

    // Listen to Pitches
    const pitchesRef = collection(db, 'artifacts', appId, 'public', 'data', 'pitches');
    const unsubPitches = onSnapshot(pitchesRef, (snap) => {
      setPitches(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => b.createdAt - a.createdAt));
    }, (err) => {
      setFirebaseError(err);
      console.error(err);
    });

    // Listen to Global Workshop State (Timer & Top 3)
    const stateRef = doc(db, 'artifacts', appId, 'public', 'data', 'workshop_state', 'global');
    const unsubState = onSnapshot(stateRef, (docSnap) => {
      if (docSnap.exists()) {
        setWorkshopState(docSnap.data());
      } else {
        // Initialize if it doesn't exist
        setDoc(stateRef, { 
          topThree: [], 
          timer: { isRunning: false, remaining: 10800000, targetEndTime: 0 } 
        });
      }
    }, (err) => {
      setFirebaseError(err);
      console.error(err);
    });

    return () => { unsubBad(); unsubErrc(); unsubPitches(); unsubState(); };
  }, [user]);

  // --- 3. Timer Logic ---
  useEffect(() => {
    const interval = setInterval(() => {
      let ms = workshopState.timer.remaining;
      if (workshopState.timer.isRunning) {
        ms = Math.max(0, workshopState.timer.targetEndTime - Date.now());
      }
      
      const hrs = Math.floor(ms / 3600000);
      const mins = Math.floor((ms % 3600000) / 60000);
      const secs = Math.floor((ms % 60000) / 1000);
      setTimerDisplay(`${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`);
    }, 500);
    return () => clearInterval(interval);
  }, [workshopState.timer]);

  const toggleTimer = async () => {
    if (!user) return;
    const stateRef = doc(db, 'artifacts', appId, 'public', 'data', 'workshop_state', 'global');
    
    let newTimerState = { ...workshopState.timer };
    if (newTimerState.isRunning) {
      // Pause it
      newTimerState.remaining = Math.max(0, newTimerState.targetEndTime - Date.now());
      newTimerState.isRunning = false;
    } else {
      // Start it
      newTimerState.targetEndTime = Date.now() + newTimerState.remaining;
      newTimerState.isRunning = true;
    }
    
    await updateDoc(stateRef, { timer: newTimerState });
  };

  // --- 4. Chart.js Injection & Initialization ---
  useEffect(() => {
    if (activeTab === 'intro') {
      const renderChart = () => {
        if (chartInstance.current) {
          chartInstance.current.destroy();
        }
        if (chartRef.current && window.Chart) {
          const ctx = chartRef.current.getContext('2d');
          chartInstance.current = new window.Chart(ctx, {
            type: 'line',
            data: {
              labels: ['2020', '2021', '2022', '2023', '2024', '2025', '2026', '2027 (Proj)', '2028 (Proj)'],
              datasets: [
                {
                  label: 'Legacy Funnel CAC New Orders ($)',
                  data: [11.6, 45.9, 54.5, 65.3, 66.8, 74.2, 79.3, 85.0, 92.5],
                  borderColor: '#6B6B6A',
                  backgroundColor: 'rgba(107, 107, 106, 0.1)',
                  borderWidth: 2,
                  fill: false,
                  tension: 0.2,
                  pointBackgroundColor: '#6B6B6A',
                  borderDash: [5, 5]
                },
                {
                  label: 'AI-Centric Ecosystem Target ($)',
                  data: [null, null, null, null, null, null, 79.3, 58.0, 42.0],
                  borderColor: '#0062FF',
                  backgroundColor: 'rgba(0, 98, 255, 0.15)',
                  borderWidth: 4,
                  fill: false,
                  tension: 0.2,
                  pointBackgroundColor: '#D9FF00',
                  pointBorderColor: '#0E0E0E',
                  pointRadius: 6,
                  pointHoverRadius: 8
                }
              ]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { position: 'top', labels: { font: { family: 'Inter', weight: 'bold' }, color: '#1B1B1B' } }
              },
              scales: {
                x: { ticks: { font: { family: 'Inter', weight: '600' }, color: '#6B6B6A' }, grid: { color: 'rgba(107, 107, 106, 0.1)' } },
                y: { beginAtZero: true, title: { display: true, text: 'Customer Acquisition Cost ($)', font: { family: 'Inter', weight: 'bold' }, color: '#1B1B1B' }, ticks: { font: { family: 'Inter', weight: '600' }, color: '#6B6B6A' } }
              }
            }
          });
        }
      };

      if (!window.Chart) {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/chart.js';
        script.onload = renderChart;
        document.head.appendChild(script);
      } else {
        renderChart();
      }
    }
  }, [activeTab]);

  // --- 5. Data Mutators ---
  const handleAddBadIdea = async () => {
    if (!newBadIdea.trim() || !user) return;
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'bad_ideas'), {
      text: newBadIdea.trim(),
      createdAt: Date.now(),
      author: user.uid.substring(0, 6)
    });
    setNewBadIdea('');
  };

  const handleAddErrc = async (category) => {
    if (!errcInputs[category].trim() || !user) return;
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'errc_ideas'), {
      category,
      text: errcInputs[category].trim(),
      createdAt: Date.now()
    });
    setErrcInputs(prev => ({ ...prev, [category]: '' }));
  };

  const handleAddPitch = async () => {
    if (!pitchForm.name.trim() || !pitchForm.concept.trim() || !user) {
      alert("Name and Concept are required.");
      return;
    }
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'pitches'), {
      ...pitchForm,
      createdAt: Date.now()
    });
    setPitchForm({ name: '', concept: '', audience: '', impact: 'CAC' });
    alert("Pitch submitted to the board globally!");
  };

  const toggleTopThree = async (pitch) => {
    if (!user) return;
    const stateRef = doc(db, 'artifacts', appId, 'public', 'data', 'workshop_state', 'global');
    let currentTop = [...workshopState.topThree];
    
    const index = currentTop.findIndex(p => p.id === pitch.id);
    
    if (index >= 0) {
      // Remove it
      currentTop.splice(index, 1);
    } else {
      // Add it
      if (currentTop.length >= 3) {
        alert("Top 3 limit reached. Remove an idea first to promote a new one.");
        return;
      }
      currentTop.push({ id: pitch.id, name: pitch.name, concept: pitch.concept });
    }
    
    await updateDoc(stateRef, { topThree: currentTop });
  };

  const navClass = (tabId) => `px-3 py-2 rounded-md text-sm font-bold transition-colors ${activeTab === tabId ? 'bg-[#1B1B1B] text-[#D9FF00]' : 'text-white hover:text-[#D9FF00]'}`;

  // Custom Displate Theme Colors mapping for inline styles where arbitrary Tailwind is complex
  const colors = {
    white: '#FFFFFF', alabaster: '#F4F7F3', dimGrey: '#6B6B6A', eerieBlack: '#1B1B1B', nightBlack: '#0E0E0E',
    blue: '#0062FF', blueHi: '#E7F0FF', blueDeep: '#0047B3',
    red: '#FF0000', redHi: '#FFF1F1', redDeep: '#B30000',
    cyan: '#00E0FF', cyanHi: '#E0FBFF', cyanDeep: '#00A3BA',
    orange: '#FF8A00', orangeHi: '#FFF4E6', orangeDeep: '#B36100',
    magenta: '#FF00FF', magentaHi: '#FFE6FF', magentaDeep: '#B300B3',
    lime: '#D9FF00', limeHi: '#FAFFEB', limeDeep: '#99B300'
  };

  return (
    <div className="antialiased min-h-screen flex flex-col relative overflow-x-hidden" style={{ backgroundColor: colors.alabaster, color: colors.eerieBlack, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {firebaseError && (
        <div className="w-full text-sm font-bold px-4 py-3 border-b-4" style={{ backgroundColor: colors.redHi, borderColor: colors.red, color: colors.redDeep }}>
          Firebase error: {firebaseError?.code ? `${firebaseError.code} — ` : ''}{firebaseError?.message || String(firebaseError)}
        </div>
      )}
      
      {/* Global CSS for specifics */}
      <style>{`
        .font-heading { font-family: 'Polymath Display Black', Inter, system-ui, sans-serif; font-weight: 900; text-transform: uppercase; letter-spacing: -0.02em; }
        ::-webkit-scrollbar { width: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #6B6B6A; border-radius: 3px; }
        .glass-panel { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(12px); border: 1px solid #6B6B6A; }
        .chart-container { position: relative; width: 100%; max-width: 900px; margin: 0 auto; height: 400px; max-height: 450px; }
        @media (max-width: 640px) { .chart-container { height: 250px; } }
        
        .flip-card { perspective: 1000px; height: 320px; cursor: pointer; }
        .flip-card-inner { position: relative; width: 100%; height: 100%; transition: transform 0.6s; transform-style: preserve-3d; }
        .flip-card.flipped .flip-card-inner { transform: rotateY(180deg); }
        .flip-card-front, .flip-card-back { position: absolute; width: 100%; height: 100%; -webkit-backface-visibility: hidden; backface-visibility: hidden; }
        .flip-card-back { transform: rotateY(180deg); }
      `}</style>

      {/* Navigation */}
      <nav className="sticky top-0 z-50 shadow-md border-b-4" style={{ backgroundColor: colors.nightBlack, borderColor: colors.blue }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex-shrink-0 flex items-center gap-2 text-white">
              <span className="text-2xl">⚡</span>
              <span className="font-heading text-xl tracking-wider">DISPLATE <span style={{ color: colors.blue }}>AI SPRINT</span></span>
            </div>
            <div className="hidden md:flex space-x-1 overflow-x-auto">
              <button onClick={() => setActiveTab('intro')} className={navClass('intro')}>1. The Mandate</button>
              <button onClick={() => setActiveTab('ex1')} className={navClass('ex1')}>2. Anti-Problem</button>
              <button onClick={() => setActiveTab('ex2')} className={navClass('ex2')}>3. ERRC Grid</button>
              <button onClick={() => setActiveTab('ex3')} className={navClass('ex3')}>4. The AI Pitch</button>
              <button onClick={() => setActiveTab('finale')} className={navClass('finale')}>5. Top 3 Actions</button>
            </div>
          </div>
        </div>
      </nav>

      {/* Floating Timer */}
      <div className="fixed bottom-4 right-4 z-50">
        <div className="glass-panel p-3 rounded-lg shadow-lg flex items-center gap-3">
          <span className="text-xl">⏱️</span>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider leading-none" style={{ color: colors.dimGrey }}>Global Sprint Timer</div>
            <div className="text-xl font-heading leading-none mt-1" style={{ color: colors.nightBlack }}>{timerDisplay}</div>
          </div>
          <button 
            onClick={toggleTimer} 
            className="font-bold px-3 py-1 rounded text-xs ml-2 uppercase tracking-wide transition"
            style={{ 
              backgroundColor: workshopState.timer.isRunning ? colors.red : colors.eerieBlack,
              color: workshopState.timer.isRunning ? colors.white : colors.lime
            }}
          >
            {workshopState.timer.isRunning ? 'Pause' : 'Start'}
          </button>
        </div>
      </div>

      <main className="flex-grow max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full relative">
        
        {/* --- SECTION 1: INTRO --- */}
        {activeTab === 'intro' && (
          <section className="animate-fade-in block">
            <header className="mb-12 text-center">
              <h1 className="text-5xl md:text-7xl font-heading mb-4" style={{ color: colors.nightBlack }}>Cracking New Fandoms</h1>
              <h2 className="text-2xl font-bold mb-6 uppercase tracking-wide" style={{ color: colors.blue }}>AI-Powered Customer Acquisition Strategy</h2>
              <p className="max-w-3xl mx-auto text-lg leading-relaxed font-semibold" style={{ color: colors.dimGrey }}>
                Welcome to the collaborative war room. This instance is synced in real-time. In the next 3 hours, our mission is to engineer novel, AI-centric pathways to acquire new Displate collectors. 
              </p>
            </header>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
              {[ 
                { icon: '🧠', title: 'The Shift', desc: 'Moving from "targeting audiences" to "algorithmic matchmaking." Using AI to understand aesthetic preferences before the first click.' },
                { icon: '📐', title: 'The Frameworks', desc: 'We will use Reverse Brainstorming and Blue Ocean ERRC grids to break out of incremental improvements and find exponential growth.' },
                { icon: '🚀', title: 'The Output', desc: 'We leave this room with a finalized Top 3 Action Plan. All work is saved automatically to the collective board.' }
              ].map((card, i) => (
                <div key={i} className="bg-white p-6 rounded-xl shadow border-2" style={{ borderColor: colors.nightBlack }}>
                  <div className="text-4xl mb-3">{card.icon}</div>
                  <h3 className="font-heading text-xl mb-2" style={{ color: colors.nightBlack }}>{card.title}</h3>
                  <p className="text-sm font-medium" style={{ color: colors.dimGrey }}>{card.desc}</p>
                </div>
              ))}
            </div>

            <div className="bg-white p-8 rounded-xl shadow border-2 mb-8 relative overflow-hidden" style={{ borderColor: colors.eerieBlack }}>
              <div className="absolute top-0 right-0 w-48 h-48 rounded-bl-[100px] -z-10" style={{ backgroundColor: colors.blueHi }}></div>
              <h3 className="text-3xl font-heading mb-2" style={{ color: colors.nightBlack }}>The Burning Platform: Actual CAC Growth</h3>
              <p className="mb-6 font-medium" style={{ color: colors.dimGrey }}>Look at our historical <strong style={{ color: colors.nightBlack }}>CAC New Orders</strong> metric. The grey line shows the projected continuation. The blue line represents the paradigm shift required.</p>
              
              <div className="chart-container z-10">
                <canvas ref={chartRef}></canvas>
              </div>
            </div>
            
            <div className="text-center mt-10">
              <button onClick={() => setActiveTab('ex1')} className="font-heading text-xl py-4 px-10 rounded-sm shadow-xl transition transform hover:-translate-y-1 text-white" style={{ backgroundColor: colors.blue }}>Initialize Exercise 1 ➡️</button>
            </div>
          </section>
        )}

        {/* --- SECTION 2: ANTI-PROBLEM --- */}
        {activeTab === 'ex1' && (
          <section className="animate-fade-in block">
             <div className="mb-8 border-l-8 pl-6" style={{ borderColor: colors.magenta }}>
                <span className="inline-block text-xs px-3 py-1 rounded font-bold uppercase tracking-widest mb-3" style={{ backgroundColor: colors.magentaHi, color: colors.magentaDeep }}>Phase 1 • 45 Minutes</span>
                <h2 className="text-4xl font-heading mb-4" style={{ color: colors.nightBlack }}>Exercise 1: The Anti-Problem</h2>
                <p className="text-lg font-medium" style={{ color: colors.dimGrey }}>
                    <strong>The Technique:</strong> To solve a tough problem, we try to cause it. How do we guarantee a potential customer bounces instantly?
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {[
                { id: 'c1', icon: '🌀', bad: 'The Infinite Void', bDesc: 'Drop a visitor onto a page with 1.5 million posters. Zero context. Force manual search.', goodIcon: '🔮', good: 'AI Taste Profiling', gDesc: 'A "Tinder for Art" sequence. Users swipe abstract images to build a 100%-match storefront.' },
                { id: 'c2', icon: '🧱', bad: 'The Blank Wall', bDesc: 'Show the product purely on a flat white background. Leave the customer guessing.', goodIcon: '🛋️', good: 'Generative Context', gDesc: 'User uploads a wall snap. AI scales via web-AR, adjusts lighting, and suggests pairings.' },
                { id: 'c3', icon: '🥱', bad: 'The Echo Chamber', bDesc: 'Serve exact same static creative to every single user, ignoring micro-trends.', goodIcon: '🎨', good: 'Dynamic Creative', gDesc: 'AI ad engine combines local weather, trends, and micro-interests to generate bespoke ads.' }
              ].map((card) => (
                <div key={card.id} className={`flip-card ${flippedCards[card.id] ? 'flipped' : ''}`} onClick={() => setFlippedCards(p => ({...p, [card.id]: !p[card.id]}))}>
                  <div className="flip-card-inner">
                    <div className="flip-card-front bg-white p-6 rounded-sm shadow border-2 flex flex-col justify-center items-center text-center transition" style={{ borderColor: colors.dimGrey }}>
                      <span className="text-6xl mb-4">{card.icon}</span>
                      <h3 className="font-heading text-2xl mb-3" style={{ color: colors.nightBlack }}>{card.bad}</h3>
                      <p className="font-medium" style={{ color: colors.dimGrey }}>{card.bDesc}</p>
                      <p className="text-sm font-bold mt-6 uppercase tracking-wider" style={{ color: colors.magenta }}>(Click to Flip)</p>
                    </div>
                    <div className="flip-card-back p-6 rounded-sm shadow flex flex-col justify-center items-center text-center text-white border-2" style={{ backgroundColor: colors.magenta, borderColor: colors.nightBlack }}>
                      <span className="text-6xl mb-4">{card.goodIcon}</span>
                      <h3 className="font-heading text-2xl mb-3">{card.good}</h3>
                      <p className="font-medium text-white">{card.gDesc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 bg-white p-8 rounded-sm shadow border-2" style={{ borderColor: colors.nightBlack }}>
                <h3 className="font-heading text-2xl mb-4">Live Team Input: What else breaks our funnel?</h3>
                <div className="flex flex-col md:flex-row gap-4 mb-6">
                    <input 
                      type="text" 
                      value={newBadIdea}
                      onChange={(e) => setNewBadIdea(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddBadIdea()}
                      placeholder="Enter a guaranteed conversion killer..." 
                      className="flex-grow p-4 border-2 rounded-sm focus:outline-none font-medium text-lg"
                      style={{ borderColor: colors.dimGrey }}
                    />
                    <button onClick={handleAddBadIdea} className="text-white font-heading text-xl px-8 py-4 rounded-sm transition uppercase tracking-wide" style={{ backgroundColor: colors.nightBlack }}>Add Anti-Idea</button>
                </div>
                
                <div className="space-y-3">
                  {badIdeas.map(idea => (
                    <div key={idea.id} className="p-4 rounded-sm border-2 font-bold flex flex-col md:flex-row justify-between items-start md:items-center gap-2" style={{ backgroundColor: colors.alabaster, borderColor: colors.dimGrey, color: colors.nightBlack }}>
                      <span>❌ {idea.text}</span>
                      <span className="text-xs px-2 py-1 bg-white border rounded text-gray-500">Added by {idea.author}</span>
                    </div>
                  ))}
                  {badIdeas.length === 0 && <p className="text-gray-400 italic">Awaiting team inputs...</p>}
                </div>
            </div>

            <div className="flex justify-between mt-12 items-center">
                <button onClick={() => setActiveTab('intro')} className="font-bold py-3 px-6 uppercase tracking-wide" style={{ color: colors.dimGrey }}>⬅️ Back</button>
                <button onClick={() => setActiveTab('ex2')} className="text-white font-heading text-xl py-4 px-10 rounded-sm shadow-xl transition transform hover:-translate-y-1" style={{ backgroundColor: colors.magenta }}>Proceed to ERRC Grid ➡️</button>
            </div>
          </section>
        )}

        {/* --- SECTION 3: ERRC GRID --- */}
        {activeTab === 'ex2' && (
          <section className="animate-fade-in block">
            <div className="mb-8 border-l-8 pl-6" style={{ borderColor: colors.cyan }}>
                <span className="inline-block text-xs px-3 py-1 rounded font-bold uppercase tracking-widest mb-3" style={{ backgroundColor: colors.cyanHi, color: colors.cyanDeep }}>Phase 2 • 45 Minutes</span>
                <h2 className="text-4xl font-heading mb-4" style={{ color: colors.nightBlack }}>Exercise 2: Blue Ocean ERRC Grid</h2>
                <p className="text-lg font-medium" style={{ color: colors.dimGrey }}>
                    How can AI help us systematically create a "Blue Ocean" of uncontested market space? Add ideas collaboratively below.
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 h-auto md:h-[700px] mb-8">
              
              {[
                { id: 'eliminate', title: 'Eliminate', icon: '🗑️', q: 'What industry standards should we completely eliminate?', bg: colors.redHi, line: colors.red, deep: colors.redDeep },
                { id: 'reduce', title: 'Reduce', icon: '📉', q: 'What factors should be reduced well below industry standards?', bg: colors.orangeHi, line: colors.orange, deep: colors.orangeDeep },
                { id: 'raise', title: 'Raise', icon: '📈', q: 'What should be raised well above the industry standard?', bg: colors.blueHi, line: colors.blue, deep: colors.blueDeep },
                { id: 'create', title: 'Create', icon: '✨', q: 'What factors should be created that the industry has never offered?', bg: colors.limeHi, line: colors.lime, deep: colors.limeDeep }
              ].map(grid => (
                <div key={grid.id} className="p-6 shadow flex flex-col rounded-sm border-x border-b border-t-8" style={{ backgroundColor: grid.bg, borderTopColor: grid.line, borderColor: 'rgba(107,107,106,0.2)' }}>
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-3xl font-heading" style={{ color: grid.deep }}>{grid.title}</h3>
                        <span className="text-3xl">{grid.icon}</span>
                    </div>
                    <p className="text-sm font-bold mb-4" style={{ color: colors.eerieBlack }}>{grid.q}</p>
                    <ul className="list-disc list-inside font-medium space-y-3 flex-grow overflow-y-auto" style={{ color: colors.nightBlack }}>
                        {errcIdeas.filter(i => i.category === grid.id).map(idea => (
                          <li key={idea.id} className="break-words leading-tight">{idea.text}</li>
                        ))}
                    </ul>
                    <div className="mt-4 flex gap-2">
                        <input 
                          type="text" 
                          value={errcInputs[grid.id]}
                          onChange={(e) => setErrcInputs(p => ({...p, [grid.id]: e.target.value}))}
                          onKeyDown={(e) => e.key === 'Enter' && handleAddErrc(grid.id)}
                          className="text-sm p-3 w-full border-2 rounded-sm outline-none" 
                          style={{ borderColor: `${grid.line}50` }}
                          placeholder="Add idea to board..." 
                        />
                        <button onClick={() => handleAddErrc(grid.id)} className="text-white font-bold px-4 py-2 rounded-sm text-xl" style={{ backgroundColor: grid.line }}>+</button>
                    </div>
                </div>
              ))}
            </div>

            <div className="flex justify-between mt-10 items-center">
                <button onClick={() => setActiveTab('ex1')} className="font-bold py-3 px-6 uppercase tracking-wide" style={{ color: colors.dimGrey }}>⬅️ Back</button>
                <button onClick={() => setActiveTab('ex3')} className="font-heading text-xl py-4 px-10 rounded-sm shadow-xl transition transform hover:-translate-y-1" style={{ backgroundColor: colors.cyan, color: colors.nightBlack }}>Next: The Pitch ➡️</button>
            </div>
          </section>
        )}

        {/* --- SECTION 4: THE PITCH --- */}
        {activeTab === 'ex3' && (
          <section className="animate-fade-in block">
            <div className="mb-8 border-l-8 pl-6" style={{ borderColor: colors.orange }}>
                <span className="inline-block text-xs px-3 py-1 rounded font-bold uppercase tracking-widest mb-3" style={{ backgroundColor: colors.orangeHi, color: colors.orangeDeep }}>Phase 3 • 30 Minutes</span>
                <h2 className="text-4xl font-heading mb-4" style={{ color: colors.nightBlack }}>Exercise 3: The AI Value Pitch</h2>
                <p className="text-lg font-medium" style={{ color: colors.dimGrey }}>
                    Document your squad's primary initiative pitch. Once submitted, it will become available on the global Final Board for review and promotion.
                </p>
            </div>

            <div className="max-w-3xl mx-auto bg-white p-10 rounded-sm shadow-xl border-4 relative" style={{ borderColor: colors.nightBlack }}>
                <div className="absolute -top-4 -right-4 font-heading px-4 py-1 text-xl border-2 rotate-3 shadow-md" style={{ backgroundColor: colors.lime, borderColor: colors.nightBlack, color: colors.nightBlack }}>NEW INITIATIVE</div>
                
                <div className="mb-8 border-b-2 pb-4" style={{ borderColor: colors.dimGrey }}>
                    <label className="block text-sm font-bold uppercase tracking-widest mb-2" style={{ color: colors.orange }}>Initiative Code Name</label>
                    <input 
                      type="text" 
                      value={pitchForm.name}
                      onChange={(e) => setPitchForm({...pitchForm, name: e.target.value})}
                      className="w-full text-3xl font-heading border-none outline-none bg-transparent" 
                      style={{ color: colors.nightBlack }}
                      placeholder="e.g., PROJECT PROMPT-PLATE" 
                    />
                </div>

                <div className="mb-8">
                    <label className="block text-sm font-bold uppercase tracking-widest mb-2" style={{ color: colors.orange }}>Core AI Mechanism & Value</label>
                    <textarea 
                      rows="4" 
                      value={pitchForm.concept}
                      onChange={(e) => setPitchForm({...pitchForm, concept: e.target.value})}
                      className="w-full p-4 border-2 rounded-sm outline-none font-medium text-lg" 
                      style={{ borderColor: colors.dimGrey, color: colors.nightBlack }}
                      placeholder="How does the AI specifically capture new top-of-funnel attention?"
                    ></textarea>
                </div>

                <div className="grid grid-cols-2 gap-8 mb-8">
                    <div>
                        <label className="block text-sm font-bold uppercase tracking-widest mb-2" style={{ color: colors.orange }}>Target Fandom / Audience</label>
                        <input 
                          type="text" 
                          value={pitchForm.audience}
                          onChange={(e) => setPitchForm({...pitchForm, audience: e.target.value})}
                          className="w-full p-4 border-2 rounded-sm outline-none font-bold" 
                          style={{ borderColor: colors.dimGrey, color: colors.nightBlack }}
                          placeholder="e.g., D&D Players" 
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-bold uppercase tracking-widest mb-2" style={{ color: colors.orange }}>Primary Metric Impacted</label>
                        <select 
                          value={pitchForm.impact}
                          onChange={(e) => setPitchForm({...pitchForm, impact: e.target.value})}
                          className="w-full p-4 border-2 rounded-sm outline-none font-bold"
                          style={{ borderColor: colors.dimGrey, color: colors.nightBlack }}
                        >
                            <option value="CAC">Drastic CAC Reduction</option>
                            <option value="Virality">Organic Brand Virality</option>
                            <option value="LTV">First-Purchase LTV Pipeline</option>
                        </select>
                    </div>
                </div>

                <button onClick={handleAddPitch} className="w-full font-heading text-2xl py-5 rounded-sm transition uppercase tracking-wider border-2" style={{ backgroundColor: colors.nightBlack, color: colors.orange, borderColor: colors.nightBlack }}>Transmit to Global Board 📥</button>
            </div>

            <div className="flex justify-between mt-12 items-center">
                <button onClick={() => setActiveTab('ex2')} className="font-bold py-3 px-6 uppercase tracking-wide" style={{ color: colors.dimGrey }}>⬅️ Back</button>
                <button onClick={() => setActiveTab('finale')} className="font-heading text-xl py-4 px-10 rounded-sm shadow-xl transition transform hover:-translate-y-1 text-white" style={{ backgroundColor: colors.orange }}>Proceed to Convergence ➡️</button>
            </div>
          </section>
        )}

        {/* --- SECTION 5: FINALE --- */}
        {activeTab === 'finale' && (
          <section className="animate-fade-in block">
            <div className="mb-8 text-center">
                <span className="inline-block text-xs px-3 py-1 rounded font-bold uppercase tracking-widest mb-3 border" style={{ backgroundColor: colors.limeHi, color: colors.limeDeep, borderColor: colors.lime }}>Final Phase • 30 Minutes</span>
                <h2 className="text-5xl font-heading mb-4" style={{ color: colors.nightBlack }}>The Top 3 AI Initiatives</h2>
                <p className="text-lg font-medium max-w-2xl mx-auto" style={{ color: colors.dimGrey }}>
                    Review the consolidated team pitches below. Discuss, debate, and click to promote/demote exactly 3 initiatives into the global Displate Action Plan.
                </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                
                {/* Global Pitch Bank */}
                <div className="lg:col-span-1 bg-white p-6 rounded-sm border-2" style={{ borderColor: colors.nightBlack }}>
                    <h3 className="font-heading text-2xl mb-4 border-b-2 pb-2" style={{ borderColor: colors.dimGrey }}>Global Idea Bank</h3>
                    <p className="text-xs font-bold mb-4 uppercase tracking-wide" style={{ color: colors.dimGrey }}>Click to toggle promotion</p>
                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                        {pitches.length === 0 && <p className="text-sm italic text-gray-400">No pitches submitted yet.</p>}
                        
                        {/* Seed Data for aesthetics if empty, or just render pitches */}
                        {pitches.map((pitch, idx) => {
                          const isPromoted = workshopState.topThree.some(p => p.id === pitch.id);
                          return (
                            <div 
                              key={pitch.id} 
                              onClick={() => toggleTopThree(pitch)}
                              className={`p-4 rounded-sm border-l-4 shadow-sm cursor-pointer transition ${isPromoted ? 'opacity-40 grayscale' : 'hover:border-l-8 hover:bg-gray-100'}`} 
                              style={{ backgroundColor: colors.alabaster, borderLeftColor: [colors.blue, colors.magenta, colors.orange, colors.cyan][idx % 4] }}
                            >
                                <h4 className="font-bold text-lg" style={{ color: colors.nightBlack }}>{pitch.name} {isPromoted && '✔️'}</h4>
                                <p className="text-sm mt-1 font-medium" style={{ color: colors.dimGrey }}>{pitch.concept}</p>
                            </div>
                          )
                        })}
                    </div>
                </div>

                {/* Final Top 3 Board */}
                <div className="lg:col-span-2 bg-white p-10 rounded-sm shadow-xl border-4 relative overflow-hidden" style={{ borderColor: colors.lime }}>
                    <div className="absolute top-0 right-0 w-40 h-40 rounded-bl-full -z-10" style={{ backgroundColor: colors.limeHi }}></div>
                    <div className="absolute top-4 right-6 text-5xl">🏆</div>
                    <h3 className="font-heading text-3xl mb-8 tracking-wider" style={{ color: colors.nightBlack }}>DISPLATE ACTION PLAN</h3>
                    
                    <div className="space-y-6">
                        {[0, 1, 2].map((slotIdx) => {
                          const item = workshopState.topThree[slotIdx];
                          if (item) {
                            return (
                              <div key={slotIdx} className="flex items-start gap-6 p-6 bg-white rounded-sm border-solid border-4 shadow-lg transition-all duration-300" style={{ borderColor: colors.lime }}>
                                  <div className="text-5xl font-heading" style={{ color: colors.lime }}>{slotIdx + 1}</div>
                                  <div className="flex-grow pt-1">
                                      <h4 className="font-heading text-2xl mb-1" style={{ color: colors.nightBlack }}>{item.name}</h4>
                                      <p className="text-sm font-medium" style={{ color: colors.dimGrey }}>{item.concept}</p>
                                  </div>
                                  <div className="text-3xl">✔️</div>
                              </div>
                            );
                          } else {
                            return (
                              <div key={slotIdx} className="flex items-start gap-6 p-6 rounded-sm border-2 border-dashed transition-all duration-300" style={{ backgroundColor: colors.alabaster, borderColor: colors.dimGrey }}>
                                  <div className="text-5xl font-heading opacity-30" style={{ color: colors.dimGrey }}>{slotIdx + 1}</div>
                                  <div className="flex-grow pt-2">
                                      <h4 className="font-heading text-xl" style={{ color: colors.dimGrey }}>Awaiting Promotion</h4>
                                      <p className="text-sm font-medium" style={{ color: colors.dimGrey }}>Select an idea from the bank.</p>
                                  </div>
                              </div>
                            );
                          }
                        })}
                    </div>

                    <div className="mt-10 text-center">
                        <button onClick={() => alert('Plan synced to Firestore successfully!')} className="font-heading text-2xl py-5 px-10 rounded-sm shadow-xl transition transform hover:-translate-y-1 w-full border-2 uppercase tracking-widest" style={{ backgroundColor: colors.nightBlack, color: colors.lime, borderColor: colors.nightBlack }}>Lock & Export Plan</button>
                    </div>
                </div>
            </div>
            
            <div className="mt-12 text-center">
                <button onClick={() => setActiveTab('ex3')} className="font-bold py-3 px-6 uppercase tracking-wide" style={{ color: colors.dimGrey }}>⬅️ Back to Pitching</button>
            </div>
          </section>
        )}

      </main>
    </div>
  );
}