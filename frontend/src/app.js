// app.js - AI Form Coach

const state = {
  userId: null,
  username: null,
  isGuest: false,
  currentPage: null,
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
  lastSavedCalories: 0,
  workoutHistory: [],
  historyRange: 'all',
  historyView: 'daily',
  dashboardWeekly: null,
  dashboardLifetime: null,
  plankTimerInterval: null,
  plankElapsed: 0,
  plankDuration: 30,
  isCameraOn: false,
  tracker: null,
  aiMessages: [],
  aiThinking: false
};

const $ = id => document.getElementById(id);
const SESSION_STORAGE_KEY = 'formCoachSession';
const GUEST_HISTORY_KEY = 'formCoachGuestHistory';
const LOCAL_MIGRATION_KEY = 'formCoachDatabaseMigrations';

let video;
let canvas;

function renderIcons() {
  if (window.lucide) window.lucide.createIcons();
}

function exerciseIcon(key) {
  return ({
    squat: 'activity',
    pushup: 'move-down',
    lunge: 'footprints',
    plank: 'minus',
    deadlift: 'dumbbell',
    bicepCurl: 'armchair'
  })[key] || 'dumbbell';
}

function persistSession() {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
    userId: state.userId,
    username: state.username,
    isGuest: state.isGuest
  }));
}

function clearPersistedSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    credentials: 'same-origin'
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status}).`);
  }

  return payload;
}

function startOfDay(date) {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

function getHistoryRangeLabel(range) {
  return ({
    today: 'Today',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
    '90d': 'Last 90 days',
    year: 'This year',
    all: 'All time'
  })[range] || 'All time';
}

function filterHistoryByRange(records, range) {
  if (range === 'all') return records;

  const now = new Date();

  if (range === 'today') {
    const start = startOfDay(now);
    return records.filter(record => new Date(record.date) >= start);
  }

  if (range === '7d') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 6);
    return records.filter(record => new Date(record.date) >= start);
  }

  if (range === '30d') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 29);
    return records.filter(record => new Date(record.date) >= start);
  }

  if (range === '90d') {
    const start = startOfDay(now);
    start.setDate(start.getDate() - 89);
    return records.filter(record => new Date(record.date) >= start);
  }

  if (range === 'year') {
    return records.filter(record => {
      const recordDate = new Date(record.date);
      return recordDate.getFullYear() === now.getFullYear();
    });
  }

  return records;
}

function summarizeRecords(records) {
  const totalReps = records.reduce((sum, record) => sum + (record.reps || 0), 0);
  const totalSets = records.length;
  const totalCals = records.reduce((sum, record) => sum + (record.calories || 0), 0);
  const avgForm = totalSets
    ? Math.round(records.reduce((sum, record) => sum + (record.formScore || 0), 0) / totalSets)
    : null;

  return { totalReps, totalSets, totalCals, avgForm };
}

function renderHistoryRangeButtons() {
  document.querySelectorAll('.history-range-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.range === state.historyRange);
  });
}

async function setHistoryRange(range) {
  state.historyRange = range;
  renderHistoryRangeButtons();
  if (!state.isGuest) await loadHistory(range);
  renderHistory();
}

function setHistoryView(view) {
  state.historyView = view;
  document.querySelectorAll('.history-view-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.view === view);
  });
  renderHistory();
}

function buildWeeklyChart(records) {
  const chart = $('weeklyAnalyticsBars');
  if (!chart) return;

  const today = startOfDay(new Date());
  const days = [];

  for (let offset = 6; offset >= 0; offset--) {
    const date = new Date(today);
    date.setDate(today.getDate() - offset);
    days.push(date);
  }

  const dayTotals = days.map(date => {
    const dayStart = startOfDay(date);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const value = records
      .filter(record => {
        const recordDate = new Date(record.date);
        return recordDate >= dayStart && recordDate < dayEnd;
      })
      .reduce((sum, record) => sum + (record.calories || 0), 0);

    return {
      label: date.toLocaleDateString(undefined, { weekday: 'short' }),
      value
    };
  });

  const maxValue = Math.max(...dayTotals.map(day => day.value), 1);

  chart.innerHTML = dayTotals.map(day => {
    const height = day.value === 0 ? 12 : Math.max(18, Math.round((day.value / maxValue) * 100));
    return `<span style="--h:${height}%"><b>${day.label}</b></span>`;
  }).join('');
}

function showLoginPage() {
  $('page-login').style.display = 'flex';
  $('app-shell').style.display = 'none';
}

document.addEventListener('DOMContentLoaded', async () => {
  video = $('video');
  canvas = $('canvas');

  const aiInput = $('aiInput');
  if (aiInput) {
    aiInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') sendAiMessage();
    });
  }

  const savedSession = localStorage.getItem(SESSION_STORAGE_KEY);

  if (!savedSession) {
    showLoginPage();
    renderIcons();
    return;
  }

  try {
    const parsed = JSON.parse(savedSession);
    state.userId = parsed.userId || null;
    state.username = parsed.username || null;
    state.isGuest = Boolean(parsed.isGuest);

    if (state.isGuest) {
      await bootApp();
    } else {
      const session = await apiFetch('/api/auth/session');
      state.userId = session.user.id;
      state.username = session.user.username;
      await bootApp();
    }
  } catch (_error) {
    clearPersistedSession();
    showLoginPage();
  }

  renderIcons();
});

async function handleLogin() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value.trim();

  if (!username) {
    showLoginError('Please enter a username.');
    return;
  }

  if (!password) {
    showLoginError('Please enter a password.');
    return;
  }

  try {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    $('loginError').style.display = 'none';
    await loginSuccess(data.user, false);
  } catch (error) {
    showLoginError(error.message);
  }
}

async function handleRegister() {
  const username = $('loginUsername').value.trim();
  const password = $('loginPassword').value.trim();

  if (!username || username.length < 2) {
    showLoginError('Username must be at least 2 characters.');
    return;
  }

  if (!password || password.length < 8) {
    showLoginError('Password must be at least 8 characters.');
    return;
  }

  try {
    const data = await apiFetch('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });

    $('loginError').style.display = 'none';
    await loginSuccess(data.user, false);
    toast('Account created. Welcome.', 'success');
  } catch (error) {
    showLoginError(error.message);
  }
}

async function handleGuest() {
  await loginSuccess({ id: null, username: 'Guest' }, true);
}

async function loginSuccess(user, isGuest) {
  state.userId = user?.id || null;
  state.username = user?.username || 'Guest';
  state.isGuest = isGuest;
  persistSession();
  await bootApp();
}

async function handleLogout() {
  if (!state.isGuest) {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch (_error) {
      // Keep local logout even if server logout fails.
    }
  }

  clearPersistedSession();

  state.userId = null;
  state.username = null;
  state.isGuest = false;
  state.exercise = null;
  state.workoutHistory = [];
  state.aiMessages = [];

  if (state.isCameraOn) stopCamera();

  $('app-shell').style.display = 'none';
  $('page-login').style.display = 'flex';
  $('loginUsername').value = '';
  $('loginPassword').value = '';
  toast('Logged out.', 'info');
}

function showLoginError(message) {
  const element = $('loginError');
  element.textContent = message;
  element.style.display = 'block';
}

async function bootApp() {
  $('page-login').style.display = 'none';
  $('app-shell').style.display = 'flex';

  const initial = (state.username || 'G').charAt(0).toUpperCase();
  $('userAvatar').textContent = initial;
  $('userNameSidebar').textContent = state.username;
  $('topbarUser').textContent = state.username;

  state.aiMessages = [];
  if (!state.isGuest) await migrateLocalHistory();
  await loadHistory();
  renderLibrary();
  renderHistoryRangeButtons();
  setHistoryView(state.historyView);

  aiSay(`Hey ${state.username === 'Guest' ? 'there' : state.username}. I am your AI Form Coach. Select an exercise, start your camera, then hit Start Set. I will track your form in real time.`);

  showPage('dashboard');
  toast('AI Form Coach ready.', 'success');
}

function showPage(name) {
  const pages = ['dashboard', 'exercises', 'workout', 'history'];

  pages.forEach(page => {
    const element = $(`page-${page}`);
    if (element) element.style.display = 'none';
  });

  document.querySelectorAll('.nav-item[data-page]').forEach(element => {
    element.classList.remove('active');
  });

  const target = $(`page-${name}`);
  if (target) {
    target.style.display = 'block';
    target.style.animation = 'none';
    void target.offsetWidth;
    target.style.animation = 'fade-up 0.3s ease';
  }

  const navButton = document.querySelector(`.nav-item[data-page="${name}"]`);
  if (navButton) navButton.classList.add('active');

  state.currentPage = name;

  if (name === 'dashboard') refreshDashboard();
  if (name === 'history') setHistoryRange(state.historyRange).catch(error => toast(error.message, 'error'));
  if (name === 'workout' && !state.exercise) {
    toast('Select an exercise from the library first.', 'info');
  }

  closeSidebar();
  renderIcons();
}

function toggleSidebar() {
  $('sidebar').classList.toggle('open');
  $('sidebarOverlay').classList.toggle('open');
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebarOverlay').classList.remove('open');
}

async function refreshDashboard() {
  const heroTitle = $('welcomeMsg');
  if (heroTitle) {
    heroTitle.innerHTML = `WELCOME BACK <span>${state.username === 'Guest' ? 'ATHLETE' : state.username.toUpperCase()}</span>`;
  }

  let weeklySummary;
  let lifetimeSummary;
  if (state.isGuest) {
    const weekly = summarizeRecords(filterHistoryByRange(state.workoutHistory, '7d'));
    const lifetime = summarizeRecords(state.workoutHistory);
    weeklySummary = { reps: weekly.totalReps, sets: weekly.totalSets, calories: weekly.totalCals, averageFormScore: weekly.avgForm };
    lifetimeSummary = { reps: lifetime.totalReps, sets: lifetime.totalSets, calories: lifetime.totalCals, averageFormScore: lifetime.avgForm };
  } else {
    try {
      [weeklySummary, lifetimeSummary] = await Promise.all([
        apiFetch('/api/dashboard/weekly'),
        apiFetch('/api/dashboard/lifetime')
      ]);
      state.dashboardWeekly = weeklySummary;
      state.dashboardLifetime = lifetimeSummary;
    } catch (error) {
      console.error('[Dashboard]', error);
      return;
    }
  }

  $('dashTotalReps').textContent = weeklySummary.reps;
  $('dashTotalSets').textContent = weeklySummary.sets;
  $('dashCalories').textContent = Math.round(weeklySummary.calories);
  $('dashFormScore').textContent = weeklySummary.averageFormScore !== null ? `${weeklySummary.averageFormScore}%` : '--';

  const performanceScore = lifetimeSummary.averageFormScore !== null ? lifetimeSummary.averageFormScore : 0;
  const perfEl = $('performanceScore');
  const heroReady = $('heroReadiness');
  const ring = document.querySelector('.performance-ring');

  if (perfEl) perfEl.textContent = performanceScore;
  if (heroReady) heroReady.textContent = `${performanceScore}%`;
  if (ring) ring.style.setProperty('--score', performanceScore);

  buildWeeklyChart(filterHistoryByRange(state.workoutHistory, '7d'));
  renderRecentActivity();

  const dashGrid = $('dashExerciseGrid');
  if (dashGrid) {
    const keys = Object.keys(EXERCISES).slice(0, 6);
    dashGrid.innerHTML = keys.map(key => {
      const exercise = EXERCISES[key];
      return `
        <div class="ex-card" data-ex="${key}" onclick="quickSelectExercise('${key}')">
          <div class="ex-icon"><i data-lucide="${exerciseIcon(key)}"></i></div>
          <div class="ex-name">${exercise.name}</div>
          <div class="ex-desc">${exercise.musclesWorked?.[0] || ''}</div>
        </div>
      `;
    }).join('');
  }

  renderIcons();
}

function renderRecentActivity() {
  const container = $('recentActivity');
  if (!container) return;

  if (state.workoutHistory.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);font-size:0.88rem;">No workouts yet - start training!</p>`;
    return;
  }

  const recent = state.workoutHistory.slice(0, 5);
  container.innerHTML = recent.map(record => {
    const scoreClass = record.formScore >= 80 ? 'good' : record.formScore >= 60 ? 'avg' : 'poor';
    const effort = record.duration ? `${record.duration}s hold` : `${record.reps} reps`;
    return `
      <div class="recent-item">
        <span class="ri-icon"><i data-lucide="activity"></i></span>
        <div>
          <div class="ri-name">${record.name}</div>
          <div class="ri-meta">${new Date(record.date).toLocaleDateString()} · Set ${record.set} · ${effort}</div>
        </div>
        <div class="ri-score ${scoreClass}">${record.formScore}%</div>
      </div>
    `;
  }).join('');
}

function quickSelectExercise(key) {
  selectExercise(key);
  showPage('workout');
}

const EXERCISE_CATEGORIES = {
  squat: ['lower', 'compound'],
  pushup: ['upper', 'compound'],
  lunge: ['lower'],
  plank: ['core'],
  deadlift: ['lower', 'compound'],
  bicepCurl: ['upper']
};

function filterExercises(filter, button) {
  document.querySelectorAll('.filter-btn').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  renderLibrary(filter);
}

function renderLibrary(filter = 'all') {
  const container = $('libraryGrid');
  if (!container) return;

  const difficulty = {
    squat: 'intermediate',
    pushup: 'beginner',
    lunge: 'beginner',
    plank: 'beginner',
    deadlift: 'advanced',
    bicepCurl: 'beginner'
  };

  const entries = Object.entries(EXERCISES).filter(([key]) => {
    if (filter === 'all') return true;
    return (EXERCISE_CATEGORIES[key] || []).includes(filter);
  });

  if (entries.length === 0) {
    container.innerHTML = `<div class="card"><p style="color:var(--text-muted);">No exercises in this category.</p></div>`;
    return;
  }

  container.innerHTML = entries.map(([key, exercise]) => {
    const diff = difficulty[key] || 'beginner';
    const tags = (EXERCISE_CATEGORIES[key] || [])
      .map(tag => `<span class="muscle-tag" style="text-transform:uppercase;font-size:0.65rem;">${tag}</span>`)
      .join('');

    const preview = exercise.steps.slice(0, 3).map((step, index) => `
      <div class="lib-step-row">
        <span class="lib-step-num">${index + 1}.</span>
        <span>${step.title} - ${step.desc}</span>
      </div>
    `).join('');

    return `
      <div class="lib-card" onclick="selectExerciseAndGo('${key}')">
        <div class="lib-card-header">
          <div class="lib-icon"><i data-lucide="${exerciseIcon(key)}"></i></div>
          <div>
            <div class="lib-title">${exercise.name}</div>
            <div class="lib-cals">~${exercise.caloriesPerRep} cal/rep</div>
            <div style="display:flex;gap:5px;margin-top:6px;flex-wrap:wrap;align-items:center;">
              <span class="difficulty-tag diff-${diff}">${diff}</span>
              ${tags}
            </div>
          </div>
        </div>
        <div class="muscle-tags">
          ${(exercise.musclesWorked || []).map(muscle => `<span class="muscle-tag">${muscle}</span>`).join('')}
        </div>
        <div class="lib-steps-preview">${preview}</div>
        <button class="lib-start-btn"><i data-lucide="play"></i> Start this exercise</button>
      </div>
    `;
  }).join('');

  renderIcons();
}

function selectExerciseAndGo(key) {
  selectExercise(key);
  showPage('workout');
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user'
      }
    });

    video.srcObject = stream;
    await video.play();

    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;

    $('noCameraMsg').style.display = 'none';
    $('startCamBtn').disabled = true;
    $('stopCamBtn').disabled = false;
    state.isCameraOn = true;

    if (!state.tracker) {
      toast('Loading AI body tracker...', 'info');
      state.tracker = new PoseTracker(video, canvas);
      await state.tracker.load();
      toast('Body tracker loaded.', 'success');
    }

    state.tracker.onPose = handlePose;
    state.tracker.start();
    aiSay('Camera active! Select an exercise and hit Start Set when ready.');
  } catch (error) {
    toast('Camera access denied. Please allow camera permissions.', 'error');
    console.error(error);
  }
}

function stopCamera() {
  if (video && video.srcObject) {
    video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null;
  }

  if (state.tracker) state.tracker.stop();

  state.isCameraOn = false;
  $('noCameraMsg').style.display = 'flex';
  $('startCamBtn').disabled = false;
  $('stopCamBtn').disabled = true;
  updateFeedback('Camera stopped.');
}

function handlePose(pose) {
  if (!state.exercise || !state.isSetActive) return;

  const exercise = EXERCISES[state.exercise];
  if (!exercise?.analyze) return;

  const result = exercise.analyze(pose.keypoints, canvas.height);
  if (!result) return;

  state.formScore = Math.round(state.formScore * 0.7 + result.score * 0.3);

  const primaryScore = $('formScoreNum');
  const secondaryScore = $('formScoreNum2');
  const fill = $('scoreFill');

  if (primaryScore) primaryScore.textContent = state.formScore;
  if (secondaryScore) secondaryScore.textContent = state.formScore;
  if (fill) fill.style.width = `${state.formScore}%`;

  const angleDisplay = $('angleDisplay');
  if (angleDisplay && result.angle != null) {
    angleDisplay.textContent = `JOINT ANGLE: ${result.angle}°`;
  }

  let html = result.feedback.map(message => `<div>${message}</div>`).join('');
  if (result.corrections.length) {
    html += result.corrections.map(message => `<div class="correction-tip">${message}</div>`).join('');
  }
  updateFeedback(html);

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

function countRep() {
  state.reps++;
  state.setReps++;
  state.calories += EXERCISES[state.exercise]?.caloriesPerRep || 0.4;

  $('repCount').textContent = state.reps;
  $('calorieCount').textContent = Math.round(state.calories);

  const counter = $('repCounter');
  if (counter) {
    counter.textContent = `${state.setReps} / ${state.targetSetReps} REPS`;
    counter.classList.remove('rep-pop');
    void counter.offsetWidth;
    counter.classList.add('rep-pop');
  }

  if (state.setReps >= state.targetSetReps) completeSet();
}

function completeSet() {
  clearInterval(state.plankTimerInterval);
  state.sets++;
  state.setReps = 0;
  state.isSetActive = false;

  $('setCount').textContent = state.sets;
  $('repCounter').textContent = `SET ${state.sets} COMPLETE`;
  $('startSetBtn').disabled = false;

  saveSet().catch(error => {
    toast(error.message, 'error');
  });

  toast(`Set ${state.sets} complete! Rest 60 seconds.`, 'success');
  aiSay(`Excellent! Set ${state.sets} done with ${state.formScore}% form score. Rest 60 seconds, then go again. Keep your ${EXERCISES[state.exercise]?.name} form tight!`);
}

function startSet() {
  if (!state.exercise) {
    toast('Select an exercise first.', 'error');
    return;
  }

  if (!state.isCameraOn) {
    toast('Start your camera first.', 'error');
    return;
  }

  const exercise = EXERCISES[state.exercise];

  state.isSetActive = true;
  state.setReps = 0;
  state.repPhase = 'up';

  $('startSetBtn').disabled = true;

  if (exercise?.isTimerExercise) {
    state.plankElapsed = 0;
    state.plankDuration = parseInt($('targetRepsSelect')?.value, 10) || exercise.defaultDuration || 30;
    $('repCounter').textContent = `${state.plankDuration}s remaining`;

    clearInterval(state.plankTimerInterval);
    state.plankTimerInterval = setInterval(() => {
      state.plankElapsed++;
      const remaining = state.plankDuration - state.plankElapsed;

      const counter = $('repCounter');
      if (counter) {
        counter.textContent = remaining > 0 ? `${remaining}s remaining` : `TIME'S UP!`;
        counter.classList.remove('rep-pop');
        void counter.offsetWidth;
        counter.classList.add('rep-pop');
      }

      state.calories += exercise.caloriesPerRep;
      $('calorieCount').textContent = Math.round(state.calories);

      if (state.plankElapsed >= state.plankDuration) {
        clearInterval(state.plankTimerInterval);
        completeSet();
      }
    }, 1000);

    toast(`Hold for ${state.plankDuration} seconds.`, 'success');
    aiSay(`Timer started! Hold your plank for ${state.plankDuration} seconds. Keep your core tight and breathe steadily.`);
  } else {
    $('repCounter').textContent = `0 / ${state.targetSetReps} REPS`;
    toast('Set started. Go.', 'success');
    aiSay(`Ready. Go for your ${state.targetSetReps} ${exercise?.name} reps. I am watching your form.`);
  }
}

function resetWorkout() {
  clearInterval(state.plankTimerInterval);
  state.plankElapsed = 0;
  state.reps = 0;
  state.sets = 0;
  state.calories = 0;
  state.lastSavedCalories = 0;
  state.formScore = 100;
  state.setReps = 0;
  state.isSetActive = false;

  $('repCount').textContent = '0';
  $('setCount').textContent = '0';
  $('calorieCount').textContent = '0';
  $('formScoreNum').textContent = '100';
  $('formScoreNum2').textContent = '100';
  $('scoreFill').style.width = '100%';
  $('repCounter').textContent = 'READY TO TRAIN';
  $('startSetBtn').disabled = false;

  toast('Workout reset.', 'info');
}

function selectExercise(key) {
  state.exercise = key;
  state.isSetActive = false;
  state.setReps = 0;
  state.repPhase = 'up';
  clearInterval(state.plankTimerInterval);

  document.querySelectorAll('.ex-card').forEach(card => {
    card.classList.toggle('selected', card.dataset.ex === key);
  });

  const exercise = EXERCISES[key];
  const selectEl = $('targetRepsSelect');
  const labelEl = selectEl?.previousElementSibling;

  if (selectEl) {
    if (exercise?.isTimerExercise) {
      selectEl.innerHTML = `
        <option value="20">20s</option>
        <option value="30" selected>30s</option>
        <option value="45">45s</option>
        <option value="60">60s</option>
        <option value="90">90s</option>
        <option value="120">2 min</option>
      `;
      if (labelEl) labelEl.textContent = 'Hold duration:';
    } else {
      selectEl.innerHTML = `
        <option value="5">5</option>
        <option value="8">8</option>
        <option value="10" selected>10</option>
        <option value="12">12</option>
        <option value="15">15</option>
        <option value="20">20</option>
      `;
      if (labelEl) labelEl.textContent = 'Target reps:';
      state.targetSetReps = parseInt(selectEl.value, 10);
      selectEl.onchange = () => {
        state.targetSetReps = parseInt(selectEl.value, 10);
      };
    }
  }

  renderCorrectionPanel(key);
  loadYoutube(exercise.ytEmbed, exercise.name);

  $('workoutPageTitle').textContent = 'LIVE TRAINING';
  $('workoutExerciseName').textContent = exercise.name;
  $('repCounter').textContent = 'SELECT READY - HIT START';
  $('startSetBtn').disabled = false;

  updateFeedback(`Ready for ${exercise.name}. Start camera and hit Start Set.`);
  toast(`Selected: ${exercise.name}`, 'success');
  aiSay(`Great choice! **${exercise.name}** works your ${exercise.musclesWorked?.join(', ')}. Key tip: ${exercise.steps[0].fix}. Start your set when ready!`);
}

function renderExerciseGrid() {
  // Kept for compatibility with the existing page structure.
}

function renderCorrectionPanel(key) {
  const container = $('correctionPanel');
  if (!container) return;

  const exercise = EXERCISES[key];
  if (!exercise) return;

  container.innerHTML = `
    <div class="card-title"><i data-lucide="clipboard-check"></i> ${exercise.name.toUpperCase()} - FORM GUIDE</div>
    <div class="muscle-tags" style="margin-bottom:14px;">
      ${(exercise.musclesWorked || []).map(muscle => `<span class="muscle-tag">${muscle}</span>`).join('')}
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;font-family:'JetBrains Mono',monospace;">
      STEP-BY-STEP CUE
    </div>
    <div class="steps-list">
      ${exercise.steps.map((step, index) => `
        <div class="step-item" onclick="highlightStep(${index})">
          <div class="step-visual"><i data-lucide="${step.icon || 'circle'}"></i></div>
          <div class="step-info">
            <div class="step-title">${step.title}</div>
            <div class="step-desc">${step.desc}</div>
            <div class="step-fix">${step.fix}</div>
          </div>
        </div>
      `).join('')}
    </div>
    <div style="font-size:0.72rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin:14px 0 6px;font-family:'JetBrains Mono',monospace;">
      COMMON MISTAKES
    </div>
    <div class="mistakes-list">
      ${exercise.mistakes.map(item => `
        <div class="mistake-item">
          <div class="mistake-bad">${item.bad}</div>
          <div class="mistake-good">${item.good}</div>
        </div>
      `).join('')}
    </div>
  `;

  renderIcons();
}

function highlightStep(index) {
  document.querySelectorAll('.step-item').forEach((element, currentIndex) => {
    element.classList.toggle('active', currentIndex === index);
  });
}

function loadYoutube(videoId, exerciseName) {
  const container = $('ytContainer');
  if (!container) return;

  if (!videoId) {
    container.innerHTML = `<div class="yt-placeholder">No video found for this exercise.</div>`;
    return;
  }

  container.innerHTML = `
    <div class="yt-header"><i data-lucide="youtube"></i> REFERENCE VIDEO - ${exerciseName.toUpperCase()}</div>
    <div class="yt-embed-container">
      <iframe
        src="https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1"
        title="${exerciseName} form guide"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        loading="lazy"
      ></iframe>
    </div>
  `;

  renderIcons();
}

function aiSay(text) {
  state.aiMessages.push({ role: 'assistant', content: text });
  renderMessages();
}

function renderMessages() {
  const box = $('aiMessages');
  if (!box) return;

  box.innerHTML = state.aiMessages.map(message => `
    <div class="msg ${message.role === 'assistant' ? 'msg-ai' : 'msg-user'}">
      ${message.role === 'assistant' ? renderMd(message.content) : message.content}
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
  const sendButton = input?.nextElementSibling;
  const text = input?.value.trim();

  if (!text || state.aiThinking) return;

  input.value = '';
  state.aiMessages.push({ role: 'user', content: text });
  renderMessages();

  state.aiThinking = true;
  const thinkLabel = $('aiThinkingLabel');
  if (thinkLabel) thinkLabel.style.display = 'block';
  if (sendButton) sendButton.disabled = true;

  const exerciseContext = state.exercise
    ? `User is currently training: ${EXERCISES[state.exercise]?.name}. Current form score: ${state.formScore}%. Muscles targeted: ${EXERCISES[state.exercise]?.musclesWorked?.join(', ')}.`
    : 'No exercise selected yet.';

  const systemPrompt =
    `You are an expert personal trainer and real-time exercise form coach embedded inside an AI Form Coach web app that uses live pose detection.\n` +
    `Keep every response concise (2-4 sentences max), motivating, and precise.\n` +
    `Use fitness terminology. Format: plain text with **bold** for key terms.\n` +
    `${exerciseContext}\n` +
    `Session stats: ${state.reps} total reps · ${state.sets} sets · ${Math.round(state.calories)} kcal burned.\n` +
    `Always prioritize safety and proper form over speed or load.`;

  try {
    const data = await apiFetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        systemPrompt,
        messages: state.aiMessages
          .filter(message => message.role === 'user' || message.role === 'assistant')
          .slice(-12)
      })
    });

    aiSay(data.reply || 'Sorry, I could not generate a response.');
  } catch (error) {
    if (!navigator.onLine) {
      aiSay('You appear to be offline. Check your internet connection.');
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      aiSay('Cannot reach the server. Is `npm start` running on port 3000?');
    } else {
      aiSay(error.message);
    }
    console.error('[AI Coach]', error);
  } finally {
    state.aiThinking = false;
    if (thinkLabel) thinkLabel.style.display = 'none';
    if (sendButton) sendButton.disabled = false;
    if (input) input.focus();
  }
}

async function analyzeCurrentFrame() {
  if (!state.isCameraOn || !state.tracker) {
    toast('Start your camera first.', 'error');
    return;
  }

  const keypoints = state.tracker.getKeypoints();
  if (!keypoints) {
    toast('No pose detected. Make sure you are visible in frame.', 'error');
    return;
  }

  if (!state.exercise) {
    toast('Select an exercise first.', 'error');
    return;
  }

  const exercise = EXERCISES[state.exercise];
  const result = exercise.analyze(keypoints, canvas.height);
  if (!result) {
    toast('Could not analyze pose. Try adjusting your position.', 'info');
    return;
  }

  const summary = `Score: ${result.score}%${result.angle ? `, Angle: ${result.angle}°` : ''}. ${result.feedback.join(' ')} ${result.corrections.join(' ')}`;
  aiSay(`Snapshot analysis - ${summary}`);
  toast('Frame analyzed.', 'success');
}

async function saveSet() {
  const exercise = EXERCISES[state.exercise];
  const isTimer = exercise?.isTimerExercise;
  const setCalories = Math.max(0, Math.round(state.calories - state.lastSavedCalories));

  const record = {
    date: new Date().toISOString(),
    exercise: state.exercise,
    name: exercise?.name,
    set: state.sets,
    reps: isTimer ? state.plankDuration : state.targetSetReps,
    duration: isTimer ? state.plankDuration : null,
    formScore: state.formScore,
    calories: setCalories
  };

  if (state.isGuest) {
    state.workoutHistory.unshift(record);
    localStorage.setItem(GUEST_HISTORY_KEY, JSON.stringify(state.workoutHistory));
  } else {
    const data = await apiFetch('/api/workouts', {
      method: 'POST',
      body: JSON.stringify(record)
    });
    state.workoutHistory.unshift(data.workout);
  }

  state.lastSavedCalories = state.calories;
  if (!state.isGuest) await loadHistory(state.historyRange);
  renderHistory();
  refreshDashboard();
}

function readLegacyHistory() {
  const keys = [GUEST_HISTORY_KEY, 'formCoachWorkoutHistory', 'workoutHistory'];
  for (const key of keys) {
    try {
      const records = JSON.parse(localStorage.getItem(key) || 'null');
      if (Array.isArray(records) && records.length) return records;
    } catch (_error) {
      // Ignore malformed legacy browser data.
    }
  }
  return [];
}

async function migrateLocalHistory() {
  const migratedUsers = JSON.parse(localStorage.getItem(LOCAL_MIGRATION_KEY) || '{}');
  if (migratedUsers[state.userId]) return;
  const records = readLegacyHistory();
  if (records.length) await apiFetch('/api/workouts/migrate', { method: 'POST', body: JSON.stringify({ workouts: records }) });
  migratedUsers[state.userId] = true;
  localStorage.setItem(LOCAL_MIGRATION_KEY, JSON.stringify(migratedUsers));
}

async function loadHistory(range = state.historyRange) {
  if (state.isGuest) {
    const saved = localStorage.getItem(GUEST_HISTORY_KEY);
    if (saved) {
      try {
        state.workoutHistory = JSON.parse(saved);
      } catch (_error) {
        state.workoutHistory = [];
      }
    } else {
      state.workoutHistory = [];
    }
    return;
  }

  const data = await apiFetch(`/api/history?range=${encodeURIComponent(range)}`);
  state.workoutHistory = data.workouts || [];
}

function renderHistory() {
  const container = $('historyGrid');
  const label = $('historyRangeLabel');
  const filtered = state.isGuest ? filterHistoryByRange(state.workoutHistory, state.historyRange) : state.workoutHistory;
  const summary = summarizeRecords(filtered);

  if (label) {
    label.textContent = `${getHistoryRangeLabel(state.historyRange)} · ${summary.totalSets} sets · ${summary.totalReps} reps`;
  }

  if (!container) return;

  if (filtered.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:20px;grid-column:1/-1;">No workout history found for ${getHistoryRangeLabel(state.historyRange).toLowerCase()}.</p>`;
    return;
  }

  const records = state.historyView === 'daily' ? filtered : groupHistoryRecords(filtered, state.historyView);
  container.innerHTML = records.slice(0, 120).map(record => {
    const scoreClass = record.formScore >= 80 ? 'good' : record.formScore >= 60 ? 'avg' : 'poor';
    return `
      <div class="history-card">
        <div class="h-ex">${record.name}</div>
        <div class="h-meta">
          ${record.period || new Date(record.date).toLocaleDateString()}<br>
          ${record.period ? `${record.set} sets` : `Set ${record.set}`} · ${(record.duration || String(record.name || '').toLowerCase().includes('plank')) ? `${record.duration || record.reps}s hold` : `${record.reps} reps`} · ${record.calories} cal
        </div>
        <span class="h-score ${scoreClass}">${record.formScore}% form</span>
      </div>
    `;
  }).join('');

  renderIcons();
}

function groupHistoryRecords(records, view) {
  const groups = new Map();
  records.forEach(record => {
    const date = new Date(record.date);
    const key = view === 'weekly'
      ? `${date.getFullYear()}-W${Math.ceil((((date - new Date(date.getFullYear(), 0, 1)) / 86400000) + new Date(date.getFullYear(), 0, 1).getDay() + 1) / 7)}`
      : `${date.getFullYear()}-${date.getMonth()}`;
    const group = groups.get(key) || { ...record, reps: 0, set: 0, calories: 0, scoreTotal: 0, scoreCount: 0, period: view === 'weekly' ? `Week of ${date.toLocaleDateString()}` : date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) };
    group.reps += record.reps || 0;
    group.set++;
    group.calories += record.calories || 0;
    group.scoreTotal += record.formScore || 0;
    group.scoreCount++;
    group.formScore = Math.round(group.scoreTotal / group.scoreCount);
    group.name = view === 'weekly' ? 'Weekly Training Summary' : 'Monthly Training Summary';
    groups.set(key, group);
  });
  return [...groups.values()];
}

async function clearHistory() {
  if (!confirm('Clear all workout history?')) return;

  if (state.isGuest) {
    state.workoutHistory = [];
    localStorage.removeItem(GUEST_HISTORY_KEY);
  } else {
    await apiFetch('/api/workouts', { method: 'DELETE' });
    state.workoutHistory = [];
  }

  renderHistory();
  refreshDashboard();
  toast('History cleared.', 'info');
}

function updateFeedback(html) {
  const element = $('liveFormText');
  if (element) element.innerHTML = html;
}

function toast(message, type = 'info') {
  const element = document.createElement('div');
  element.className = `toast ${type}`;
  element.textContent = message;
  document.body.appendChild(element);

  setTimeout(() => {
    element.style.animation = 'toast-out 0.3s ease forwards';
    setTimeout(() => element.remove(), 350);
  }, 3000);
}
