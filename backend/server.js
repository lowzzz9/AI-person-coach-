'use strict';

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const PgSession = require('connect-pg-simple')(session);
const Groq = require('groq-sdk');
const { database, dbPath, sessionDbPath, dbReady } = require('./db');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3000;
const MODEL = 'llama-3.3-70b-versatile';
const FRONTEND_ROOT = path.join(__dirname, '..', 'frontend');
const FRONTEND_PUBLIC = path.join(FRONTEND_ROOT, 'public');
const groq = process.env.GROQ_API_KEY ? new Groq({ apiKey: process.env.GROQ_API_KEY }) : null;
const isProduction = process.env.NODE_ENV === 'production';
const sessionSecret = process.env.SESSION_SECRET || (isProduction ? null : crypto.randomBytes(32).toString('hex'));

if (!sessionSecret) throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET is not set; using a temporary development-only session secret.');

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '2mb' }));
if (isProduction) app.set('trust proxy', 1);
app.use(session({
  store: database.kind === 'postgres'
    ? new PgSession({ pool: database.pool, createTableIfMissing: true })
    : new SQLiteStore({ db: path.basename(sessionDbPath), dir: path.dirname(dbPath), concurrentDB: true }),
  secret: sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: isProduction, maxAge: 1000 * 60 * 60 * 24 * 30 }
}));
app.use(express.static(FRONTEND_ROOT));

const run = (sql, params = []) => database.run(sql, params);
const insert = (sql, params = []) => database.insert(sql, params);
const get = (sql, params = []) => database.get(sql, params);
const all = (sql, params = []) => database.all(sql, params);

function sanitizeUser(user) {
  return { id: user.id, username: user.username, email: user.email || null };
}

function authRequired(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Authentication required.' });
  req.user = { id: req.session.userId, username: req.session.username };
  next();
}

function rangeClause(range) {
  const postgresRanges = {
    today: 'workout_date >= CURRENT_DATE',
    '7d': "workout_date >= CURRENT_DATE - INTERVAL '6 days'",
    '30d': "workout_date >= CURRENT_DATE - INTERVAL '29 days'",
    '90d': "workout_date >= CURRENT_DATE - INTERVAL '89 days'",
    year: "workout_date >= date_trunc('year', CURRENT_TIMESTAMP)",
    all: 'TRUE'
  };
  const ranges = {
    today: "datetime(workout_date) >= datetime('now', 'start of day')",
    '7d': "datetime(workout_date) >= datetime('now', '-6 days', 'start of day')",
    '30d': "datetime(workout_date) >= datetime('now', '-29 days', 'start of day')",
    '90d': "datetime(workout_date) >= datetime('now', '-89 days', 'start of day')",
    year: "datetime(workout_date) >= datetime('now', 'start of year')",
    all: '1 = 1'
  };
  return (database.kind === 'postgres' ? postgresRanges : ranges)[range] || null;
}

function normalizeWorkout(payload = {}) {
  const date = payload.date ? new Date(payload.date) : new Date();
  const exerciseName = String(payload.exercise_name || payload.name || payload.exercise || '').trim();
  const reps = payload.reps == null && payload.duration != null ? Number(payload.duration) : (payload.reps == null ? null : Number(payload.reps));
  const setsCompleted = Number(payload.sets_completed ?? payload.sets ?? payload.set ?? 1);
  const calories = Number(payload.calories);
  const formScore = Number(payload.form_score ?? payload.formScore);

  if (!exerciseName || Number.isNaN(date.getTime()) || !Number.isFinite(setsCompleted) || !Number.isFinite(calories) || !Number.isFinite(formScore)) {
    return null;
  }

  return {
    date: date.toISOString(),
    exerciseName,
    reps: Number.isFinite(reps) ? Math.round(reps) : null,
    setsCompleted: Math.round(setsCompleted),
    calories,
    formScore
  };
}

function toClientWorkout(row) {
  return {
    id: row.id,
    date: row.workout_date,
    exercise: row.exercise_name,
    name: row.exercise_name,
    set: row.sets_completed,
    sets: row.sets_completed,
    reps: row.reps,
    calories: row.calories,
    formScore: row.form_score
  };
}

async function getSummary(userId, clause = '1 = 1') {
  const row = await get(`
    SELECT COUNT(*) AS workouts,
           COALESCE(SUM(reps), 0) AS reps,
           COUNT(*) AS sets,
           COALESCE(SUM(calories), 0) AS calories,
           AVG(form_score) AS averageFormScore
    FROM workout_sessions
    WHERE user_id = ? AND ${clause}
  `, [userId]);
  return {
    workouts: row.workouts,
    reps: row.reps,
    sets: row.sets,
    calories: row.calories,
    averageFormScore: row.averageFormScore === null ? null : Math.round(row.averageFormScore)
  };
}

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const email = String(req.body.email || '').trim() || null;
    const password = String(req.body.password || '');
    if (username.length < 2) return res.status(400).json({ error: 'Username must be at least 2 characters.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const result = await insert('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)', [username, email, passwordHash]);
    const user = { id: result.lastID, username, email };
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save(saveError => saveError ? next(saveError) : res.status(201).json({ user }));
    });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT' || error.code === '23505') return res.status(409).json({ error: 'Username or email already taken.' });
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');
    if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
    const user = await get('SELECT id, username, email, password_hash FROM users WHERE username = ?', [username]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Incorrect username or password.' });
    }
    req.session.regenerate(error => {
      if (error) return next(error);
      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.save(saveError => saveError ? next(saveError) : res.json({ user: sanitizeUser(user) }));
    });
  } catch (error) { next(error); }
});

app.get('/api/auth/session', authRequired, async (req, res, next) => {
  try {
    const user = await get('SELECT id, username, email FROM users WHERE id = ?', [req.user.id]);
    if (!user) return req.session.destroy(() => res.status(401).json({ error: 'Session expired. Please log in again.' }));
    res.json({ user: sanitizeUser(user) });
  } catch (error) { next(error); }
});

app.post('/api/auth/logout', authRequired, (req, res, next) => {
  req.session.destroy(error => error ? next(error) : res.clearCookie('connect.sid').json({ ok: true }));
});

app.get('/api/dashboard/weekly', authRequired, async (req, res, next) => {
  try { res.json(await getSummary(req.user.id, rangeClause('7d'))); } catch (error) { next(error); }
});

app.get('/api/dashboard/lifetime', authRequired, async (req, res, next) => {
  try { res.json(await getSummary(req.user.id)); } catch (error) { next(error); }
});

app.get('/api/history', authRequired, async (req, res, next) => {
  try {
    const range = String(req.query.range || 'all');
    const clause = rangeClause(range);
    if (!clause) return res.status(400).json({ error: 'Invalid history range.' });
    const rows = await all(`
      SELECT id, exercise_name, reps, sets_completed, calories, form_score, workout_date
      FROM workout_sessions WHERE user_id = ? AND ${clause}
      ORDER BY workout_date DESC, id DESC
    `, [req.user.id]);
    res.json({ range, workouts: rows.map(toClientWorkout), summary: await getSummary(req.user.id, clause) });
  } catch (error) { next(error); }
});

app.post('/api/workouts', authRequired, async (req, res, next) => {
  try {
    const workout = normalizeWorkout(req.body);
    if (!workout) return res.status(400).json({ error: 'Workout payload is incomplete.' });
    const result = await insert(`
      INSERT INTO workout_sessions (user_id, exercise_name, reps, sets_completed, calories, form_score, workout_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [req.user.id, workout.exerciseName, workout.reps, workout.setsCompleted, workout.calories, workout.formScore, workout.date]);
    res.status(201).json({ workout: toClientWorkout({ id: result.lastID, workout_date: workout.date, exercise_name: workout.exerciseName, reps: workout.reps, sets_completed: workout.setsCompleted, calories: workout.calories, form_score: workout.formScore }) });
  } catch (error) { next(error); }
});

app.post('/api/workouts/migrate', authRequired, async (req, res, next) => {
  try {
    const workouts = Array.isArray(req.body.workouts) ? req.body.workouts.map(normalizeWorkout).filter(Boolean) : [];
    if (!workouts.length) return res.json({ imported: 0 });
    await run('BEGIN');
    try {
      for (const workout of workouts) {
        await run(`INSERT INTO workout_sessions (user_id, exercise_name, reps, sets_completed, calories, form_score, workout_date) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [req.user.id, workout.exerciseName, workout.reps, workout.setsCompleted, workout.calories, workout.formScore, workout.date]);
      }
      await run('COMMIT');
    } catch (error) { await run('ROLLBACK'); throw error; }
    res.status(201).json({ imported: workouts.length });
  } catch (error) { next(error); }
});

app.delete('/api/workouts', authRequired, async (req, res, next) => {
  try { await run('DELETE FROM workout_sessions WHERE user_id = ?', [req.user.id]); res.json({ ok: true }); } catch (error) { next(error); }
});

app.post('/api/chat', async (req, res) => {
  if (!groq) return res.status(503).json({ error: 'AI chat is unavailable until GROQ_API_KEY is set.' });
  const { messages, systemPrompt } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) return res.status(400).json({ error: 'messages array is required.' });
  const cleaned = messages.filter(message => message.role === 'user' || message.role === 'assistant').map(message => ({ role: message.role, content: String(message.content || '').slice(0, 2000) })).slice(-12);
  try {
    const completion = await groq.chat.completions.create({ model: MODEL, max_tokens: 350, temperature: 0.7, messages: [{ role: 'system', content: systemPrompt || 'You are an expert personal trainer and exercise form coach.' }, ...cleaned] });
    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('Empty response from Groq.');
    res.json({ reply });
  } catch (error) {
    console.error('[Groq]', error.message);
    res.status(error.status || 500).json({ error: 'AI service unavailable. Please try again shortly.' });
  }
});

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.get('*', (_req, res) => res.sendFile(path.join(FRONTEND_PUBLIC, 'index.html')));
app.use((error, _req, res, _next) => { console.error(error); res.status(500).json({ error: 'Server error.' }); });

dbReady.then(() => {
  console.log(`Database connected: ${database.kind}`);
  console.log('Tables verified');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  app.listen(PORT, () => console.log(`Server running at http://localhost:${PORT}`));
}).catch(error => { console.error('Database initialization failed:', error); process.exit(1); });
