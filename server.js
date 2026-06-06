'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  server.js  —  AI Form Coach backend
//  Express serves all static assets from /public and proxies AI chat to Groq.
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();           // loads .env into process.env FIRST

const express = require('express');
const cors    = require('cors');
const path    = require('path');
const Groq    = require('groq-sdk');

// ── Guard: fail loudly if key is missing ─────────────────────────────────────
if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY.startsWith('gsk_your')) {
  console.error('\n  ✖  GROQ_API_KEY is not set.');
  console.error('     1. Copy .env.example → .env');
  console.error('     2. Paste your real key from https://console.groq.com\n');
  process.exit(1);
}

const groq  = new Groq({ apiKey: process.env.GROQ_API_KEY });
const app   = express();
const PORT  = parseInt(process.env.PORT, 10) || 3000;
const MODEL = 'llama-3.3-70b-versatile';

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// ── Static files — serve EVERYTHING inside /public ───────────────────────────
//  This single line fixes all 404s for style.css, exercises.js, pose.js, etc.
app.use(express.static(path.join(__dirname, 'public')));

// ── POST /api/chat ────────────────────────────────────────────────────────────
//  Body:    { messages: [{role, content}, …], systemPrompt: "…" }
//  Returns: { reply: "…" }
app.post('/api/chat', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required.' });
  }

  // Sanitise: keep only role + content, cap length, keep last 12 turns
  const cleaned = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({
      role:    m.role,
      content: String(m.content || '').slice(0, 2000)
    }))
    .slice(-12);

  try {
    const completion = await groq.chat.completions.create({
      model:       MODEL,
      max_tokens:  350,
      temperature: 0.7,
      messages: [
        {
          role:    'system',
          content: systemPrompt || 'You are an expert personal trainer and exercise form coach.'
        },
        ...cleaned
      ]
    });

    const reply = completion.choices?.[0]?.message?.content?.trim();
    if (!reply) throw new Error('Empty response from Groq.');

    return res.json({ reply });

  } catch (err) {
    console.error('[Groq]', err.message);

    const status = err.status || 500;
    let msg = 'AI service unavailable. Please try again shortly.';
    if (err.message?.toLowerCase().includes('api key'))  msg = 'Invalid Groq API key — check your .env file.';
    if (err.message?.toLowerCase().includes('rate'))     msg = 'Rate limit reached. Please wait a moment.';

    return res.status(status).json({ error: msg });
  }
});

// ── GET /api/health ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', model: MODEL, ts: new Date().toISOString() });
});

// ── SPA fallback — send index.html for any non-API, non-asset route ───────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log(`  │  ✔  AI Form Coach  →  http://localhost:${PORT}   │`);
  console.log(`  │     Model : ${MODEL}  │`);
  console.log('  │     Press Ctrl+C to stop                    │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log('');
});
