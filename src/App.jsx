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
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
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
  (import.meta.env.VITE_FIREBASE_APP_NAMESPACE?.trim?.() || '') ||
  (typeof __app_id !== 'undefined' ? __app_id : '') ||
  'displate-workshop';

export default function App() {
  const [user, setUser] = useState(null);
  const [activeTab, setActiveTab] = useState('intro');
  const [firebaseError, setFirebaseError] = useState(null);
  const [displayName, setDisplayName] = useState(() => {
    if (typeof window === 'undefined') return '';
    try {
      return localStorage.getItem('workshopDisplayName') || '';
    } catch {
      return '';
    }
  });
  const [nameInput, setNameInput] = useState('');
  
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
  const [editingBadIdeaId, setEditingBadIdeaId] = useState(null);
  const [editingBadIdeaText, setEditingBadIdeaText] = useState('');
  const [errcInputs, setErrcInputs] = useState({ eliminate: '', reduce: '', raise: '', create: '' });
  const [editingErrcId, setEditingErrcId] = useState(null);
  const [editingErrcText, setEditingErrcText] = useState('');
  const [pitchForm, setPitchForm] = useState({ name: '', concept: '', audience: '', impact: 'CAC' });
  const [editingPitchId, setEditingPitchId] = useState(null);
  const [editingPitchForm, setEditingPitchForm] = useState({ name: '', concept: '', audience: '', impact: 'CAC' });
  const [flippedCards, setFlippedCards] = useState({});
  const [timerDisplay, setTimerDisplay] = useState('03:00:00');

  const chartRef = useRef(null);
  const chartInstance = useRef(null);

  const handleSaveDisplayName = () => {
    const trimmed = nameInput.trim();
    if (!trimmed) return;
    setDisplayName(trimmed);
    try {
      localStorage.setItem('workshopDisplayName', trimmed);
    } catch {
      // ignore storage issues
    }
  };

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

  const resetTimer = async () => {
    if (!user) return;
    const stateRef = doc(db, 'artifacts', appId, 'public', 'data', 'workshop_state', 'global');
    const resetState = {
      isRunning: false,
      remaining: 10800000, // 3 hours default
      targetEndTime: 0,
    };
    await updateDoc(stateRef, { timer: resetState });
  };

  const setTimerFromPrompt = async () => {
    if (!user) return;
    const currentMinutes = Math.max(
      1,
      Math.round((workshopState.timer.remaining || 10800000) / 60000),
    );
    const raw = window.prompt('Set global countdown (minutes):', String(currentMinutes));
    if (!raw) return;
    const minutes = Number(raw);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    const ms = Math.round(minutes * 60 * 1000);
    const stateRef = doc(db, 'artifacts', appId, 'public', 'data', 'workshop_state', 'global');
    const newState = {
      isRunning: false,
      remaining: ms,
      targetEndTime: 0,
    };
    await updateDoc(stateRef, { timer: newState });
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
    if (!newBadIdea.trim() || !user || !displayName.trim()) return;
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'bad_ideas'), {
      text: newBadIdea.trim(),
      createdAt: Date.now(),
      authorId: user.uid,
      authorName: displayName.trim(),
    });
    setNewBadIdea('');
  };

  const startEditBadIdea = (idea) => {
    if (!user || idea.authorId !== user.uid) return;
    setEditingBadIdeaId(idea.id);
    setEditingBadIdeaText(idea.text);
  };

  const cancelEditBadIdea = () => {
    setEditingBadIdeaId(null);
    setEditingBadIdeaText('');
  };

  const saveEditBadIdea = async () => {
    if (!editingBadIdeaId || !editingBadIdeaText.trim() || !user) return;
    const ideaRef = doc(db, 'artifacts', appId, 'public', 'data', 'bad_ideas', editingBadIdeaId);
    await updateDoc(ideaRef, { text: editingBadIdeaText.trim() });
    setEditingBadIdeaId(null);
    setEditingBadIdeaText('');
  };

  const deleteBadIdea = async (idea) => {
    if (!user || idea.authorId !== user.uid) return;
    const ideaRef = doc(db, 'artifacts', appId, 'public', 'data', 'bad_ideas', idea.id);
    await deleteDoc(ideaRef);
    if (editingBadIdeaId === idea.id) {
      setEditingBadIdeaId(null);
      setEditingBadIdeaText('');
    }
  };

  const handleAddErrc = async (category) => {
    if (!errcInputs[category].trim() || !user || !displayName.trim()) return;
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'errc_ideas'), {
      category,
      text: errcInputs[category].trim(),
      createdAt: Date.now(),
      authorId: user.uid,
      authorName: displayName.trim(),
    });
    setErrcInputs(prev => ({ ...prev, [category]: '' }));
  };

  const startEditErrc = (idea) => {
    if (!user || (idea.authorId && idea.authorId !== user.uid)) return;
    setEditingErrcId(idea.id);
    setEditingErrcText(idea.text);
  };

  const cancelEditErrc = () => {
    setEditingErrcId(null);
    setEditingErrcText('');
  };

  const saveEditErrc = async () => {
    if (!editingErrcId || !editingErrcText.trim() || !user) return;
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'errc_ideas', editingErrcId);
    await updateDoc(ref, { text: editingErrcText.trim() });
    setEditingErrcId(null);
    setEditingErrcText('');
  };

  const deleteErrc = async (idea) => {
    if (!user || (idea.authorId && idea.authorId !== user.uid)) return;
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'errc_ideas', idea.id);
    await deleteDoc(ref);
    if (editingErrcId === idea.id) {
      setEditingErrcId(null);
      setEditingErrcText('');
    }
  };

  const handleAddPitch = async () => {
    if (!pitchForm.name.trim() || !pitchForm.concept.trim() || !user || !displayName.trim()) {
      alert("Name and Concept are required.");
      return;
    }
    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'pitches'), {
      ...pitchForm,
      createdAt: Date.now(),
      authorId: user.uid,
      authorName: displayName.trim(),
    });
    setPitchForm({ name: '', concept: '', audience: '', impact: 'CAC' });
    alert("Pitch submitted to the board globally!");
  };

  const startEditPitch = (pitch) => {
    if (!user || (pitch.authorId && pitch.authorId !== user.uid)) return;
    setEditingPitchId(pitch.id);
    setEditingPitchForm({
      name: pitch.name || '',
      concept: pitch.concept || '',
      audience: pitch.audience || '',
      impact: pitch.impact || 'CAC',
    });
  };

  const cancelEditPitch = () => {
    setEditingPitchId(null);
    setEditingPitchForm({ name: '', concept: '', audience: '', impact: 'CAC' });
  };

  const saveEditPitch = async () => {
    if (!editingPitchId || !user || !editingPitchForm.name.trim() || !editingPitchForm.concept.trim()) return;
    const ref = doc(db, 'artifacts', appId, 'public', 'data', 'pitches', editingPitchId);
    await updateDoc(ref, editingPitchForm);
    setEditingPitchId(null);
    setEditingPitchForm({ name: '', concept: '', audience: '', impact: 'CAC' });
  };

  const deletePitch = async (pitch) => {
    if (!user || (pitch.authorId && pitch.authorId !== user.uid)) return;
    const stateRef = doc(db, 'artifacts', appId, 'public', 'data', 'workshop_state', 'global');
    const inTop = workshopState.topThree.findIndex(p => p.id === pitch.id);
    if (inTop >= 0) {
      const next = workshopState.topThree.filter(p => p.id !== pitch.id);
      await updateDoc(stateRef, { topThree: next });
    }
    const pitchRef = doc(db, 'artifacts', appId, 'public', 'data', 'pitches', pitch.id);
    await deleteDoc(pitchRef);
    if (editingPitchId === pitch.id) setEditingPitchId(null);
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

  // Static ERRC examples – purely visual, not persisted to Firestore or used in pitches.
  const seedErrcByCategory = {
    eliminate: [
      'Generic product grids that ignore fandoms, wall size, or room style.',
      'Performance campaigns that optimize only for clicks, not first-time collectors.',
    ],
    reduce: [
      'Time from ad click to seeing a wall-ready gallery of Displates.',
      'Reliance on manual keyword search to find a favorite fandom or artist.',
    ],
    raise: [
      'Depth of AI-powered curation for licensed collections (Marvel, Star Wars, gaming IP).',
      'Transparency around limited editions, drops, and collector value signals.',
    ],
    create: [
      'An AI “Collection Architect” that auto-builds a 3-piece wall set for any fandom.',
      'A “Fandom Onboarding” quiz that translates interests into a Displate gallery in under 60 seconds.',
    ],
  };

  return (
    <div className="antialiased min-h-screen flex flex-col relative overflow-x-hidden" style={{ backgroundColor: colors.alabaster, color: colors.eerieBlack, fontFamily: "'Inter', system-ui, sans-serif" }}>
      {firebaseError && (
        <div className="w-full text-sm font-bold px-4 py-3 border-b-4" style={{ backgroundColor: colors.redHi, borderColor: colors.red, color: colors.redDeep }}>
          Firebase error: {firebaseError?.code ? `${firebaseError.code} — ` : ''}{firebaseError?.message || String(firebaseError)}
        </div>
      )}

      {/* Simple name capture overlay – required before interacting */}
      {!displayName && (
        <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
          <div className="glass-panel max-w-md w-full mx-4 p-6 rounded-lg shadow-xl bg-white">
            <h2 className="font-heading text-2xl mb-3" style={{ color: colors.nightBlack }}>Welcome to the Workshop</h2>
            <p className="text-sm mb-4 font-medium" style={{ color: colors.dimGrey }}>
              Enter your name. It will be attached to anything you add and used in the "Added by" labels.
            </p>
            <input
              type="text"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveDisplayName()}
              placeholder="Your name"
              className="w-full p-3 border-2 rounded-sm mb-4 font-medium"
              style={{ borderColor: colors.dimGrey }}
            />
            <button
              onClick={handleSaveDisplayName}
              className="w-full font-heading text-lg py-3 rounded-sm"
              style={{ backgroundColor: colors.nightBlack, color: colors.lime }}
            >
              Save & Join
            </button>
          </div>
        </div>
      )}

      {/* Pitch edit modal */}
      {editingPitchId && (() => {
        const pitch = pitches.find(p => p.id === editingPitchId);
        if (!pitch) return null;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
            <div className="bg-white max-w-lg w-full rounded-lg shadow-xl border-4 p-6 max-h-[90vh] overflow-y-auto" style={{ borderColor: colors.nightBlack }}>
              <h3 className="font-heading text-xl mb-4" style={{ color: colors.nightBlack }}>Edit pitch</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase mb-1" style={{ color: colors.orange }}>Initiative code name</label>
                  <input value={editingPitchForm.name} onChange={(e) => setEditingPitchForm(f => ({ ...f, name: e.target.value }))} className="w-full p-3 border-2 rounded-sm" style={{ borderColor: colors.dimGrey }} />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase mb-1" style={{ color: colors.orange }}>Core AI mechanism & value</label>
                  <textarea rows={3} value={editingPitchForm.concept} onChange={(e) => setEditingPitchForm(f => ({ ...f, concept: e.target.value }))} className="w-full p-3 border-2 rounded-sm" style={{ borderColor: colors.dimGrey }} />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase mb-1" style={{ color: colors.orange }}>Target fandom / audience</label>
                  <input value={editingPitchForm.audience} onChange={(e) => setEditingPitchForm(f => ({ ...f, audience: e.target.value }))} className="w-full p-3 border-2 rounded-sm" style={{ borderColor: colors.dimGrey }} />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase mb-1" style={{ color: colors.orange }}>Primary metric impacted</label>
                  <select value={editingPitchForm.impact} onChange={(e) => setEditingPitchForm(f => ({ ...f, impact: e.target.value }))} className="w-full p-3 border-2 rounded-sm" style={{ borderColor: colors.dimGrey }}>
                    <option value="CAC">Drastic CAC Reduction</option>
                    <option value="Virality">Organic Brand Virality</option>
                    <option value="LTV">First-Purchase LTV Pipeline</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <button onClick={saveEditPitch} className="flex-1 font-heading py-3 rounded-sm text-white" style={{ backgroundColor: colors.nightBlack }}>Save</button>
                <button onClick={cancelEditPitch} className="flex-1 font-bold py-3 rounded-sm border-2" style={{ borderColor: colors.dimGrey, color: colors.dimGrey }}>Cancel</button>
              </div>
            </div>
          </div>
        );
      })()}
      
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
              <button onClick={() => setActiveTab('metrics')} className={navClass('metrics')}>4b. Metrics Guide</button>
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
          <div className="flex items-center gap-2 ml-2">
            <button 
              onClick={toggleTimer} 
              className="font-bold px-3 py-1 rounded text-xs uppercase tracking-wide transition"
              style={{ 
                backgroundColor: workshopState.timer.isRunning ? colors.red : colors.eerieBlack,
                color: workshopState.timer.isRunning ? colors.white : colors.lime
              }}
            >
              {workshopState.timer.isRunning ? 'Pause' : 'Start'}
            </button>
            <button
              onClick={resetTimer}
              className="font-bold px-2 py-1 rounded text-[10px] uppercase tracking-wide transition"
              style={{ backgroundColor: colors.dimGrey, color: colors.white }}
            >
              Reset
            </button>
            <button
              onClick={setTimerFromPrompt}
              className="font-bold px-2 py-1 rounded text-[10px] uppercase tracking-wide transition"
              style={{ backgroundColor: colors.blueHi, color: colors.blueDeep }}
            >
              Set
            </button>
          </div>
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
                      disabled={!user || !displayName}
                    />
                    <button 
                      onClick={handleAddBadIdea} 
                      disabled={!user || !displayName}
                      className="text-white font-heading text-xl px-8 py-4 rounded-sm transition uppercase tracking-wide disabled:opacity-50" 
                      style={{ backgroundColor: colors.nightBlack }}
                    >
                      Add Anti-Idea
                    </button>
                </div>
                
                <div className="space-y-3">
                  {badIdeas.map(idea => (
                    <div 
                      key={idea.id} 
                      className="p-4 rounded-sm border-2 font-bold flex flex-col gap-2 md:flex-row md:items-center md:justify-between" 
                      style={{ backgroundColor: colors.alabaster, borderColor: colors.dimGrey, color: colors.nightBlack }}
                    >
                      <div className="flex-1">
                        {editingBadIdeaId === idea.id ? (
                          <div className="flex flex-col gap-2">
                            <input
                              type="text"
                              value={editingBadIdeaText}
                              onChange={(e) => setEditingBadIdeaText(e.target.value)}
                              className="w-full p-2 border-2 rounded-sm text-sm font-medium"
                              style={{ borderColor: colors.dimGrey, color: colors.nightBlack }}
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={saveEditBadIdea}
                                className="px-3 py-1 text-xs rounded-sm font-bold"
                                style={{ backgroundColor: colors.blue, color: colors.white }}
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditBadIdea}
                                className="px-3 py-1 text-xs rounded-sm font-bold"
                                style={{ backgroundColor: colors.dimGrey, color: colors.white }}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <span>❌ {idea.text}</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 self-start md:self-auto">
                        <span className="text-[10px] px-2 py-1 bg-white border rounded font-semibold" style={{ color: colors.dimGrey }}>
                          Added by {idea.authorName || idea.author || 'anonymous'}
                        </span>
                        {user && idea.authorId === user.uid && editingBadIdeaId !== idea.id && (
                          <>
                            <button
                              onClick={() => startEditBadIdea(idea)}
                              className="text-xs px-2 py-1 rounded-sm font-bold"
                              style={{ backgroundColor: colors.blueHi, color: colors.blueDeep }}
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => deleteBadIdea(idea)}
                              className="text-xs px-2 py-1 rounded-sm font-bold"
                              style={{ backgroundColor: colors.redHi, color: colors.redDeep }}
                              aria-label="Delete idea"
                            >
                              ✕
                            </button>
                          </>
                        )}
                      </div>
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
                        {seedErrcByCategory[grid.id].map((text, idx) => (
                          <li key={`seed-${grid.id}-${idx}`} className="break-words leading-tight opacity-80">
                            {text}
                          </li>
                        ))}
                        {errcIdeas
                          .filter(i => i.category === grid.id && i.text !== '20k results out of every search')
                          .map(idea => (
                          <li key={idea.id} className="flex flex-wrap items-center gap-2 py-1 group">
                            {editingErrcId === idea.id ? (
                              <>
                                <input
                                  type="text"
                                  value={editingErrcText}
                                  onChange={(e) => setEditingErrcText(e.target.value)}
                                  className="flex-1 min-w-0 p-2 border rounded-sm text-sm"
                                  style={{ borderColor: grid.line }}
                                />
                                <button type="button" onClick={saveEditErrc} className="text-xs font-bold px-2 py-1 rounded-sm text-white" style={{ backgroundColor: grid.line }}>Save</button>
                                <button type="button" onClick={cancelEditErrc} className="text-xs font-bold px-2 py-1 rounded-sm bg-gray-200 text-gray-800">Cancel</button>
                              </>
                            ) : (
                              <>
                                <span className="break-words leading-tight flex-1">{idea.text}</span>
                                {user && idea.authorId === user.uid && (
                                  <span className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
                                    <button type="button" onClick={() => startEditErrc(idea)} className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ backgroundColor: colors.blueHi, color: colors.blueDeep }}>Edit</button>
                                    <button type="button" onClick={() => deleteErrc(idea)} className="text-[10px] px-2 py-0.5 rounded font-bold" style={{ backgroundColor: colors.redHi, color: colors.redDeep }} aria-label="Delete">✕</button>
                                  </span>
                                )}
                                {idea.authorName && (
                                  <span className="text-[10px] text-gray-500">by {idea.authorName}</span>
                                )}
                              </>
                            )}
                          </li>
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
                        <label className="block text-sm font-bold uppercase tracking-widest mb-2 flex items-center gap-2" style={{ color: colors.orange }}>
                          Primary Metric Impacted
                          <button
                            type="button"
                            onClick={() => setActiveTab('metrics')}
                            className="text-[10px] px-2 py-1 rounded-full font-bold border"
                            style={{ backgroundColor: colors.orangeHi, borderColor: colors.orangeDeep, color: colors.orangeDeep }}
                            title="Open metric definitions and examples"
                          >
                            ?
                          </button>
                        </label>
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

        {/* --- SECTION 4b: METRICS GUIDE --- */}
        {activeTab === 'metrics' && (
          <section className="animate-fade-in block">
            <div className="mb-8 border-l-8 pl-6" style={{ borderColor: colors.orange }}>
              <span className="inline-block text-xs px-3 py-1 rounded font-bold uppercase tracking-widest mb-3" style={{ backgroundColor: colors.orangeHi, color: colors.orangeDeep }}>
                Phase 3 • Metrics Guide
              </span>
              <h2 className="text-4xl font-heading mb-4" style={{ color: colors.nightBlack }}>Primary Metrics: Definitions & Examples</h2>
              <p className="text-lg font-medium" style={{ color: colors.dimGrey }}>
                Use this guide to align your AI initiative with the right success metric. When you select a metric in the pitch form, you are making a statement about how your idea will change the economics of acquiring and growing Displate collectors.
              </p>
            </div>

            <div className="space-y-6">
              <div className="bg-white p-6 rounded-sm shadow border-2" style={{ borderColor: colors.orangeHi }}>
                <h3 className="font-heading text-2xl mb-2" style={{ color: colors.orangeDeep }}>Drastic CAC Reduction</h3>
                <p className="font-medium mb-3" style={{ color: colors.dimGrey }}>
                  This metric focuses on radically lowering the cost of acquiring a new paying customer while keeping volume and quality of buyers high.
                </p>
                <ul className="list-disc list-inside text-sm font-medium space-y-2" style={{ color: colors.nightBlack }}>
                  <li>Examples: AI media buying that finds pockets of underpriced attention for key fandoms, or creative engines that double click-through and conversion rates without increasing spend.</li>
                  <li>Good fit if your idea makes every euro of performance marketing significantly more efficient for first-time Displate buyers.</li>
                </ul>
              </div>

              <div className="bg-white p-6 rounded-sm shadow border-2" style={{ borderColor: colors.cyanHi }}>
                <h3 className="font-heading text-2xl mb-2" style={{ color: colors.cyanDeep }}>Organic Brand Virality</h3>
                <p className="font-medium mb-3" style={{ color: colors.dimGrey }}>
                  Here the goal is to turn every new collector into an amplifier: someone who brings in more collectors through sharing, social proof, and community mechanics.
                </p>
                <ul className="list-disc list-inside text-sm font-medium space-y-2" style={{ color: colors.nightBlack }}>
                  <li>Examples: AI-personalized shareable wall previews, co-creation tools that generate content people want to post, or referral flows that feel like part of fandom identity rather than a discount mechanic.</li>
                  <li>Good fit if your idea increases word-of-mouth, UGC, and referral loops so that new paying customers arrive without incremental paid spend.</li>
                </ul>
              </div>

              <div className="bg-white p-6 rounded-sm shadow border-2" style={{ borderColor: colors.limeHi }}>
                <h3 className="font-heading text-2xl mb-2" style={{ color: colors.limeDeep }}>First-Purchase LTV Pipeline</h3>
                <p className="font-medium mb-3" style={{ color: colors.dimGrey }}>
                  A “First-Purchase LTV Pipeline” refers to an acquisition strategy where the ultimate goal isn&apos;t just to make a quick initial sale, but to use that first sale as a strategic gateway to a highly profitable, long-term relationship.
                </p>
                <ul className="list-disc list-inside text-sm font-medium space-y-2" style={{ color: colors.nightBlack }}>
                  <li><strong>Focus beyond the single poster:</strong> Instead of just optimizing to sell one metal print (which might barely cover CAC), the initiative is designed to lock the user into the Displate ecosystem.</li>
                  <li><strong>Predictive matchmaking:</strong> Using AI during that very first interaction to understand the customer&apos;s tastes so well that Displate effectively knows the next 3–5 Displates they will want to buy over the coming months.</li>
                  <li><strong>The pipeline effect:</strong> Structuring the first purchase so that it naturally leads to joining Displate Club, buying complementary pieces, or building out a full gallery wall over time.</li>
                  <li>Essentially, this metric is about optimizing marketing and AI systems to attract and nurture “whales” — highly loyal, repeat buyers — rather than one-off impulse purchasers.</li>
                </ul>
              </div>
            </div>

            <div className="flex justify-between mt-12 items-center">
              <button onClick={() => setActiveTab('ex3')} className="font-bold py-3 px-6 uppercase tracking-wide" style={{ color: colors.dimGrey }}>
                ⬅️ Back to Pitch Form
              </button>
              <button onClick={() => setActiveTab('finale')} className="font-heading text-xl py-4 px-10 rounded-sm shadow-xl transition transform hover:-translate-y-1 text-white" style={{ backgroundColor: colors.orange }}>
                Proceed to Convergence ➡️
              </button>
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
                          // Legacy pitches without authorId can be edited/removed by anyone.
                          const isOwner = user && (pitch.authorId === user.uid || !pitch.authorId);
                          return (
                            <div 
                              key={pitch.id} 
                              onClick={() => toggleTopThree(pitch)}
                              className={`p-4 rounded-sm border-l-4 shadow-sm cursor-pointer transition ${isPromoted ? 'opacity-40 grayscale' : 'hover:border-l-8 hover:bg-gray-100'}`} 
                              style={{ backgroundColor: colors.alabaster, borderLeftColor: [colors.blue, colors.magenta, colors.orange, colors.cyan][idx % 4] }}
                            >
                              <div className="flex justify-between items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <h4 className="font-bold text-lg" style={{ color: colors.nightBlack }}>{pitch.name} {isPromoted && '✔️'}</h4>
                                  <p className="text-sm mt-1 font-medium" style={{ color: colors.dimGrey }}>{pitch.concept}</p>
                                  {pitch.authorName && (
                                    <p className="text-[10px] mt-2 font-semibold" style={{ color: colors.dimGrey }}>Added by {pitch.authorName}</p>
                                  )}
                                </div>
                                {isOwner && (
                                  <span className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                    <button type="button" onClick={() => startEditPitch(pitch)} className="text-xs px-2 py-1 rounded font-bold" style={{ backgroundColor: colors.blueHi, color: colors.blueDeep }}>Edit</button>
                                    <button type="button" onClick={() => deletePitch(pitch)} className="text-xs px-2 py-1 rounded font-bold" style={{ backgroundColor: colors.redHi, color: colors.redDeep }} aria-label="Delete pitch">✕</button>
                                  </span>
                                )}
                              </div>
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