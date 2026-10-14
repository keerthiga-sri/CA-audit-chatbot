import { Type } from "@google/genai";
import * as XLSX from "xlsx";
import {
  CHAT_MODEL,
  embedMany,
  generate,
  isLocalModel,
  OLLAMA_BASE_URL,
  OLLAMA_CHAT_MODEL,
} from "@/lib/gemini";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { memoryStore } from "@/lib/memory-store";
import { getAuditorProfile } from "@/lib/langchain";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { verifyApiKeyRequest } from "@/lib/api-keys";


export const runtime = "nodejs";
export const maxDuration = 60;

type Row = { year: number; income?: number | null; profit?: number | null; loss?: number | null };

export async function OPTIONS() {
  return handleCorsPreflight();
}

/** Fast deterministic parser for structured CSV / TSV / pipe tables */
function tryParseTabularRows(text: string): Row[] {
  const lines = text.split(/\r?\n/);
  const rows: Row[] = [];
  const seenYears = new Set<number>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Split by comma, tab, or pipe
    const parts = trimmed.split(/[,|\t]/).map((p) => p.trim().replace(/["']/g, ""));
    if (parts.length >= 3) {
      const yearStr = parts[0].replace(/^FY\s*/i, "").trim();
      const year = parseInt(yearStr, 10);
      if (!isNaN(year) && year >= 1990 && year <= 2040 && !seenYears.has(year)) {
        const income = parseFloat(parts[1].replace(/,/g, ""));
        const profit = parseFloat(parts[2].replace(/,/g, ""));
        const loss = parts[3] ? parseFloat(parts[3].replace(/,/g, "")) : 0;

        if (!isNaN(income) || !isNaN(profit) || !isNaN(loss)) {
          seenYears.add(year);
          rows.push({
            year,
            income: isNaN(income) ? null : income,
            profit: isNaN(profit) ? null : profit,
            loss: isNaN(loss) ? null : loss,
          });
        }
      }
    }
  }

  return rows;
}

/** Turn an uploaded file into plain text. */
async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  if (name.endsWith(".pdf")) {
    const res = await generate({
      model: CHAT_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "application/pdf", data: buf.toString("base64") } },
            {
              text:
                "Transcribe everything in this audit document as plain text. Keep every table row on its own line with the values separated by ' | '. Extract all auditor information, client information, and yearly financial figures. Do not summarise.",
            },
          ],
        },
      ],
      config: { temperature: 0 },
    });
    return res.text ?? "";
  }

  if (/\.(xlsx|xls|csv)$/.test(name)) {
    const wb = XLSX.read(buf, { type: "buffer" });
    return wb.SheetNames.map(
      (n) => `# Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`
    ).join("\n\n");
  }

  return buf.toString("utf8"); // .txt, .md
}

/** Ask local model, tabular parser, or Gemini to extract structured 10-year figures and audit metadata. */
async function extractRows(text: string): Promise<Row[]> {
  // 1) Fast deterministic parser for structured CSV / TSV / table formats
  const directRows = tryParseTabularRows(text);
  if (directRows.length >= 3) {
    return directRows.sort((a, b) => a.year - b.year);
  }

  // 2) Local Ollama model extraction if local mode is active
  if (isLocalModel()) {
    try {
      const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: OLLAMA_CHAT_MODEL,
          messages: [
            {
              role: "user",
              content: `From the financial audit document below, extract one record per financial year with the income, profit, and loss amounts.
Output MUST be a JSON array of objects with keys: "year" (integer), "income" (number or null), "profit" (number or null), "loss" (number or null).
If a year has a profit, set loss to 0. If it has a loss, set profit to 0.
Return ONLY valid JSON array with no extra text or markdown formatting.
Document snippet:
${text.slice(0, 8000)}`,
            },
          ],
          stream: false,
        }),
      });

      if (res.ok) {
        const data = (await res.json()) as { message?: { content?: string } };
        const content = data.message?.content || "";
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as Row[];
          const valid = parsed
            .filter((r) => Number.isInteger(Number(r.year)) && Number(r.year) > 1900 && Number(r.year) < 2100)
            .map((r) => ({
              year: Number(r.year),
              income: r.income !== null && r.income !== undefined ? Number(r.income) : null,
              profit: r.profit !== null && r.profit !== undefined ? Number(r.profit) : null,
              loss: r.loss !== null && r.loss !== undefined ? Number(r.loss) : null,
            }));
          if (valid.length > 0) {
            return valid.sort((a, b) => a.year - b.year);
          }
        }
      }
    } catch (err) {
      console.warn("Local Ollama extraction failed, attempting Gemini fallback:", err);
    }
  }

  // 3) Fallback to Gemini if API key is present
  if (process.env.GEMINI_API_KEY) {
    const res = await generate({
      model: CHAT_MODEL,
      contents:
        "From the financial audit document below, extract one record per financial year with the income, profit, and loss amounts exactly as written.\n" +
        "Use plain numbers (no currency symbols or commas).\n" +
        "If a year has a profit, set loss to 0 (unless explicit net loss is also given).\n" +
        "If it has a loss, record the loss as a positive number and set profit to 0.\n" +
        "If the document uses financial years like 2018-19, use the ending year (2019).\n" +
        "Extract up to 10 consecutive years of financial records.\n\n" +
        text.slice(0, 150_000),
      config: {
        temperature: 0,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              year: { type: Type.INTEGER },
              income: { type: Type.NUMBER, nullable: true },
              profit: { type: Type.NUMBER, nullable: true },
              loss: { type: Type.NUMBER, nullable: true },
            },
            required: ["year"],
          },
        },
      },
    });
    const rows = JSON.parse(res.text ?? "[]") as Row[];
    return rows.filter((r) => Number.isInteger(r.year)).sort((a, b) => a.year - b.year);
  }

  return [];
}

function chunkText(text: string, size = 1500, overlap = 200): string[] {
  const clean = text.replace(/\r/g, "").trim();
  const chunks: string[] = [];
  for (let i = 0; i < clean.length; i += size - overlap) {
    chunks.push(clean.slice(i, i + size));
    if (i + size >= clean.length) break;
  }
  return chunks;
}

export async function POST(req: Request) {
  try {
    const auth = await verifyApiKeyRequest(req);
    if (!auth.authorized) {
      return apiError(auth.reason || "Unauthorized", 401);
    }

    const contentType = req.headers.get("content-type") || "";

    let clientId: string | null = null;
    let clientName: string | null = null;
    let text = "";
    let fileName = "audit_data.txt";
    let explicitRows: Row[] | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") as File | null;
      clientId = form.get("clientId") as string | null;
      clientName = form.get("clientName") as string | null;

      if (!file) {
        return apiError("Please upload a file in the form data.", 400);
      }
      fileName = file.name;
      text = await fileToText(file);
    } else {
      // JSON body support
      const json = await req.json();
      clientId = json.clientId || null;
      clientName = json.clientName || null;
      text = json.text || json.content || json.csv || "";
      fileName = json.fileName || "api_payload.txt";
      if (Array.isArray(json.rows) && json.rows.length > 0) {
        explicitRows = json.rows;
      }
    }

    // Resolve client
    let client: { id: string; name: string; email: string | null } | null = null;
    if (isSupabaseConfigured()) {
      try {
        if (clientId) {
          const { data } = await supabase
            .from("clients")
            .select("id, name, email")
            .eq("id", clientId)
            .maybeSingle();
          if (data) client = data;
        }
        if (!client && clientName) {
          const { data } = await supabase
            .from("clients")
            .select("id, name, email")
            .ilike("name", `%${clientName.trim()}%`)
            .limit(1)
            .maybeSingle();
          if (data) client = data;
        }
      } catch (err) {
        console.warn("Supabase client query failed:", err);
      }
    }

    // Fallback to memoryStore
    if (!client && (clientId || clientName)) {
      const match = memoryStore.findClient(clientId || clientName || "");
      if (match) {
        client = { id: match.id, name: match.name, email: match.email };
      }
    }

    if (!client) {
      if (clientName) {
        const added = memoryStore.addClient(clientName);
        client = { id: added.id, name: added.name, email: added.email };
      } else {
        return apiError(
          "Client not found. Please register or select a valid client first.",
          404
        );
      }
    }

    clientId = client.id;

    let rows: Row[] = [];
    if (explicitRows && explicitRows.length > 0) {
      rows = explicitRows
        .filter((r) => Number.isInteger(Number(r.year)))
        .map((r) => ({
          year: Number(r.year),
          income: r.income !== null && r.income !== undefined ? Number(r.income) : null,
          profit: r.profit !== null && r.profit !== undefined ? Number(r.profit) : null,
          loss: r.loss !== null && r.loss !== undefined ? Number(r.loss) : null,
        }))
        .sort((a, b) => a.year - b.year);
    } else {
      if (text.trim().length < 20) {
        return apiError("Document contains insufficient readable text.", 400);
      }
      rows = await extractRows(text);
    }

    if (rows.length === 0) {
      return apiError(
        "No yearly income/profit/loss figures were found. Ensure the document lists yearly financial records.",
        422
      );
    }

    const auditor = getAuditorProfile();

    // Create high-fidelity semantic chunks for RAG:
    const metadataChunk = `AUDIT REPORT VERIFICATION:
Auditor: ${auditor.name} (${auditor.regNo})
Firm: ${auditor.firm}
Designation: ${auditor.designation}
Client: ${client.name} (${client.email || "No email"})
Document: ${fileName}
Total Financial Years Audited: ${rows.length} years (${rows[0].year} to ${rows[rows.length - 1].year}).`;

    const yearChunks = rows.map(
      (r) =>
        `Client "${client!.name}" Financial Year ${r.year}: Income/Revenue = ${r.income ?? "n/a"}, Net Profit = ${r.profit ?? 0}, Net Loss = ${r.loss ?? 0}. Audited by ${auditor.name}.`
    );

    const summaryChunk = `10-YEAR FINANCIAL SUMMARY FOR ${client.name.toUpperCase()}:
${rows.map((r) => `FY ${r.year} -> Income: ${r.income ?? 0} | Profit: ${r.profit ?? 0} | Loss: ${r.loss ?? 0}`).join("\n")}
Total Audited Years: ${rows.length}. Certified by ${auditor.name} (${auditor.firm}).`;

    const rawChunks = text ? chunkText(text) : [];

    const allChunks = [metadataChunk, summaryChunk, ...yearChunks, ...rawChunks];
    const vectors = await embedMany(allChunks);

    let savedToSupabase = false;
    if (isSupabaseConfigured()) {
      try {
        // Clean up previous client records
        await supabase.from("chunks").delete().eq("client_id", clientId);
        await supabase.from("financials").delete().eq("client_id", clientId);

        // Insert structured yearly ledger
        const { error: fErr } = await supabase.from("financials").insert(
          rows.map((r) => ({
            client_id: clientId,
            year: r.year,
            income: r.income ?? null,
            profit: r.profit ?? null,
            loss: r.loss ?? null,
          }))
        );
        if (fErr) console.warn("Supabase financials insert failed:", fErr.message);

        // Insert semantic chunks with 768-dim embeddings
        const { error: cErr } = await supabase.from("chunks").insert(
          allChunks.map((content, i) => ({
            client_id: clientId,
            content,
            embedding: vectors[i] as unknown as string,
          }))
        );
        if (cErr) console.warn("Supabase chunks insert failed:", cErr.message);

        savedToSupabase = !fErr && !cErr;
      } catch (sbErr: any) {
        console.warn("Supabase connection failed:", sbErr?.message);
      }
    }

    // Always update memoryStore as fallback
    memoryStore.saveFinancials(clientId, rows);
    memoryStore.saveChunks(
      clientId,
      allChunks.map((content, i) => ({ content, embedding: vectors[i] }))
    );

    const persistenceNotice = savedToSupabase
      ? ""
      : " (Active in session. Set SUPABASE_URL in Vercel to save to Postgres).";

    return apiResponse({
      success: true,
      message: `Successfully indexed ${rows.length} financial years (${rows[0].year} - ${rows[rows.length - 1].year}) for ${client.name}.${persistenceNotice}`,
      client: { id: client.id, name: client.name, email: client.email },
      years: rows.length,
      chunks: allChunks.length,
      firstYear: rows[0].year,
      lastYear: rows[rows.length - 1].year,
      financials: rows,
      auditor: auditor.name,
      savedToSupabase,
    });
  } catch (e: any) {
    console.error("Ingest error:", e);
    return apiError(e?.message ?? "Upload and ingestion failed.", 500);
  }
}

