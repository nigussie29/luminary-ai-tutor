
require('dotenv').config();
const express = require('express');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Anthropic = require('@anthropic-ai/sdk');
 
const app = express();
const port = process.env.PORT || 3000;
 
// ── SECURITY ──
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: process.env.ALLOWED_ORIGIN || '*',
}));
app.use(express.json({ limit: '16kb' }));
 
// ── RATE LIMIT ──
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: { error: 'Too many requests. Please wait a moment.' },
});
app.use('/api/', limiter);
 
// ── ANTHROPIC CLIENT ──
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.warn('WARNING: ANTHROPIC_API_KEY is missing. Add it to your .env file or hosting environment variables.');
}
const anthropic = apiKey ? new Anthropic({ apiKey }) : null;
 
// ── STATIC FILES ──
app.use(express.static(path.join(__dirname, 'public')));
 
// ── HEALTH CHECK ──
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});
 
// ── AI TUTOR ENDPOINT ──
app.post('/api/tutor', async (req, res) => {
  if (!anthropic) {
    return res.status(503).json({ error: 'API key not configured.' });
  }
 
  const raw = req.body?.message;
  if (!raw || typeof raw !== 'string') {
    return res.status(400).json({ error: 'Message is required.' });
  }
 
  const message = raw.trim().slice(0, 2000);
  if (!message) {
    return res.status(400).json({ error: 'Message cannot be empty.' });
  }
 
  try {
    const response = await anthropic.messages.create({
      model: process.env.MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are Luminary, a world-class AI tutor specialising in Data Science, Python Programming, Power BI, and Mathematics. You teach from beginner to advanced level.
 
Your teaching method:
1. DIAGNOSE FIRST — ask one targeted question to find where the student is before explaining anything.
2. GUIDE, DON'T LECTURE — ask before you tell. Use Socratic questioning.
3. FILL GAPS — find the root cause of confusion, not just the surface symptom.
4. CHECK MASTERY — end every response with one comprehension question.
 
Keep responses clear, warm, and encouraging. Never give the answer immediately — always guide the student to discover it.`,
      messages: [{ role: 'user', content: message }],
    });
 
    const reply = response.content?.[0]?.text || 'I am ready to help you master this topic.';
    res.json({ reply });
  } catch (error) {
    console.error('Tutor API error:', error);
    res.status(500).json({
      error: 'The AI tutor is unavailable right now. Please try again.',
    });
  }
});
 
// ── SERVE FRONTEND ──
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
 
// ── START SERVER ──
app.listen(port, () => {
  console.log(`Luminary Academy running at http://localhost:${port}`);
  console.log(`AI Tutor endpoint: POST http://localhost:${port}/api/tutor`);
});
 




