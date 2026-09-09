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
const allowedOrigin = process.env.ALLOWED_ORIGIN?.trim();
const model = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('WARNING: ANTHROPIC_API_KEY is missing. Add it to your .env file before using /api/tutor.');
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

app.use(helmet({
  contentSecurityPolicy: false,
}));

app.use(express.json({ limit: '1mb' }));

if (allowedOrigin) {
  app.use(cors({ origin: allowedOrigin }));
}

app.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again in one minute.' },
}));

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, app: 'Luminary AI Tutor Backend' });
});

function cleanStudentMessage(value) {
  const message = String(value || '').trim();
  if (!message) return '';
  return message.slice(0, 2000);
}

app.post('/api/tutor', async (req, res) => {
  try {
    const message = cleanStudentMessage(req.body?.message);

    if (!message) {
      return res.status(400).json({ error: 'Please type a STEM question first.' });
    }

    const response = await anthropic.messages.create({
      model,
      max_tokens: 650,
      system: `You are Luminary AI Tutor, a warm mastery-based STEM tutor.
Your job is to help middle school, high school, college, and adult learners.
Teach in the Alpha-style mastery approach:
1. Diagnose the student's current understanding first.
2. Explain using simple language and a small example.
3. Ask guiding questions instead of only giving final answers.
4. Do not shame the student for mistakes.
5. Keep answers concise, clear, and encouraging.
6. End with exactly one check-for-understanding question.
When solving math, show steps. When teaching code, give short runnable examples.`,
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
    });

    const reply = response.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n\n')
      .trim();

    if (!reply) {
      return res.status(502).json({ error: 'Claude returned an empty response.' });
    }

    res.json({ reply });
  } catch (error) {
    console.error('Tutor API error:', error);
    res.status(500).json({
      error: 'The AI tutor is unavailable right now. Check your API key, model name, and server logs.',
    });
  }
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  console.log(`Luminary frontend + backend running at http://localhost:${port}`);
  console.log(`Tutor endpoint: http://localhost:${port}/api/tutor`);
});
