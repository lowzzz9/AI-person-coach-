// app.js — AI Form Coach v2 — Multi-Page SPA
// Refactored: Login · Dashboard · Exercise Selection · Workout · History

// ══════════════════════════════════════════════════════════════════════════
// STATE
// ══════════════════════════════════════════════════════════════════════════
const state = {
  // Auth
  username: null,
  isGuest: false,

  // Navigation
  currentPage: null,

  // Exercise & workout
  exercise: null,
  isSetActive: false,
  reps: 0,
  sets: 0,
  calories: 0,
  formScore: 100,
  lastRepTime: 0,
  repCooldown: 900,
  repPhase: 'up',
  setReps: 0,
  targetSetReps: 10,

  // History
  workoutHistory: [],

  // Camera
  isCameraOn: false,
  tracker: null,

  // AI
  aiMessages: [],
  aiThinking: false,
};

// ── DOM Helper ─────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
let video, canvas;

// ══════════════════════════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  video  = $('video');
  canvas = $('canvas');

  // Keyboard listeners
  const aiInput = $('aiInput');
  if (aiInput) aiInput.addEventListener('keydown', e => { if (e.key === 'Enter') sendAiMessage(); });

  // Check persisted session
  const savedUser = localStorage.getItem('formCoachUser');
  if (savedUser) {
    const parsed = JSON.parse(savedUser);
    state.username = parsed.username;
    state.isGuest  = parsed.isGuest || false;
    bootApp();
  } else {
    showLoginPage();
  }
});

// ══════════════════════════════════════════════════════════════════════════
// AUTH
// ══════════════════════════════════════════════════════════════════════════
function showLoginPage() {
  $('page-login').style.display = 'flex';
  $('app-shell').style.display  = 'none';
}

function handleLogin() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value.trim();
  const errEl    = $('loginError');

  if (!username) { showLoginError('Please enter a username.'); return; }
  if (!password) { showLoginError('Please enter a password.'); return; }

  // Check registered accounts in localStorage
  const accounts = JSON.parse(localStorage.getItem('formCoachAccounts') || '{}');

  if (accounts[username]) {
    // Existing account — verify password
    if (accounts[username].password !== password) {
      showLoginError('Incorrect password. Try again.');
      return;
    }
  } else {
    showLoginError('Account not found. Use "Create Account" to register first.');
    return;
  }

  errEl.style.display = 'none';
  loginSuccess(username, false);
}

function handleRegister() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value.trim();

  if (!username || username.length < 2) { showLoginError('Username must be at least 2 characters.'); return; }
  if (!password || password.length < 4) { showLoginError('Password must be at least 4 characters.'); return; }

  const accounts = JSON.parse(localStorage.getItem('formCoachAccounts') || '{}');

  if (accounts[username]) {
    showLoginError('Username already taken. Please choose another.');
    return;
  }

  accounts[username] = { password, created: new Date().toISOString() };
  localStorage.setItem('formCoachAccounts', JSON.stringify(accounts));
  loginSuccess(username, false);
  toast('✅ Account created! Welcome!', 'success');
}

function handleGuest() {
  loginSuccess('Guest', true);
}

function loginSuccess(username, isGuest) {
  state.username = username;
  state.isGuest  = isGuest;
  localStorage.setItem('formCoachUser', JSON.stringify({ username, isGuest }));
  bootApp();
}

function handleLogout() {
  localStorage.removeItem('formCoachUser');
  state.username = null;

  // Stop camera if running
  if (state.isCameraOn) stopCamera();

  $('app-shell').style.display = 'none';
  $('page-login').style.display = 'flex';
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  toast('👋 Logged out.', 'info');
}

function showLoginError(msg) {
  const el = $('loginError');
  el.textContent = msg;
  el.style.display = 'block';
}

// ══════════════════════════════════════════════════════════════════════════
// BOOT APP (after login)
// ══════════════════════════════════════════════════════════════════════════
function bootApp() {
  $('page-login').style.display  = 'none';
  $('app-shell').style.display   = 'flex';

  // Set username UI
  const initial = (state.username || 'G').charAt(0).toUpperCase();
  $('userAvatar').textContent    = initial;
  $('userNameSidebar').textContent = state.username;
  $('topbarUser').textContent    = state.username;

  // Load data
  loadHistory();
  renderExerciseGrid();
  renderLibrary();

  // Initial AI greeting
  aiSay(`👋 Hey ${state.username === 'Guest' ? 'there' : state.username}! I'm your AI Form Coach. Select an exercise, start your camera, then hit Start Set. I'll watch your form and correct you in real-time.`);

  // Navigate to dashboard
  showPage('dashboard');
  toast(`🤖 AI Form Coach ready!`, 'success');
}

// ══════════════════════════════════════════════════════════════════════════
// NAVIGATION
// ══════════════════════════════════════════════════════════════════════════
function showPage(name) {
  const pages = ['dashboard', 'exercises', 'workout', 'history'];
  pages.forEach(p => {
    const el = $(`page-${p}`);
    if (el) el.style.display = 'none';
  });

  // Remove active from all nav
  document.querySelectorAll('.nav-item[data-page]').forEach(el => el.classList.remove('active'));

  const target = $(`page-${name}`);
  if (target) {
    target.style.display = 'block';
    target.style.animation = 'none';
    void target.offsetWidth;
    target.style.animation = 'fade-up 0.3s ease';
  }

  // Activate nav item
  const navBtn = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (navBtn) navBtn.classList.add('active');

  state.currentPage = name;

  // Page-specific setup
  if (name === 'dashboard')  refreshDashboard();
  if (name === 'history')    renderHistory();
  if (name === 'workout' && !state.exercise) {
    toast('💡 Select an exercise from the library first!', 'info');
  }

  // Close mobile sidebar
  closeSidebar();
}

// Mobile sidebar
function toggleSidebar() {
  const sidebar  = $('sidebar');
  const overlay  = $('sidebarOverlay');
  sidebar.classList.toggle('open');
  overlay.classList.toggle('open');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}

// ══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ══════════════════════════════════════════════════════════════════════════
function refreshDashboard() {
  // Welcome message
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  $('welcomeMsg').textContent = `${greeting}, ${state.username}! Ready to train?`;

  // Compute cumulative stats from history
  const totalReps  = state.workoutHistory.reduce((a, r) => a + (r.reps || 0), 0);
  const totalSets  = state.workoutHistory.length;
  const totalCals  = state.workoutHistory.reduce((a, r) => a + (r.calories || 0), 0);
  const avgForm    = totalSets > 0
    ? Math.round(state.workoutHistory.reduce((a, r) => a + (r.formScore || 0), 0) / totalSets)
    : null;

  $('dashTotalReps').textContent  = totalReps;
  $('dashTotalSets').textContent  = totalSets;
  $('dashCalories').textContent   = Math.round(totalCals);
  $('dashFormScore').textContent  = avgForm !== null ? `${avgForm}%` : '—';

  // Resume button
  const resumeBtn = $('resumeBtn');
  if (state.exercise) {
    resumeBtn.style.display = 'flex';
    resumeBtn.querySelector('.qa-label').textContent = `Resume ${EXERCISES[state.exercise]?.name || ''}`;
  } else {
    resumeBtn.style.display = 'none';
  }

  // Recent activity
  renderRecentActivity();

  // Dashboard exercise preview (just first 6)
  const dashGrid = $('dashExerciseGrid');
  if (dashGrid) {
    const keys = Object.keys(EXERCISES).slice(0, 6);
    dashGrid.innerHTML = keys.map(key => {
      const ex = EXERCISES[key];
      return `
        <div class="ex-card" data-ex="${key}" onclick="quickSelectExercise('${key}')">
          <div class="ex-emoji">${ex.emoji}</div>
          <div class="ex-name">${ex.name}</div>
          <div class="ex-desc">${ex.musclesWorked?.[0] || ''}</div>
        </div>
      `;
    }).join('');
  }
}

function renderRecentActivity() {
  const container = $('recentActivity');
  if (!container) return;

  if (state.workoutHistory.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.88rem;">No workouts yet — start training!</p>`;
    return;
  }

  const recent = state.workoutHistory.slice(0, 5);
  container.innerHTML = recent.map(r => {
    const scoreClass = r.formScore >= 80 ? 'good' : r.formScore >= 60 ? 'avg' : 'poor';
    return `
      <div class="recent-item">
        <span class="ri-emoji">${r.emoji || '💪'}</span>
        <div>
          <div class="ri-name">${r.name}</div>
          <div class="ri-meta">${new Date(r.date).toLocaleDateString()} · Set ${r.set} · ${r.reps} reps</div>
        </div>
        <div class="ri-score ${scoreClass}">${r.formScore}%</div>
      </div>
    `;
  }).join('');
}

function resumeLastWorkout() {
  if (state.exercise) {
    showPage('workout');
  }
}

function quickSelectExercise(key) {
  selectExercise(key);
  showPage('workout');
}

// ══════════════════════════════════════════════════════════════════════════
// EXERCISE SELECTION
// ══════════════════════════════════════════════════════════════════════════
// Category map — determines which filter a given exercise belongs to
const EXERCISE_CATEGORIES = {
  squat:      ['lower', 'compound'],
  pushup:     ['upper', 'compound'],
  lunge:      ['lower'],
  plank:      ['core'],
  deadlift:   ['lower', 'compound'],
  bicepCurl:  ['upper'],
};

function filterExercises(filter, btn) {
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderLibrary(filter);
}

function renderLibrary(filter = 'all') {
  const container = $('libraryGrid');
  if (!container) return;

  const DIFFICULTY = {
    squat: 'intermediate', pushup: 'beginner', lunge: 'beginner',
    plank: 'beginner', deadlift: 'advanced', bicepCurl: 'beginner',
  };

  const entries = Object.entries(EXERCISES).filter(([key]) => {
    if (filter === 'all') return true;
    const cats = EXERCISE_CATEGORIES[key] || [];
    return cats.includes(filter);
  });

  if (entries.length === 0) {
    container.innerHTML = `<div class="card"><p style="color:var(--text-muted);">No exercises in this category.</p></div>`;
    return;
  }

  container.innerHTML = entries.map(([key, ex]) => {
    const diff = DIFFICULTY[key] || 'beginner';
    const cats = EXERCISE_CATEGORIES[key] || [];
    const catTags = cats.map(c => `<span class="muscle-tag" style="text-transform:uppercase;font-size:0.65rem;">${c}</span>`).join('');

    const stepPreview = ex.steps.slice(0, 3).map((s, i) => `
      <div class="lib-step-row">
        <span class="lib-step-num">${i + 1}.</span>
        <span>${s.title} — ${s.desc}</span>
      </div>
    `).join('');

    return `
      <div class="lib-card" onclick="selectExerciseAndGo('${key}')">
        <div class="lib-card-header">
          <div class="lib-emoji">${ex.emoji}</div>
          <div>
            <div class="lib-title">${ex.name}</div>
            <div class="lib-cals">~${ex.caloriesPerRep} cal/rep</div>
            <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap;align-items:center;">
              <span class="difficulty-tag diff-${diff}">${diff}</span>
              ${catTags}
            </div>
          </div>
        </div>
        <div class="muscle-tags">
          ${(ex.musclesWorked || []).map(m => `<span class="muscle-tag">${m}</span>`).join('')}
        </div>
        <div class="lib-steps-preview">${stepPreview}</div>
        <button class="lib-start-btn">▶ START THIS EXERCISE</button>
      </div>
    `;
  }).join('');
}

function selectExerciseAndGo(key) {
  selectExercise(key);
  showPage('workout');
}

// ══════════════════════════════════════════════════════════════════════════
// CAMERA
// ══════════════════════════════════════════════════════════════════════════
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
    });
    video.srcObject = stream;
    await video.play();
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;

    $('noCameraMsg').style.display = 'none';
    $('startCamBtn').disabled = true;
    $('stopCamBtn').disabled  = false;
    state.isCameraOn = true;

    if (!state.tracker) {
      toast('⏳ Loading AI body tracker…', 'info');
      state.tracker = new PoseTracker(video, canvas);
      await state.tracker.load();
      toast('✅ Body tracker loaded!', 'success');
    }

    state.tracker.onPose = handlePose;
    state.tracker.start();
    aiSay('📷 Camera active! Select an exercise and hit Start Set when ready.');

  } catch (err) {
    toast('❌ Camera access denied. Please allow camera permissions.', 'error');
    console.error(err);
  }
}

function stopCamera() {
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(t => t.stop());
    video.srcObject = null;
  }
  if (state.tracker) state.tracker.stop();
  state.isCameraOn = false;
  const msg = $('noCameraMsg');
  if (msg) msg.style.display = 'flex';
  $('startCamBtn').disabled = false;
  $('stopCamBtn').disabled  = true;
  updateFeedback('Camera stopped.');
}

// ══════════════════════════════════════════════════════════════════════════
// POSE HANDLER
// ══════════════════════════════════════════════════════════════════════════
function handlePose(pose) {
  if (!state.exercise || !state.isSetActive) return;
  const ex = EXERCISES[state.exercise];
  if (!ex?.analyze) return;

  const result = ex.analyze(pose.keypoints, canvas.height);
  if (!result) return;

  // Smooth form score
  state.formScore = Math.round(state.formScore * 0.7 + result.score * 0.3);
  const fn1 = $('formScoreNum'), fn2 = $('formScoreNum2'), sf = $('scoreFill');
  if (fn1) fn1.textContent = state.formScore;
  if (fn2) fn2.textContent = state.formScore;
  if (sf)  sf.style.width  = `${state.formScore}%`;

  // Angle display
  const ad = $('angleDisplay');
  if (ad && result.angle != null) ad.textContent = `JOINT ANGLE: ${result.angle}°`;

  // Feedback
  let html = result.feedback.map(f => `<div>${f}</div>`).join('');
  if (result.corrections.length) {
    html += result.corrections.map(c => `<div class="correction-tip">🔧 ${c}</div>`).join('');
  }
  updateFeedback(html);

  // Rep counting (two-phase)
  if (result.repSignal && state.repPhase === 'up') {
    state.repPhase = 'down';
  } else if (!result.repSignal && state.repPhase === 'down') {
    const now = Date.now();
    if (now - state.lastRepTime > state.repCooldown) {
      countRep(result.score);
      state.lastRepTime = now;
      state.repPhase = 'up';
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════
// REPS & SETS
// ══════════════════════════════════════════════════════════════════════════
function countRep(score) {
  state.reps++;
  state.setReps++;
  state.calories += EXERCISES[state.exercise]?.caloriesPerRep || 0.4;

  const rc = $('repCount'), cc = $('calorieCount'), repEl = $('repCounter');
  if (rc) rc.textContent = state.reps;
  if (cc) cc.textContent = Math.round(state.calories);

  if (repEl) {
    repEl.textContent = `${state.setReps} / ${state.targetSetReps} REPS`;
    repEl.classList.remove('rep-pop');
    void repEl.offsetWidth;
    repEl.classList.add('rep-pop');
  }

  if (state.setReps >= state.targetSetReps) completeSet();
}

function completeSet() {
  state.sets++;
  state.setReps = 0;
  state.isSetActive = false;

  const sc = $('setCount'), ssb = $('startSetBtn'), repEl = $('repCounter');
  if (sc)  sc.textContent = state.sets;
  if (repEl) repEl.textContent = `SET ${state.sets} COMPLETE 🏆`;
  if (ssb) ssb.disabled = false;

  saveSet();
  toast(`🏆 Set ${state.sets} complete! Rest 60 seconds.`, 'success');
  aiSay(`💪 Excellent! Set ${state.sets} done with ${state.formScore}% form score. Rest 60 seconds, then go again. Keep your ${EXERCISES[state.exercise]?.name} form tight!`);
}

function startSet() {
  if (!state.exercise) { toast('⚠️ Select an exercise first!', 'error'); return; }
  if (!state.isCameraOn) { toast('📷 Start your camera first!', 'error'); return; }

  state.isSetActive = true;
  state.setReps     = 0;
  state.repPhase    = 'up';

  const repEl = $('repCounter'), ssb = $('startSetBtn');
  if (repEl) repEl.textContent = `0 / ${state.targetSetReps} REPS`;
  if (ssb)   ssb.disabled = false;

  toast('▶️ Set started! Go!', 'success');
  aiSay(`Ready! Go for your ${state.targetSetReps} ${EXERCISES[state.exercise]?.name} reps. I'm watching your form 👀`);
}

function resetWorkout() {
  state.reps = 0; state.sets = 0; state.calories = 0;
  state.formScore = 100; state.setReps = 0;
  state.isSetActive = false;

  const rc = $('repCount'), sc = $('setCount'), cc = $('calorieCount');
  const fn1 = $('formScoreNum'), fn2 = $('formScoreNum2');
  const sf = $('scoreFill'), repEl = $('repCounter'), ssb = $('startSetBtn');

  if (rc)  rc.textContent  = '0';
  if (sc)  sc.textContent  = '0';
  if (cc)  cc.textContent  = '0';
  if (fn1) fn1.textContent = '100';
  if (fn2) fn2.textContent = '100';
  if (sf)  sf.style.width  = '100%';
  if (repEl) repEl.textContent = 'READY TO TRAIN';
  if (ssb) ssb.disabled = false;
  toast('🔄 Workout reset.', 'info');
}

// ══════════════════════════════════════════════════════════════════════════
// EXERCISE SELECTION
// ══════════════════════════════════════════════════════════════════════════
function selectExercise(key) {
  state.exercise    = key;
  state.isSetActive = false;
  state.setReps     = 0;
  state.repPhase    = 'up';

  // Highlight cards if on workout page
  document.querySelectorAll('.ex-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.ex === key);
  });

  const ex = EXERCISES[key];
  renderCorrectionPanel(key);
  loadYoutube(ex.ytEmbed, ex.name);

  // Update workout page header
  const titleEl = $('workoutPageTitle');
  const nameEl  = $('workoutExerciseName');
  if (titleEl) titleEl.textContent = 'LIVE TRAINING';
  if (nameEl)  nameEl.textContent  = ex.name;

  const repEl = $('repCounter');
  if (repEl) repEl.textContent = 'SELECT READY — HIT START';
  updateFeedback(`Ready for ${ex.name}. Start camera and hit Start Set!`);

  toast(`Selected: ${ex.name}`, 'success');
  aiSay(`Great choice! **${ex.name}** works your ${ex.musclesWorked?.join(', ')}. Key tip: ${ex.steps[0].fix}. Start your set when ready!`);
}

// Render workout page exercise mini-grid (bottom of exercise selection)
function renderExerciseGrid() {
  // Not used in new layout — exercises live in the library page
  // Kept as no-op for backward compat (pose.js, etc. don't call it)
}

// ══════════════════════════════════════════════════════════════════════════
// CORRECTION PANEL
// ══════════════════════════════════════════════════════════════════════════
function renderCorrectionPanel(key) {
  const container = $('correctionPanel');
  if (!container) return;
  const ex = EXERCISES[key];
  if (!ex) return;

  container.innerHTML = `
    <div class="card-title">${ex.emoji} ${ex.name.toUpperCase()} — FORM GUIDE</div>
    <div class="muscle-tags" style="margin-bottom:14px;">
      ${(ex.musclesWorked || []).map(m => `<span class="muscle-tag">${m}</span>`).join('')}
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;font-family:'JetBrains Mono',monospace;">
      ✅ STEP-BY-STEP CUE
    </div>
    <div class="steps-list">
      ${ex.steps.map((s, i) => `
        <div class="step-item" onclick="highlightStep(${i})">
          <div class="step-visual">${s.visual}</div>
          <div class="step-info">
            <div class="step-title">${s.title}</div>
            <div class="step-desc">${s.desc}</div>
            <div class="step-fix">💡 ${s.fix}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin:14px 0 6px;font-family:'JetBrains Mono',monospace;">
      ⚠️ COMMON MISTAKES
    </div>
    <div class="mistakes-list">
      ${ex.mistakes.map(m => `
        <div class="mistake-item">
          <div class="mistake-bad">❌ ${m.bad}</div>
          <div class="mistake-good">✅ ${m.good}</div>
        </div>
      `).join('')}
    </div>
  `;
}

function highlightStep(i) {
  document.querySelectorAll('.step-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === i);
  });
}

// ══════════════════════════════════════════════════════════════════════════
// YOUTUBE
// ══════════════════════════════════════════════════════════════════════════
function loadYoutube(videoId, exerciseName) {
  const container = $('ytContainer');
  if (!container) return;
  if (!videoId) {
    container.innerHTML = `<div class="yt-placeholder">No video found for this exercise.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="yt-header"><span>▶</span> REFERENCE VIDEO — ${exerciseName.toUpperCase()}</div>
    <div class="yt-embed-container">
      <iframe
        src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1"
        title="${exerciseName} form guide"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen loading="lazy"
      ></iframe>
    </div>
  `;
}

// ══════════════════════════════════════════════════════════════════════════
// AI CHAT
// ══════════════════════════════════════════════════════════════════════════
function aiSay(text) {
  state.aiMessages.push({ role: 'assistant', content: text });
  renderMessages();
}

function renderMessages() {
  const box = $('aiMessages');
  if (!box) return;
  box.innerHTML = state.aiMessages.map(m => `
    <div class="msg ${m.role === 'assistant' ? 'msg-ai' : 'msg-user'}">
      ${m.role === 'assistant' ? renderMd(m.content) : m.content}
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

function renderMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function sendAiMessage() {
  const input = $('aiInput');
  const text  = input?.value.trim();
  if (!text || state.aiThinking) return;
  input.value = '';

  state.aiMessages.push({ role: 'user', content: text });
  renderMessages();
  state.aiThinking = true;
  const thinkLabel = $('aiThinkingLabel');
  if (thinkLabel) thinkLabel.style.display = 'block';

  const exerciseCtx = state.exercise
    ? `The user is currently doing: ${EXERCISES[state.exercise]?.name}. Form score: ${state.formScore}%.`
    : 'No exercise selected yet.';

  const systemPrompt = `You are an expert personal trainer and exercise form coach AI embedded in a workout app.
Keep responses concise (2-4 sentences max), motivating, and specific.
Use fitness terminology. Format: plain text with **bold** for key terms.
${exerciseCtx}
Workout stats: ${state.reps} total reps, ${state.sets} sets, ${Math.round(state.calories)} calories.`;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        system: systemPrompt,
        messages: state.aiMessages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-10)
      })
    });

    const data = await resp.json();
    if (data.error) {
      aiSay(`⚠️ AI error: ${data.error.message}. Check your API key configuration.`);
    } else {
      aiSay(data.content?.[0]?.text || 'Sorry, I could not generate a response.');
    }
  } catch (err) {
    aiSay('⚠️ Could not reach AI. Check your internet connection or API key.');
    console.error('[AI]', err);
  } finally {
    state.aiThinking = false;
    if (thinkLabel) thinkLabel.style.display = 'none';
  }
}

// ══════════════════════════════════════════════════════════════════════════
// ANALYZE FRAME
// ══════════════════════════════════════════════════════════════════════════
async function analyzeCurrentFrame() {
  if (!state.isCameraOn || !state.tracker) { toast('📷 Start your camera first!', 'error'); return; }
  const kps = state.tracker.getKeypoints();
  if (!kps) { toast('🧍 No pose detected. Make sure you\'re visible in frame.', 'error'); return; }
  if (!state.exercise) { toast('⚠️ Select an exercise first!', 'error'); return; }

  const ex     = EXERCISES[state.exercise];
  const result = ex.analyze(kps, canvas.height);
  if (!result) { toast('Could not analyze pose. Try adjusting your position.', 'info'); return; }

  const summary = `Score: ${result.score}%${result.angle ? `, Angle: ${result.angle}°` : ''}. ${result.feedback.join(' ')} ${result.corrections.join(' ')}`;
  aiSay(`📸 Snapshot analysis — ${summary}`);
  toast('✅ Frame analyzed!', 'success');
}

// ══════════════════════════════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════════════════════════════
function saveSet() {
  const record = {
    date:      new Date().toISOString(),
    exercise:  state.exercise,
    name:      EXERCISES[state.exercise]?.name,
    emoji:     EXERCISES[state.exercise]?.emoji,
    set:       state.sets,
    reps:      state.targetSetReps,
    formScore: state.formScore,
    calories:  Math.round(state.calories)
  };
  state.workoutHistory.unshift(record);
  if (state.workoutHistory.length > 100) state.workoutHistory.pop();
  localStorage.setItem('formCoachHistory', JSON.stringify(state.workoutHistory));
  renderHistory();
}

function loadHistory() {
  const saved = localStorage.getItem('formCoachHistory');
  if (saved) {
    try { state.workoutHistory = JSON.parse(saved); } catch { state.workoutHistory = []; }
  }
}

function renderHistory() {
  const container = $('historyGrid');
  if (!container) return;

  if (state.workoutHistory.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:20px;grid-column:1/-1;">No workout history yet. Start training!</p>`;
    return;
  }

  container.innerHTML = state.workoutHistory.slice(0, 50).map(r => {
    const scoreClass = r.formScore >= 80 ? 'good' : r.formScore >= 60 ? 'avg' : 'poor';
    const scoreLabel = r.formScore >= 80 ? '🟢' : r.formScore >= 60 ? '🟡' : '🔴';
    return `
      <div class="history-card">
        <div class="h-ex">${r.emoji || '💪'} ${r.name}</div>
        <div class="h-meta">
          📅 ${new Date(r.date).toLocaleDateString()}<br>
          Set ${r.set} · ${r.reps} reps · ${r.calories} cal
        </div>
        <span class="h-score ${scoreClass}">${scoreLabel} ${r.formScore}% form</span>
      </div>
    `;
  }).join('');
}

function clearHistory() {
  if (!confirm('Clear all workout history?')) return;
  state.workoutHistory = [];
  localStorage.removeItem('formCoachHistory');
  renderHistory();
  toast('History cleared.', 'info');
}

// ══════════════════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════════════════
function updateFeedback(html) {
  const el = $('liveFormText');
  if (el) el.innerHTML = html;
}

function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => el.remove(), 350);
  }, 3000);
}
