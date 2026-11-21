# AskGPT

AskGPT is a multilingual AI chatbot with voice chat support. It replies in the same language the user speaks (Hindi, English or Hinglish) and politely declines illegal or harmful requests.

## Live demo

> **Live demo:** [https://your-app-name.onrender.com](https://your-app-name.onrender.com) _(placeholder — replace with your Render URL)_

## Screenshots

> **Screenshots:** _Add screenshots of the welcome screen, chat view and login modal here._

| Welcome | Chat | Login |
| --- | --- | --- |
| _placeholder_ | _placeholder_ | _placeholder_ |

## Features

- Multilingual replies: Hindi (Devanagari), English and Hinglish
- Streaming responses (Server-Sent Events) with a working **Stop generating** button
- Markdown rendering with syntax-highlighted code blocks and copy buttons
- Voice input (Web Speech API) and read-aloud replies
- Regenerate the last response
- Image attachments (JPG, PNG, WEBP, up to 4 MB, resized to 1024 px on the client)
- Chat history stored per user in MongoDB
- Export a chat as `.txt` or PDF (via the browser print dialog)
- Light/dark theme
- Email + password authentication with JWT
- Rate limiting and security headers

## Tech stack

- **Backend:** Node.js, Express, MongoDB (Mongoose), JWT, bcryptjs
- **Frontend:** vanilla JavaScript, HTML, CSS
- **AI:** any OpenAI-compatible chat completions API (OpenAI, Gemini, etc.)

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
| `PORT` | Port the server listens on (default `3000`) |
| `API_KEY` | API key for your OpenAI-compatible provider |
| `MODEL_NAME` | Model name, e.g. `gpt-4o-mini` or `gemini-2.0-flash` |
| `API_BASE` | OpenAI-compatible base URL |
| `MONGODB_URI` | MongoDB connection string |
| `JWT_SECRET` | Long random string used to sign auth tokens |
| `ALLOWED_ORIGIN` | Optional allowed CORS origin (e.g. your Render URL). Defaults to same-origin only |

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
3. Set the build command to `npm install` and the start command to `node server.js` (Render uses the `start` script automatically).
4. Add the environment variables from the table above (`API_KEY`, `MODEL_NAME`, `API_BASE`, `MONGODB_URI`, `JWT_SECRET`, and optionally `ALLOWED_ORIGIN`).
5. Deploy. Render provides `PORT` automatically; the server already reads `process.env.PORT`.

> **Note:** `ALLOWED_ORIGIN` should be set to your public Render URL (e.g. `https://askgpt.onrender.com`) once you know it.

## Project structure

```
.
├── config/          # system prompt and DB config
├── middleware/      # JWT auth middleware
├── models/          # Mongoose User and Chat models
├── routes/          # auth, chats and chat (LLM) routes
├── services/        # LLM service (streaming + non-streaming)
├── public/          # frontend (HTML, CSS, JS)
├── server.js        # app entry point
└── .env.example     # example environment variables
```

## License

MIT