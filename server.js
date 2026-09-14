import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = Number(process.env.PORT || 3000);

// SUPABASE
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ANTHROPIC
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// SECURITY
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '2mb' }));
app.use(cors({ origin: '*' }));
app.use(rateLimit({ windowMs: 60000, limit: 30 }));
app.use(express.static(path.join(__dirname, 'public')));

// AUTH MIDDLEWARE
async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated.' });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Invalid session.' });
  req.user = user;
  next();
}

// SIGN UP
app.post('/api/auth/signup', async (req, res) => {
  const { full_name, email, password } = req.body;
  if (!full_name || !email || !password)
    return res.status(400).json({ error: 'Name, email and password are required.' });
  const { data, error } = await supabase.auth.signUp({
    email, password, options: { data: { full_name } }
  });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Account created! Please verify your email.', user: data.user });
});

// SIGN IN
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ token: data.session.access_token, user: data.user });
});

// GET PROFILE
app.get('/api/auth/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('students').select('*').eq('id', req.user.id).single();
  if (error) return res.status(404).json({ error: 'Profile not found.' });
  res.json(data);
});

// AI TUTOR
app.post('/api/tutor', async (req, res) => {
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ error: 'Please type a question.' });
  const track = req.body?.track || 'general';
  const token = req.headers.authorization?.replace('Bearer ', '');
  let studentId = null;
  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user) studentId = user.id;
  }
  try {
    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are Luminary, a world-class AI tutor for Luminary Academy (Luminary EdTech Ltd.). You specialise in: Data Science, Python, Power BI, Mathematics, SQL, Machine Learning, Deep Learning, AI, Robotics, and Statistics. Beginner to advanced.

Teaching method:
1. DIAGNOSE FIRST - ask one question to find where the student is.
2. GUIDE, DON'T LECTURE - ask before you tell.
3. FILL GAPS - find the root cause of confusion.
4. CHECK MASTERY - end with one comprehension question.

Be warm, encouraging, and never give the answer immediately.`,
      messages: [{ role: 'user', content: message }],
    });
    const reply = response.content.filter(p => p.type === 'text').map(p => p.text).join('\n\n').trim();
    if (studentId) {
      await supabase.from('sessions').insert({
        student_id: studentId, track,
        messages: [{ role: 'user', content: message }, { role: 'assistant', content: reply }],
        session_date: new Date().toISOString()
      });
    }
    res.json({ reply });
  } catch (error) {
    console.error('Tutor API error:', error);
    res.status(500).json({ error: 'AI tutor unavailable right now.' });
  }
});

// PROGRESS
app.get('/api/progress', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('progress').select('*').eq('student_id', req.user.id).order('updated_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/progress', requireAuth, async (req, res) => {
  const { track, module_name, mastery_percent } = req.body;
  if (!track || !module_name) return res.status(400).json({ error: 'Track and module required.' });
  const { data, error } = await supabase.from('progress').upsert({
    student_id: req.user.id, track, module_name,
    mastery_percent: mastery_percent || 0,
    last_studied_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'student_id,track,module_name' }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

// NOTES
app.get('/api/notes', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('notes').select('*').eq('student_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post('/api/notes', requireAuth, async (req, res) => {
  const { track, module, title, content, tags } = req.body;
  if (!title || !content) return res.status(400).json({ error: 'Title and content required.' });
  const { data, error } = await supabase.from('notes').insert({
    student_id: req.user.id, track: track || 'general',
    module: module || '', title, content, tags: tags || []
  }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.put('/api/notes/:id', requireAuth, async (req, res) => {
  const { title, content, tags, is_pinned } = req.body;
  const { data, error } = await supabase.from('notes')
    .update({ title, content, tags, is_pinned, updated_at: new Date().toISOString() })
    .eq('id', req.params.id).eq('student_id', req.user.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('notes').delete()
    .eq('id', req.params.id).eq('student_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Note deleted.' });
});

// SESSIONS
app.get('/api/sessions', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('sessions').select('*')
    .eq('student_id', req.user.id).order('session_date', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ENROLLMENTS
app.post('/api/enroll', requireAuth, async (req, res) => {
  const { track, level } = req.body;
  if (!track) return res.status(400).json({ error: 'Track required.' });
  const { data, error } = await supabase.from('enrollments').upsert({
    student_id: req.user.id, track, level: level || 'beginner',
    enrolled_at: new Date().toISOString()
  }, { onConflict: 'student_id,track' }).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});

app.get('/api/enrollments', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('enrollments').select('*').eq('student_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// HEALTH
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Luminary Academy', version: '2.0' }));

// FRONTEND
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// START
app.listen(port, () => {
  console.log(`Luminary Academy v2.0 running at http://localhost:${port}`);
  console.log(`Supabase: ${process.env.SUPABASE_URL}`);
});