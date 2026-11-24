# AskGPT

AskGPT is a multilingual AI chatbot with voice chat support. It automatically replies in the same language and script the user writes in — Hindi (Devanagari), English, or Hinglish — and politely declines illegal or harmful requests.

**Live demo:** [https://askgpt-gcrx.onrender.com](https://askgpt-gcrx.onrender.com)

## Features

- **Multilingual replies** — answers in Hindi, English, or Hinglish to match the user's latest message.
- **Voice chat** — voice input (Web Speech API) and read-aloud replies.
- **Streaming responses** — Server-Sent Events with a working **Stop generating** button.
- **Dark mode** — light/dark theme toggle.
- **Chat history** — conversations saved per user and revisited later.
- **Export** — download a chat as `.txt` or PDF (via the browser print dialog).
- **Image upload** — attach JPG, PNG, or WEBP images (up to 4 MB, resized client-side).
- **Model fallback** — automatically retries the next model when the primary model returns 500/503/429 or does not respond within 20 seconds.
- Markdown rendering with syntax-highlighted code blocks and copy buttons.
- Regenerate the last response.
- Email + password authentication with JWT, rate limiting, and security headers.

## Tech stack

- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT, bcryptjs
- **Frontend:** vanilla JavaScript, HTML, CSS
- **AI:** any OpenAI-compatible chat completions API (OpenAI, Gemini, etc.)

## Screenshots

> _Placeholders — replace with real screenshots._

| Welcome | Chat |
| --- | --- |
| ![Welcome](docs/screenshot-1.png) | ![Chat](docs/screenshot-1.png) |

## Getting started

### Prerequisites

- Node.js 18 or newer
- A MongoDB database (local or MongoDB Atlas)
- An API key from an OpenAI-compatible provider

### Installation

```bash
git clone https://github.com/ritikakashyap09939-png/AskGPT.git
cd AskGPT
npm install
```

### Configuration

Copy the example environment file and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
| --- | --- |
| `API_KEY` | API key for your OpenAI-compatible provider |
| `API_BASE` | OpenAI-compatible base URL (e.g. `https://api.openai.com/v1`) |
| `MODEL_NAME` | Primary model name, e.g. `gpt-4o-mini` or `gemini-2.0-flash` |
| `MODEL_FALLBACKS` | Optional comma-separated backup models (e.g. `gemini-2.5-flash-lite,gemini-2.5-flash`) |
| `PORT` | Port the server listens on (default `3000`) |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string used to sign auth tokens |

### Run locally

```bash
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

For auto-restart during development:

```bash
npm run dev
```

## Deploy to Render

1. Push this repository to GitHub.
2. In Render, create a new **Web Service** and connect the repository.
3. Set the build command to `npm install` and the start command to `node server.js`.
4. Add the environment variables from the table above (`API_KEY`, `API_BASE`, `MODEL_NAME`, `MODEL_FALLBACKS`, `MONGODB_URI`, `JWT_SECRET`).
5. Deploy. Render provides `PORT` automatically; the server already reads `process.env.PORT`.

## Project structure

```
.
├── config/          # system prompt and DB config
├── middleware/      # JWT auth middleware
├── models/          # Mongoose User and Chat models
├── routes/          # auth, chats and chat (LLM) routes
├── services/        # LLM service (streaming + non-streaming, model fallback)
├── public/          # frontend (HTML, CSS, JS)
├── server.js        # app entry point
└── .env.example     # example environment variables
```

## Future improvements

- Streaming response persistence so long chats survive reloads mid-stream.
- Richer export formats (Markdown, JSON) and per-message copy.
- Multiple LLM providers with per-provider keys and automatic cost/latency routing.
- Conversation search and tagging.
- Rate-limit and usage dashboards per user.
- Improved voice quality and wake-word support.

## License

MIT