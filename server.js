import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
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

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('WARNING: ANTHROPIC_API_KEY is missing.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(cors({ origin: '*' }));
app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  message: { error: 'Too many requests. Please try again in one minute.' },
  validate: { xForwardedForHeader: false }
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Luminary Academy' });
});

app.post('/api/tutor', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim().slice(0, 2000);
    if (!message) {
      return res.status(400).json({ error: 'Please type a question first.' });
    }
    const response = await anthropic.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: `You are Luminary, a world-class AI tutor specialising in Data Science, Python Programming, Power BI, and Mathematics. You teach from beginner to advanced level.
Your teaching method:
1. DIAGNOSE FIRST - ask one targeted question to find where the student is.
2. GUIDE, DON'T LECTURE - ask before you tell.
3. FILL GAPS - find the root cause of confusion.
4. CHECK MASTERY - end every response with one comprehension question.
Keep responses clear, warm, and encouraging.`,
      messages: [{ role: 'user', content: message }],
    });
    const reply = response.content.filter(p => p.type === 'text').map(p => p.text).join('\n\n').trim();
    res.json({ reply });
  } catch (error) {
    console.error('Tutor API error:', error);
    res.status(500).json({ error: 'The AI tutor is unavailable right now.' });
  }
});

app.use((_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Luminary Academy running at http://localhost:${port}`);
});
