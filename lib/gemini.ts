import { GoogleGenAI } from "@google/genai";

// Ensure baseUrl always uses IPv4 (127.0.0.1) on Windows to prevent IPv6 [::1] connection delays
function normalizeOllamaUrl(rawUrl?: string): string {
  const url = (rawUrl || process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim();
  return url.replace("://localhost:", "://127.0.0.1:").replace("://localhost", "://127.0.0.1");
}

// --- Local Ollama Configuration ---
export const OLLAMA_BASE_URL = normalizeOllamaUrl(process.env.OLLAMA_BASE_URL);
export const OLLAMA_CHAT_MODEL = process.env.OLLAMA_CHAT_MODEL || "llama3.1:latest";
export const OLLAMA_EMBED_MODEL = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";

// --- Cloud Gemini Configuration (Optional Alternative) ---
export const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.1-flash-lite";
export const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || "gemini-embedding-001";
export const EMBED_DIMS = 768; // must match vector(768) in supabase/schema.sql

export function isLocalModel(): boolean {
  const provider = (process.env.LLM_PROVIDER || "local").trim().toLowerCase();
  return provider === "local" || provider === "ollama" || !process.env.GEMINI_API_KEY;
}

// Lazy instantiate Gemini client only when in cloud Gemini mode
let _aiClient: GoogleGenAI | null = null;
export function getAiClient(): GoogleGenAI {
  if (!_aiClient) {
    _aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || "local-mode-dummy-key",
    });
  }
  return _aiClient;
}
export const ai = new Proxy({} as GoogleGenAI, {
  get: (_target, prop: keyof GoogleGenAI) => {
    return getAiClient()[prop];
  },
});

/** Local embedding for a single text via Ollama */
async function embedLocalSingle(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_EMBED_MODEL,
      prompt: text,
    }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embedding error ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { embedding?: number[] };
  return data.embedding ?? [];
}

/** Deterministic 768-dim embedding fallback for preview/demo when no model is available */
export function generateFallbackEmbedding(text: string): number[] {
  const vec = new Array(EMBED_DIMS).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
    const idx = Math.abs(hash + i * 31) % EMBED_DIMS;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0)) || 1;
  return vec.map((v) => Number((v / norm).toFixed(6)));
}

/** Embed many texts (used when ingesting documents or seeding) with batch acceleration */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  // If cloud Gemini API key is configured, prioritize Gemini embeddings
  if (process.env.GEMINI_API_KEY && !isLocalModel()) {
    try {
      const out: number[][] = [];
      const BATCH = 50;
      for (let i = 0; i < texts.length; i += BATCH) {
        const res = await getAiClient().models.embedContent({
          model: EMBED_MODEL,
          contents: texts.slice(i, i + BATCH),
          config: { outputDimensionality: EMBED_DIMS, taskType: "RETRIEVAL_DOCUMENT" },
        });
        for (const e of res.embeddings ?? []) out.push(e.values ?? []);
      }
      return out;
    } catch (geminiErr) {
      console.warn("Gemini embedding failed, falling back to local/pseudo embedding:", geminiErr);
    }
  }

  // Attempt local Ollama embedding if running locally
  if (!process.env.VERCEL) {
    try {
      const batchRes = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_EMBED_MODEL,
          input: texts,
        }),
      });

      if (batchRes.ok) {
        const batchData = (await batchRes.json()) as { embeddings?: number[][] };
        if (
          batchData.embeddings &&
          Array.isArray(batchData.embeddings) &&
          batchData.embeddings.length === texts.length
        ) {
          return batchData.embeddings;
        }
      }

      // Sequential fallback
      const out: number[][] = [];
      for (const t of texts) {
        out.push(await embedLocalSingle(t));
      }
      return out;
    } catch {
      // Local Ollama offline, fall through to deterministic embedding
    }
  }

  // Fallback to deterministic pseudo-embeddings so upload never crashes
  return texts.map(generateFallbackEmbedding);
}

/** Embed a single question (used at chat retrieval time) */
export async function embedQuery(text: string): Promise<number[]> {
  if (process.env.GEMINI_API_KEY && !isLocalModel()) {
    try {
      const res = await getAiClient().models.embedContent({
        model: EMBED_MODEL,
        contents: text,
        config: { outputDimensionality: EMBED_DIMS, taskType: "RETRIEVAL_QUERY" },
      });
      if (res.embeddings?.[0]?.values) {
        return res.embeddings[0].values;
      }
    } catch (err) {
      console.warn("Gemini embedQuery failed, falling back:", err);
    }
  }

  if (!process.env.VERCEL) {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_EMBED_MODEL,
          input: text,
        }),
      });
      if (res.ok) {
        const data = (await res.json()) as { embeddings?: number[][] };
        if (data.embeddings && data.embeddings[0] && data.embeddings[0].length === EMBED_DIMS) {
          return data.embeddings[0];
        }
      }
    } catch {
      // Fallback
    }

    try {
      return await embedLocalSingle(text);
    } catch {
      // Fallback
    }
  }

  return generateFallbackEmbedding(text);
}

const FALLBACK_MODEL = process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** generate content with local Ollama as primary */
export async function generate(
  params: Parameters<typeof GoogleGenAI.prototype.models.generateContent>[0]
): Promise<any> {
  if (isLocalModel()) {
    // Extract prompt text from contents
    let promptText = "";
    if (typeof params.contents === "string") {
      promptText = params.contents;
    } else if (Array.isArray(params.contents)) {
      promptText = params.contents
        .map((c: any) => {
          if (typeof c === "string") return c;
          if (c.parts) return c.parts.map((p: any) => p.text || "").join("\n");
          return c.text || "";
        })
        .join("\n");
    }

    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
        messages: [{ role: "user", content: promptText }],
        stream: false,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Ollama chat error ${res.status}: ${errText}`);
    }

    const data = (await res.json()) as { message?: { content?: string } };
    return { text: data.message?.content || "" };
  }

  // Gemini cloud generation
  const models = [params.model, FALLBACK_MODEL].filter((m, i, a) => a.indexOf(m) === i);
  let lastErr: any;
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await getAiClient().models.generateContent({ ...params, model });
      } catch (e: any) {
        lastErr = e;
        const msg = String(e?.message ?? e);
        const busy =
          /"code":\s*(500|503|429)|UNAVAILABLE|RESOURCE_EXHAUSTED|high demand/i.test(msg) ||
          [500, 503, 429].includes(e?.status);
        if (!busy) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}
