# Audit Desk: RAG + MCP chatbot for auditors and their clients

A Next.js app where an Auditor uploads a client's 10-year income / profit / loss document,
and anyone using the app can chat about it. The chatbot:

- answers from that client's document only (RAG), with **one single answer** per question
- replies conversationally to every message
- schedules a **Google Meet** on a topic you name (MCP tool)
- uses **Local Model (Ollama: Llama 3.1 & nomic-embed-text)** for chat and embeddings (no cloud API keys needed), and **Supabase** (Postgres + pgvector) for storage

## How it works

```
Upload document -> Parsed locally (Excel, CSV, pdf-parse) -> yearly figures saved in `financials`
                                                         -> text chunks + nomic-embed-text embeddings saved in `chunks`

Question -> embed via local Ollama -> match_chunks (this client only) + yearly figures
         -> Llama 3.1 answers from that context (temperature 0, one answer)
         -> if a meeting is requested: Llama 3.1 calls the MCP tool
            `schedule_meeting` -> Google Calendar event with a Meet link + email invites
```

## Setup

### 1. Install Dependencies
```bash
npm install
cp .env.example .env
```

### 2. Local Model (Ollama)
Ensure Ollama is installed and running:
```bash
ollama serve
ollama pull llama3.1
ollama pull nomic-embed-text
```
By default in `.env`:
- `LLM_PROVIDER=local`
- `OLLAMA_BASE_URL=http://127.0.0.1:11434`
- `OLLAMA_CHAT_MODEL=llama3.1:latest`
- `OLLAMA_EMBED_MODEL=nomic-embed-text`
No Gemini API key is needed.

### 3. Supabase
1. Create a project at https://supabase.com.
2. Open **SQL Editor**, paste the contents of `supabase/schema.sql`, and run it.
3. Copy the project URL and the **service_role** key (Project Settings > API) into `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`.
   The service key stays on the server; never expose it in browser code.

### 4. Google Meet scheduling
1. In Google Cloud Console, create a project and enable the **Google Calendar API**.
2. Configure the OAuth consent screen (add your own Google account as a test user).
3. Create an **OAuth client ID** of type *Web application* and add this redirect URI:
   `http://localhost:3005/oauth2callback`
4. Put the client ID and secret in `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`).
5. Run `npm run google-token`, open the link it prints, approve, and paste the printed
   `GOOGLE_REFRESH_TOKEN=...` line into `.env`.
6. Set `AUDITOR_EMAIL` (invited to every meeting along with the client's email) and `TIMEZONE`
   (for example `Asia/Kolkata`).

Meetings are created on the Google account that granted access in step 5.

### 5. Run
```bash
npm run dev
```
Open http://localhost:3000, click **Add a client or upload a document**, add a client,
upload their document, then go back to the chat.

## Document format

PDF, Excel (.xlsx/.xls), CSV or text. It should list, for each of the 10 years, the income,
profit and loss. Gemini extracts the yearly numbers into a table, so the chatbot quotes exact
figures instead of guessing from text. Uploading again replaces that client's earlier data.

## Try these

- "What was the profit in 2021?"
- "Which year had the lowest income?"
- "What is the total income over the 10 years?"
- "Schedule a Google Meet about the FY 2024 audit tomorrow at 4 pm for 45 minutes."

## Notes

- **Hosting:** the MCP server runs as a child process (`npx tsx mcp/meet-server.ts`), so deploy on a
  host that allows long-running Node processes (a VPS, Railway, Render, Fly.io). Serverless hosts
  such as Vercel are not a good fit for this setup.
- **Access control:** set `APP_PASSWORD` in `.env` to put a password on the whole app. The app has
  no per-user login, so anyone with the password can see every client. Add Supabase Auth and
  per-auditor filtering before real client data goes on a public server.
- **Embeddings size:** the schema uses 768 dimensions to match `EMBED_DIMS` in `lib/gemini.ts`.
  If you change one, change the other and re-upload documents.
- **Model names:** set `GEMINI_CHAT_MODEL` / `GEMINI_EMBED_MODEL` in `.env` if Google retires or
  renames a model.

## REST API & External Integrations

The entire project is exposed as an open, CORS-enabled REST API with OpenAPI 3.0 specs and client SDKs:

- **Interactive API Documentation & Tester:** Open [http://localhost:3000/docs](http://localhost:3000/docs)
- **OpenAPI 3.0 Specification:** [http://localhost:3000/api/openapi.json](http://localhost:3000/api/openapi.json)
- **Downloadable Postman Collection:** [http://localhost:3000/api/postman.json](http://localhost:3000/api/postman.json)
- **API Reference & Sharing Guide:** [API_DOCUMENTATION.md](file:///d:/PiBi/ca-audit-chatbot/API_DOCUMENTATION.md)
- **TypeScript / JavaScript Client SDK:** [`sdk/ca-audit-client.ts`](file:///d:/PiBi/ca-audit-chatbot/sdk/ca-audit-client.ts)
- **Python Integration Example:** [`examples/python_client.py`](file:///d:/PiBi/ca-audit-chatbot/examples/python_client.py)

### Core Endpoints:
- `POST /api/chat` - RAG audit queries, financial answers, and Google Meet scheduling
- `POST /api/call-audit/evaluate` - Deep ICAI compliance scoring for consultations (audio or transcript)
- `GET /api/call-audit` - List consultation audit reports, pass rates, and quality metrics
- `GET /api/call-audit/sample` - Pre-loaded consultation samples and standard ICAI 5-dim rubric
- `POST /api/ingest` - Ingest financial documents (PDF, Excel, CSV, TXT) or raw JSON rows
- `GET /api/clients` - List clients with document status (`?stats=true`)
- `POST /api/clients` - Register a new client
- `GET /api/financials` - Fetch 10-year ledger (`?clientName=Apex%20Enterprises`)
- `POST /api/financials` - Programmatic financial entry updates
- `POST /api/calendar/sync` - Schedule / update Google Meet consultations
- `POST /api/email/send` - Send RFC 5545 iCalendar invites
- `GET /api/health` - Liveness & latency probe
- `GET /api` - Service discovery directory

## Project layout

```
app/page.tsx              chat screen with client's 10-year ledger & voice interaction
app/call-audit/page.tsx   Call Scoring & Audit Hub (audio/transcript scoring, ICAI rubric, certificates)
app/docs/page.tsx         Interactive REST API Portal & live tester
app/upload/page.tsx       add clients and upload documents
app/api/call-audit        call scoring, evaluations, and compliance metrics API
app/api/chat/route.ts     RAG + LangChain + Meeting scheduling API
app/api/ingest/route.ts   read document, extract yearly figures, embed, store
app/api/clients           list, create, get, delete audit clients
app/api/financials        query and upsert 10-year ledgers
app/api/calendar/sync     Google Calendar / Meet synchronization
lib/call-audit.ts         ICAI evaluation models, standard rubric, and heuristic fallbacks
```

