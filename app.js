// app.js — AI Form Coach Main Application Logic
// FILE TYPE: JavaScript
// Integrates: PoseTracker, EXERCISES data, Claude AI API, YouTube embeds

// ── STATE ──────────────────────────────────────────────────────────────────
const state = {
    exercise: null, // current exercise key
    isSetActive: false,
    reps: 0,
    sets: 0,
    calories: 0,
    formScore: 100,
    lastRepTime: 0,
    repCooldown: 900, // ms between reps
    repPhase: 'up', // 'up' | 'down' (for rep counting logic)
    setReps: 0,
    targetSetReps: 10,
    workoutHistory: [],
    isCameraOn: false,
    aiMessages: [],
    aiThinking: false,
    tracker: null,
};

// ── DOM REFS ───────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
let video, canvas;

// ── INIT ───────────────────────────────────────────────────────────────────
async function init() {
    video = $('video');
    canvas = $('canvas');
    loadHistory();
    renderExerciseGrid();
    renderLibrary();
    switchTab('workout');
    aiSay("👋 Hey! I'm your AI Form Coach. Select an exercise, start your camera, then hit **Start Set**. I'll watch your form and correct you in real-time.");
    toast('🤖 AI Form Coach ready!', 'success');
}

// ── CAMERA ─────────────────────────────────────────────────────────────────
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }
        });
        video.srcObject = stream;
        await video.play();
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;

        $('noCameraMsg').style.display = 'none';
        $('startCamBtn').disabled = true;
        $('stopCamBtn').disabled = false;
        state.isCameraOn = true;

        // Load detector and start tracking
        if (!state.tracker) {
            toast('⏳ Loading AI body tracker...', 'info');
            state.tracker = new PoseTracker(video, canvas);
            await state.tracker.load();
            toast('✅ Body tracker loaded!', 'success');
        }

        state.tracker.onPose = handlePose;
        state.tracker.start();
        aiSay("📷 Camera active! I can see you. Select an exercise and start your set when ready.");

    } catch (err) {
        toast('❌ Camera access denied. Please allow camera permissions.', 'error');
        console.error(err);
    }
}

function stopCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(t => t.stop());
        video.srcObject = null;
    }
    if (state.tracker) state.tracker.stop();
    state.isCameraOn = false;
    $('noCameraMsg').style.display = 'flex';
    $('startCamBtn').disabled = false;
    $('stopCamBtn').disabled = true;
    updateFeedback('Camera stopped.');
}

// ── POSE HANDLER ───────────────────────────────────────────────────────────
function handlePose(pose) {
    if (!state.exercise || !state.isSetActive) return;
    const ex = EXERCISES[state.exercise];
    if (!ex || !ex.analyze) return;

    const result = ex.analyze(pose.keypoints, canvas.height);
    if (!result) return;

    // Update form score (smooth)
    state.formScore = Math.round(state.formScore * 0.7 + result.score * 0.3);
    $('formScoreNum').textContent = state.formScore;
    if ($('formScoreNum2')) $('formScoreNum2').textContent = state.formScore;
    $('scoreFill').style.width = `${state.formScore}%`;

    // Show angle
    if (result.angle !== null && result.angle !== undefined) {
        $('angleDisplay').textContent = `JOINT ANGLE: ${result.angle}°`;
    }

    // Update live feedback
    let html = result.feedback.map(f => `<div>${f}</div>`).join('');
    if (result.corrections.length > 0) {
        html += result.corrections.map(c => `<div class="correction-tip">🔧 ${c}</div>`).join('');
    }
    updateFeedback(html);

    // Rep counting logic (two-phase: down + up)
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

// ── REPS & SETS ────────────────────────────────────────────────────────────
function countRep(score) {
    state.reps++;
    state.setReps++;
    state.calories += EXERCISES[state.exercise]?.caloriesPerRep || 0.4;

    $('repCount').textContent = state.reps;
    $('calorieCount').textContent = Math.round(state.calories);

    const repEl = $('repCounter');
    repEl.textContent = `${state.setReps} / ${state.targetSetReps} REPS`;
    repEl.classList.remove('rep-pop');
    void repEl.offsetWidth; // reflow to restart animation
    repEl.classList.add('rep-pop');

    if (state.setReps >= state.targetSetReps) completeSet();
}

function completeSet() {
    state.sets++;
    state.setReps = 0;
    state.isSetActive = false;
    $('setCount').textContent = state.sets;
    $('repCounter').textContent = `SET ${state.sets} COMPLETE 🏆`;
    $('startSetBtn').disabled = false;

    saveSet();
    toast(`🏆 Set ${state.sets} complete! Rest 60 seconds.`, 'success');
    aiSay(`💪 Excellent! Set ${state.sets} done with ${state.formScore}% form score. Rest 60 seconds, then go again. Keep your ${EXERCISES[state.exercise]?.name} form tight!`);
}

function startSet() {
    if (!state.exercise) {
        toast('⚠️ Select an exercise first!', 'error');
        return;
    }
    if (!state.isCameraOn) {
        toast('📷 Start your camera first!', 'error');
        return;
    }
    state.isSetActive = true;
    state.setReps = 0;
    state.repPhase = 'up';
    $('repCounter').textContent = `0 / ${state.targetSetReps} REPS`;
    $('startSetBtn').disabled = false;
    toast(`▶️ Set started! Go!`, 'success');
    aiSay(`Ready! Go for your ${state.targetSetReps} ${EXERCISES[state.exercise]?.name} reps. I'm watching your form 👀`);
}

function resetWorkout() {
    state.reps = 0;
    state.sets = 0;
    state.calories = 0;
    state.formScore = 100;
    state.setReps = 0;
    state.isSetActive = false;
    $('repCount').textContent = '0';
    $('setCount').textContent = '0';
    $('calorieCount').textContent = '0';
    $('formScoreNum').textContent = '100';
    $('scoreFill').style.width = '100%';
    $('repCounter').textContent = 'READY TO TRAIN';
    $('startSetBtn').disabled = false;
    toast('🔄 Workout reset.', 'info');
}

// ── EXERCISE SELECTION ─────────────────────────────────────────────────────
function selectExercise(key) {
    state.exercise = key;
    state.isSetActive = false;
    state.setReps = 0;
    state.repPhase = 'up';

    // Update card highlights
    document.querySelectorAll('.ex-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.ex === key);
    });

    const ex = EXERCISES[key];
    renderCorrectionPanel(key);
    loadYoutube(ex.ytEmbed, ex.name);

    $('repCounter').textContent = `SELECT READY — HIT START`;
    updateFeedback(`Ready for ${ex.name}. Start camera and hit Start Set!`);

    toast(`Selected: ${ex.name}`, 'success');
    aiSay(`Great choice! **${ex.name}** works your ${ex.musclesWorked?.join(', ')}. Key tip: ${ex.steps[0].fix}. Start your set when ready!`);
}

// ── RENDER EXERCISE GRID ───────────────────────────────────────────────────
function renderExerciseGrid() {
    const container = $('exerciseGrid');
    container.innerHTML = Object.entries(EXERCISES).map(([key, ex]) => `
    <div class="ex-card" data-ex="${key}" onclick="selectExercise('${key}')">
      <div class="ex-emoji">${ex.emoji}</div>
      <div class="ex-name">${ex.name}</div>
      <div class="ex-desc">${ex.musclesWorked?.[0] || ''}</div>
    </div>
  `).join('');
}

function renderLibrary() {
    const container = $('libraryGrid');
    if (!container) return;
    container.innerHTML = Object.entries(EXERCISES).map(([key, ex]) => `
    <div class="card" style="margin-bottom:16px;">
      <div class="card-title">${ex.emoji} ${ex.name}</div>
      <div class="muscle-tags">
        ${(ex.musclesWorked || []).map(m => `<span class="muscle-tag">${m}</span>`).join('')}
      </div>
      <div class="steps-list" style="margin-top:12px;">
        ${ex.steps.map((s,i) => `
          <div class="step-item">
            <div class="step-visual">${s.visual}</div>
            <div class="step-info">
              <div class="step-title">${i+1}. ${s.title}</div>
              <div class="step-desc">${s.desc}</div>
              <div class="step-fix">💡 ${s.fix}</div>
            </div>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:14px;">
        <div class="card-title" style="font-size:1rem;">⚠️ COMMON MISTAKES</div>
        <div class="mistakes-list">
          ${ex.mistakes.map(m => `
            <div class="mistake-item">
              <div class="mistake-bad">❌ ${m.bad}</div>
              <div class="mistake-good">✅ ${m.good}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div style="margin-top:12px;">
        <a href="${ex.ytLink}" target="_blank" style="color:#ff6b6b;text-decoration:none;font-size:0.9rem;font-weight:600;">
          ▶ Watch on YouTube →
        </a>
      </div>
    </div>
  `).join('');
}

// ── CORRECTION PANEL ───────────────────────────────────────────────────────
function renderCorrectionPanel(key) {
  const ex = EXERCISES[key];
  const panel = $('correctionPanel');
  panel.innerHTML = `
    <div class="card-title">${ex.emoji} ${ex.name.toUpperCase()} — FORM GUIDE</div>
    <div class="muscle-tags">${(ex.musclesWorked||[]).map(m=>`<span class="muscle-tag">${m}</span>`).join('')}</div>

    <div style="margin-top:14px;">
      <div style="font-size:0.75rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;font-family:'JetBrains Mono',monospace;">
        STEP-BY-STEP FORM
      </div>
      <div class="steps-list">
        ${ex.steps.map((s,i)=>`
          <div class="step-item" id="step-${i}" onclick="highlightStep(${i})">
            <div class="step-visual">${s.visual}</div>
            <div class="step-info">
              <div class="step-title">${i+1}. ${s.title}</div>
              <div class="step-desc">${s.desc}</div>
              <div class="step-fix">💡 ${s.fix}</div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>

    <div style="margin-top:16px;">
      <div style="font-size:0.75rem;color:var(--text-muted);letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;font-family:'JetBrains Mono',monospace;">
        ⚠️ COMMON MISTAKES
      </div>
      <div class="mistakes-list">
        ${ex.mistakes.map(m=>`
          <div class="mistake-item">
            <div class="mistake-bad">❌ ${m.bad}</div>
            <div class="mistake-good">✅ ${m.good}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function highlightStep(i) {
  document.querySelectorAll('.step-item').forEach((el, idx) => {
    el.classList.toggle('active', idx === i);
  });
}

// ── YOUTUBE ────────────────────────────────────────────────────────────────
function loadYoutube(videoId, exerciseName) {
  const container = $('ytContainer');
  if (!videoId) {
    container.innerHTML = `<div class="yt-placeholder">No video found for this exercise.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="yt-header">
      <span>▶</span> REFERENCE VIDEO — ${exerciseName.toUpperCase()}
    </div>
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
}

// ── AI CHAT ────────────────────────────────────────────────────────────────
function aiSay(text) {
  state.aiMessages.push({ role: 'assistant', content: text });
  renderMessages();
}

function renderMessages() {
  const box = $('aiMessages');
  box.innerHTML = state.aiMessages.map(m => `
    <div class="msg ${m.role === 'assistant' ? 'msg-ai' : 'msg-user'}">
      ${m.role === 'assistant' ? renderMd(m.content) : m.content}
    </div>
  `).join('');
  box.scrollTop = box.scrollHeight;
}

// Minimal markdown: **bold**, line breaks
function renderMd(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>');
}

async function sendAiMessage() {
  const input = $('aiInput');
  const text = input.value.trim();
  if (!text || state.aiThinking) return;
  input.value = '';

  state.aiMessages.push({ role: 'user', content: text });
  renderMessages();
  state.aiThinking = true;
  $('aiThinkingLabel').style.display = 'block';

  // Build context for Claude
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
        messages: state.aiMessages.filter(m => m.role === 'user' || m.role === 'assistant')
          .slice(-10) // last 10 messages for context
      })
    });

    const data = await resp.json();

    if (data.error) {
      aiSay(`⚠️ AI error: ${data.error.message}. Check your API key configuration.`);
    } else {
      const reply = data.content?.[0]?.text || 'Sorry, I could not generate a response.';
      aiSay(reply);
    }
  } catch (err) {
    aiSay('⚠️ Could not reach AI. Check your internet connection or API key.');
    console.error('[AI]', err);
  } finally {
    state.aiThinking = false;
    $('aiThinkingLabel').style.display = 'none';
  }
}

// ── ANALYZE BUTTON ─────────────────────────────────────────────────────────
async function analyzeCurrentFrame() {
  if (!state.isCameraOn || !state.tracker) {
    toast('📷 Start your camera first!', 'error');
    return;
  }
  const kps = state.tracker.getKeypoints();
  if (!kps) {
    toast('🧍 No pose detected. Make sure you\'re visible in frame.', 'error');
    return;
  }
  if (!state.exercise) {
    toast('⚠️ Select an exercise first!', 'error');
    return;
  }

  const ex = EXERCISES[state.exercise];
  const result = ex.analyze(kps, canvas.height);

  if (!result) {
    toast('Could not analyze pose. Try adjusting your position.', 'info');
    return;
  }

  const summary = `Score: ${result.score}%${result.angle ? `, Angle: ${result.angle}°` : ''}. ${result.feedback.join(' ')} ${result.corrections.join(' ')}`;
  aiSay(`📸 Snapshot analysis — ${summary}`);
  toast('✅ Frame analyzed!', 'success');
}

// ── HISTORY ────────────────────────────────────────────────────────────────
function saveSet() {
  const record = {
    date: new Date().toISOString(),
    exercise: state.exercise,
    name: EXERCISES[state.exercise]?.name,
    emoji: EXERCISES[state.exercise]?.emoji,
    set: state.sets,
    reps: state.targetSetReps,
    formScore: state.formScore,
    calories: Math.round(state.calories)
  };
  state.workoutHistory.unshift(record);
  if (state.workoutHistory.length > 100) state.workoutHistory.pop();
  localStorage.setItem('formCoachHistory', JSON.stringify(state.workoutHistory));
  renderHistory();
}

function loadHistory() {
  const saved = localStorage.getItem('formCoachHistory');
  if (saved) {
    state.workoutHistory = JSON.parse(saved);
    renderHistory();
  }
}

function renderHistory() {
  const container = $('historyGrid');
  if (!container) return;
  if (state.workoutHistory.length === 0) {
    container.innerHTML = `<p style="color:var(--text-muted);padding:20px;">No workout history yet. Start training!</p>`;
    return;
  }
  container.innerHTML = state.workoutHistory.slice(0, 30).map(r => `
    <div class="history-card">
      <div class="h-ex">${r.emoji || '💪'} ${r.name}</div>
      <div class="h-meta">
        ${new Date(r.date).toLocaleDateString()} · Set ${r.set}<br>
        ${r.reps} reps · ${r.formScore}% form · ${r.calories} cal
      </div>
    </div>
  `).join('');
}

function clearHistory() {
  state.workoutHistory = [];
  localStorage.removeItem('formCoachHistory');
  renderHistory();
  toast('History cleared.', 'info');
}

// ── TABS ───────────────────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-content').forEach(t => t.style.display = 'none');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const target = $(`${name}Tab`);
  if (target) target.style.display = 'block';
  const tabBtn = document.querySelector(`[data-tab="${name}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  if (name === 'history') renderHistory();
}

// ── UTILS ──────────────────────────────────────────────────────────────────
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

// Enter key to send AI message
document.addEventListener('DOMContentLoaded', () => {
  const input = $('aiInput');
  if (input) {
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') sendAiMessage();
    });
  }
  init();
});