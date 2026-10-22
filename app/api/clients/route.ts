import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { verifyApiKeyRequest } from "@/lib/api-keys";
import crypto from "crypto";

export const runtime = "nodejs";

interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
  financialYearsAudited?: number;
  documentChunks?: number;
  hasDocuments?: boolean;
}

// In-memory fallback if Supabase is offline or not yet configured in environment variables
const fallbackClients: ClientRecord[] = [
  {
    id: "sample-apex-001",
    name: "Sri",
    email: "sri@clientaudit.com",
    created_at: "2026-10-01T04:26:26.807Z",
    financialYearsAudited: 10,
    documentChunks: 12,
    hasDocuments: true,
  },
  {
    id: "sample-zenith-002",
    name: "KS",
    email: "audit@ks.in",
    created_at: "2026-10-05T10:00:00.000Z",
    financialYearsAudited: 10,
    documentChunks: 10,
    hasDocuments: true,
  },
];

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(req: Request) {
  try {
    const auth = await verifyApiKeyRequest(req);
    if (!auth.authorized) {
      return apiError(auth.reason || "Unauthorized", 401);
    }

    const url = new URL(req.url);
    const includeStats = url.searchParams.get("stats") === "true";

    if (isSupabaseConfigured()) {
      try {
        const { data: clients, error } = await supabase
          .from("clients")
          .select("id, name, email")
          .order("name");

        if (!error && clients) {
          if (includeStats) {
            const enriched = await Promise.all(
              clients.map(async (c) => {
                const [{ count: yearsCount }, { count: chunksCount }] = await Promise.all([
                  supabase
                    .from("financials")
                    .select("*", { count: "exact", head: true })
                    .eq("client_id", c.id),
                  supabase
                    .from("chunks")
                    .select("*", { count: "exact", head: true })
                    .eq("client_id", c.id),
                ]);
                return {
                  ...c,
                  financialYearsAudited: yearsCount ?? 0,
                  documentChunks: chunksCount ?? 0,
                  hasDocuments: (chunksCount ?? 0) > 0,
                };
              })
            );
            return apiResponse({ success: true, count: enriched.length, clients: enriched });
          }
          return apiResponse({ success: true, count: clients.length, clients });
        }
      } catch (err) {
        console.warn("Supabase query failed, falling back to local client store:", err);
      }
    }

    return apiResponse({
      success: true,
      count: fallbackClients.length,
      clients: fallbackClients,
    });
  } catch (err: any) {
    return apiError(err?.message || "Failed to fetch clients", 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await verifyApiKeyRequest(req);
    if (!auth.authorized) {
      return apiError(auth.reason || "Unauthorized", 401);
    }

    const body = await req.json();
    const name = body.name?.trim();
    const email = body.email?.trim() || null;

    if (!name) {
      return apiError("Client name is required.", 400);
    }

    if (isSupabaseConfigured()) {
      try {
        // Check if client name already exists
        const { data: existing } = await supabase
          .from("clients")
          .select("id, name, email")
          .ilike("name", name)
          .maybeSingle();

        if (existing) {
          return apiResponse(
            {
              success: true,
              message: "Client already registered.",
              client: existing,
              created: false,
            },
            { status: 200 }
          );
        }

        const { data, error } = await supabase
          .from("clients")
          .insert({ name, email })
          .select("id, name, email")
          .single();

        if (!error && data) {
          return apiResponse(
            {
              success: true,
              message: "Client registered successfully.",
              client: data,
              created: true,
            },
            { status: 201 }
          );
        }
      } catch (sbErr) {
        console.warn("Supabase insert error, falling back to memory store:", sbErr);
      }
    }

    // In-memory fallback if Supabase is offline or not yet configured
    const existingMemory = fallbackClients.find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existingMemory) {
      return apiResponse(
        {
          success: true,
          message: "Client already registered.",
          client: existingMemory,
          created: false,
        },
        { status: 200 }
      );
    }

    const newClient: ClientRecord = {
      id: crypto.randomUUID(),
      name,
      email,
      created_at: new Date().toISOString(),
      financialYearsAudited: 0,
      documentChunks: 0,
      hasDocuments: false,
    };
    fallbackClients.unshift(newClient);

    return apiResponse(
      {
        success: true,
        message: "Client registered successfully.",
        client: newClient,
        created: true,
      },
      { status: 201 }
    );
  } catch (err: any) {
    return apiError(err?.message || "Failed to create client", 500);
  }
}
