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
 
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
 
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
 
// AGENT HELPER
async function runAgent(systemPrompt, userPrompt) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1500,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }]
  });
  const text = response.content.filter(p => p.type === 'text').map(p => p.text).join('');
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch {
    return { error: 'Agent error. Please try again.', raw: text };
  }
}
 
// ══════════════════════════════════════════════
// AUTH ROUTES
// ══════════════════════════════════════════════
app.post('/api/auth/signup', async (req, res) => {
  const { full_name, email, password } = req.body;
  if (!full_name || !email || !password) return res.status(400).json({ error: 'All fields required.' });
  const { data, error } = await supabase.auth.signUp({ email, password, options: { data: { full_name } } });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ message: 'Account created! Please verify your email.', user: data.user });
});
 
app.post('/api/auth/signin', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ token: data.session.access_token, user: data.user });
});
 
app.get('/api/auth/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('students').select('*').eq('id', req.user.id).single();
  if (error) return res.status(404).json({ error: 'Profile not found.' });
  res.json(data);
});
 
// ══════════════════════════════════════════════
// AGENT 1: TUTOR AGENT
// ══════════════════════════════════════════════
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
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are Luminary, a world-class AI tutor for Luminary Academy (Luminary EdTech Ltd.). You specialise in: Data Science, Python, Power BI, Mathematics, SQL, Machine Learning, Deep Learning, AI, Robotics, and Statistics. Beginner to advanced.
Teaching method:
1. DIAGNOSE FIRST - ask one targeted question to find where the student is.
2. GUIDE, DON'T LECTURE - ask before you tell. Use Socratic questioning.
3. FILL GAPS - find the root cause of confusion, not just the surface symptom.
4. CHECK MASTERY - end every response with one comprehension question.
Be warm, encouraging. Never give the answer immediately.`,
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
    console.error('Tutor error:', error);
    res.status(500).json({ error: 'AI tutor unavailable right now.' });
  }
});
 
// ══════════════════════════════════════════════
// AGENT 2: LESSON PLANNER AGENT
// ══════════════════════════════════════════════
app.post('/api/agents/lesson-plan', requireAuth, async (req, res) => {
  const { track, level, mastery_percent, sessions_per_week } = req.body;
  if (!track || !level) return res.status(400).json({ error: 'Track and level required.' });
 
  const profile = await supabase.from('students').select('full_name').eq('id', req.user.id).single();
  const student_name = profile.data?.full_name || 'Student';
 
  const plan = await runAgent(
    `You are the Luminary Academy Lesson Planner Agent. Create personalised mastery-based weekly study plans. Output clean JSON only — no markdown.`,
    `Create a 1-week study plan for:
Student: ${student_name}
Track: ${track}
Level: ${level}
Current mastery: ${mastery_percent || 0}%
Sessions per week: ${sessions_per_week || 3}
 
Return ONLY valid JSON:
{
  "week_goal": "string",
  "daily_sessions": [
    {"day": "Monday", "topic": "string", "duration_minutes": 45, "objective": "string", "activities": ["a1","a2","a3"]},
    {"day": "Wednesday", "topic": "string", "duration_minutes": 45, "objective": "string", "activities": ["a1","a2","a3"]},
    {"day": "Friday", "topic": "string", "duration_minutes": 45, "objective": "string", "activities": ["a1","a2","a3"]}
  ],
  "practice_task": "string",
  "reflection_question": "string",
  "resources": ["resource 1", "resource 2"]
}`
  );
 
  // Save to Supabase
  await supabase.from('notes').insert({
    student_id: req.user.id,
    track, title: `Weekly Plan — ${track} (${new Date().toLocaleDateString()})`,
    content: JSON.stringify(plan), tags: ['lesson-plan', 'auto-generated']
  });
 
  res.json(plan);
});
 
// ══════════════════════════════════════════════
// AGENT 3: RESEARCH AGENT
// ══════════════════════════════════════════════
app.post('/api/agents/research', requireAuth, async (req, res) => {
  const { topic, track, level, student_question } = req.body;
  if (!topic) return res.status(400).json({ error: 'Topic required.' });
 
  const research = await runAgent(
    `You are the Luminary Academy Research Agent. Find the best real-world examples, analogies, and code snippets for students. Output clean JSON only.`,
    `Research this for a student:
Topic: ${topic}
Track: ${track || 'general'}
Level: ${level || 'beginner'}
Question: ${student_question || topic}
 
Return ONLY valid JSON:
{
  "topic": "string",
  "simple_explanation": "string",
  "real_world_example": "string",
  "analogy": "string",
  "code_example": "string or null",
  "key_concepts": ["c1","c2","c3"],
  "common_mistakes": ["m1","m2"],
  "next_steps": ["s1","s2"],
  "resources": [{"title":"string","type":"article/video/docs","description":"string"}]
}`
  );
 
  res.json(research);
});
 
// ══════════════════════════════════════════════
// AGENT 4: NOTES AGENT (auto-generate from session)
// ══════════════════════════════════════════════
app.post('/api/agents/generate-notes', requireAuth, async (req, res) => {
  const { session_id, track, level } = req.body;
  if (!session_id) return res.status(400).json({ error: 'Session ID required.' });
 
  const { data: session } = await supabase.from('sessions').select('messages').eq('id', session_id).eq('student_id', req.user.id).single();
  if (!session) return res.status(404).json({ error: 'Session not found.' });
 
  const conversation = (session.messages || []).map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`).join('\n\n');
 
  const notes = await runAgent(
    `You are the Luminary Academy Notes Agent. Extract key learning points from tutoring sessions and create structured study notes. Output clean JSON only.`,
    `Generate study notes from this session:
Track: ${track}
Level: ${level}
 
${conversation}
 
Return ONLY valid JSON:
{
  "title": "string",
  "summary": "string",
  "key_concepts": ["c1","c2"],
  "detailed_notes": [{"heading":"string","content":"string"}],
  "code_examples": ["code or null"],
  "what_student_understood": "string",
  "what_needs_review": "string",
  "practice_exercise": "string"
}`
  );
 
  // Save notes to Supabase
  if (!notes.error) {
    await supabase.from('notes').insert({
      student_id: req.user.id,
      track: track || 'general',
      title: notes.title || 'Auto-generated Notes',
      content: notes.summary + '\n\n' + (notes.detailed_notes || []).map(n => `${n.heading}\n${n.content}`).join('\n\n'),
      tags: ['auto-generated', 'session-notes']
    });
  }
 
  res.json(notes);
});
 
// ══════════════════════════════════════════════
// AGENT 5: GRADING AGENT
// ══════════════════════════════════════════════
app.post('/api/agents/grade', requireAuth, async (req, res) => {
  const { assignment_title, assignment_description, student_submission, track, level, rubric } = req.body;
  if (!student_submission) return res.status(400).json({ error: 'Submission required.' });
 
  const result = await runAgent(
    `You are the Luminary Academy Grading Agent. Grade student assignments fairly with specific, actionable feedback. Output clean JSON only.`,
    `Grade this submission:
Assignment: ${assignment_title || 'Assignment'}
Description: ${assignment_description || ''}
Track: ${track || 'general'}
Level: ${level || 'beginner'}
Rubric: ${rubric || '90-100=Mastered, 70-89=Developing, below 70=Needs Review'}
 
Submission:
${student_submission}
 
Return ONLY valid JSON:
{
  "grade": 85,
  "grade_label": "Developing",
  "summary_feedback": "string",
  "strengths": ["s1","s2"],
  "areas_for_improvement": ["a1","a2"],
  "specific_feedback": [{"aspect":"string","comment":"string","suggestion":"string"}],
  "next_recommendation": "string",
  "encouragement": "string"
}`
  );
 
  // Save grade to assignments table
  await supabase.from('assignments').insert({
    student_id: req.user.id,
    track: track || 'general',
    title: assignment_title || 'Assignment',
    submission: student_submission,
    grade: result.grade || 0,
    feedback: result.summary_feedback || '',
    status: 'graded',
    graded_at: new Date().toISOString()
  });
 
  res.json(result);
});
 
// ══════════════════════════════════════════════
// AGENT 6: SUBJECT INTEGRATION AGENT
// ══════════════════════════════════════════════
app.post('/api/agents/integrate', requireAuth, async (req, res) => {
  const { primary_track, secondary_track, topic, level } = req.body;
  if (!primary_track || !secondary_track) return res.status(400).json({ error: 'Both tracks required.' });
 
  const result = await runAgent(
    `You are the Luminary Academy Subject Integration Agent. Show students how different tracks connect in real AI careers. Output clean JSON only.`,
    `Show how these tracks connect:
Primary: ${primary_track}
Related: ${secondary_track}
Topic: ${topic || 'general'}
Level: ${level || 'beginner'}
 
Return ONLY valid JSON:
{
  "connection_title": "string",
  "how_they_connect": "string",
  "real_world_project": "string",
  "shared_concepts": ["c1","c2","c3"],
  "learning_order": ["step 1","step 2","step 3"],
  "career_path": "string",
  "example_workflow": "string"
}`
  );
 
  res.json(result);
});
 
// ══════════════════════════════════════════════
// DATA ROUTES
// ══════════════════════════════════════════════
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
  const { data, error } = await supabase.from('notes').update({ title, content, tags, is_pinned, updated_at: new Date().toISOString() }).eq('id', req.params.id).eq('student_id', req.user.id).select();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data[0]);
});
 
app.delete('/api/notes/:id', requireAuth, async (req, res) => {
  const { error } = await supabase.from('notes').delete().eq('id', req.params.id).eq('student_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ message: 'Note deleted.' });
});
 
app.get('/api/sessions', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('sessions').select('*').eq('student_id', req.user.id).order('session_date', { ascending: false }).limit(20);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
 
app.get('/api/assignments', requireAuth, async (req, res) => {
  const { data, error } = await supabase.from('assignments').select('*').eq('student_id', req.user.id).order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
 
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
 
app.get('/api/health', (req, res) => res.json({ ok: true, app: 'Luminary Academy', version: '3.0', agents: 6 }));
app.use((_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
 
app.listen(port, () => {
  console.log(`Luminary Academy v3.0 — 6 Agents — running at http://localhost:${port}`);
});
 