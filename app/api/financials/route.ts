import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { memoryStore } from "@/lib/memory-store";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { verifyApiKeyRequest } from "@/lib/api-keys";

export const runtime = "nodejs";

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
    const clientId = url.searchParams.get("clientId");
    const clientName = url.searchParams.get("clientName");
    const order = url.searchParams.get("order")?.toLowerCase() === "desc" ? false : true;

    let targetClientId = clientId;

    if (!targetClientId && clientName && isSupabaseConfigured()) {
      try {
        const { data: client } = await supabase
          .from("clients")
          .select("id")
          .ilike("name", `%${clientName.trim()}%`)
          .limit(1)
          .maybeSingle();

        if (client) {
          targetClientId = client.id;
        }
      } catch {}
    }

    if (!targetClientId && (clientId || clientName)) {
      const match = memoryStore.findClient(clientId || clientName || "");
      if (match) targetClientId = match.id;
    }

    if (!targetClientId) {
      return apiError("Please provide 'clientId' or 'clientName' query parameter.", 400);
    }

    let records: any[] = [];
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from("financials")
          .select("year, income, profit, loss")
          .eq("client_id", targetClientId)
          .order("year", { ascending: order });

        if (!error && data && data.length > 0) {
          records = data;
        }
      } catch (err) {
        console.warn("Supabase query failed, falling back to memory:", err);
      }
    }

    if (records.length === 0) {
      const memRecords = memoryStore.getFinancials(targetClientId);
      records = order ? memRecords : [...memRecords].reverse();
    }


    // Calculate aggregated metrics for easy API consumption
    const totalIncome = records.reduce((acc, r) => acc + (r.income || 0), 0);

    const totalProfit = records.reduce((acc, r) => acc + (r.profit || 0), 0);
    const totalLoss = records.reduce((acc, r) => acc + (r.loss || 0), 0);
    const netProfit = totalProfit - totalLoss;

    return apiResponse({
      success: true,
      clientId: targetClientId,
      count: records.length,
      metrics: {
        totalIncome,
        totalProfit,
        totalLoss,
        netProfit,
        recordedYears: records.map((r) => r.year),
      },
      financials: records,
    });
  } catch (err: any) {
    return apiError(err?.message || "Failed to fetch financials", 500);
  }
}

export async function POST(req: Request) {
  try {
    const auth = await verifyApiKeyRequest(req);
    if (!auth.authorized) {
      return apiError(auth.reason || "Unauthorized", 401);
    }

    const body = await req.json();
    let clientId = body.clientId as string | undefined;
    const clientName = body.clientName as string | undefined;
    const records = Array.isArray(body.records)
      ? body.records
      : body.year
      ? [{ year: body.year, income: body.income, profit: body.profit, loss: body.loss }]
      : [];

    if (!clientId && clientName) {
      const { data: client } = await supabase
        .from("clients")
        .select("id")
        .ilike("name", `%${clientName.trim()}%`)
        .limit(1)
        .maybeSingle();
      if (client) clientId = client.id;
    }

    if (!clientId) {
      return apiError("Please provide 'clientId' or 'clientName'.", 400);
    }

    if (records.length === 0) {
      return apiError("Please provide financial records to insert/update.", 400);
    }

    // Upsert or insert records
    const cleaned = records
      .filter((r: any) => Number.isInteger(Number(r.year)))
      .map((r: any) => ({
        client_id: clientId,
        year: Number(r.year),
        income: r.income !== undefined && r.income !== null ? Number(r.income) : null,
        profit: r.profit !== undefined && r.profit !== null ? Number(r.profit) : null,
        loss: r.loss !== undefined && r.loss !== null ? Number(r.loss) : null,
      }));

    // Update memoryStore fallback
    memoryStore.saveFinancials(clientId, cleaned);

    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from("financials")
          .upsert(cleaned, { onConflict: "client_id,year" })
          .select("year, income, profit, loss");

        if (!error && data) {
          return apiResponse({
            success: true,
            message: `Successfully saved ${cleaned.length} financial year records.`,
            financials: data,
          });
        }
      } catch (err) {
        console.warn("Supabase upsert failed:", err);
      }
    }

    return apiResponse({
      success: true,
      message: `Successfully saved ${cleaned.length} financial year records.`,
      financials: cleaned,
    });
  } catch (err: any) {
    return apiError(err?.message || "Failed to update financial records.", 500);
  }
}

