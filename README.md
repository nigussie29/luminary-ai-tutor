# Luminary AI Tutor Backend

This backend connects your Luminary front end to Claude safely.

## Why this backend is needed

Your browser front end calls:

```js
fetch('/api/tutor', ...)
```

The backend receives that question, calls Claude, and sends the tutor answer back. Your Claude API key stays on the server and is never exposed in the HTML.

## Setup

1. Install Node.js 18 or higher.
2. Open this folder in Terminal / Command Prompt.
3. Install packages:

```bash
npm install
```

4. Copy `.env.example` and rename it to `.env`.
5. Put your Anthropic API key in `.env`:

```bash
ANTHROPIC_API_KEY=your_real_key_here
CLAUDE_MODEL=claude-sonnet-4-6
PORT=3000
```

6. Start the app:

```bash
npm start
```

7. Open:

```text
http://localhost:3000
```

## Test the backend only

```bash
curl -X POST http://localhost:3000/api/tutor \
  -H "Content-Type: application/json" \
  -d '{"message":"Explain integer addition to a 7th grade student"}'
```

## Files

- `server.js` — Express backend and Claude API connection
- `public/index.html` — your Luminary front end
- `.env.example` — safe template for your secret key
- `package.json` — dependencies and run scripts

## Important security note

Never put `ANTHROPIC_API_KEY` in the HTML file. Keep it only in `.env` on the server.
