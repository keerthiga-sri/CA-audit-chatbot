import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { memoryStore } from "@/lib/memory-store";
import { embedQuery } from "@/lib/gemini";
import { runLangChainAuditChat, getAuditorProfile } from "@/lib/langchain";
import { executeMeetingAction, parseMeetingIntent } from "@/lib/meeting-scheduler";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { verifyApiKeyRequest } from "@/lib/api-keys";

export const runtime = "nodejs";
export const maxDuration = 60;

type ChatMessage = { role: "user" | "assistant"; content: string };

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(req: Request) {
  try {
    // 0) Verify API Key Authentication
    const auth = await verifyApiKeyRequest(req);
    if (!auth.authorized) {
      return apiError(auth.reason || "Unauthorized", 401);
    }

    const body = await req.json().catch(() => ({}));

    // 1) Action Dispatcher (if caller passed a direct action)
    const action = typeof body.action === "string" ? body.action.toLowerCase().trim() : null;

    if (action === "list_clients" || action === "clients") {
      let clients: any[] = [];
      if (isSupabaseConfigured()) {
        try {
          const { data } = await supabase
            .from("clients")
            .select("id, name, email, created_at")
            .order("name");
          if (data && data.length > 0) clients = data;
        } catch {}
      }
      if (clients.length === 0) {
        clients = memoryStore.getClients();
      }
      return apiResponse({
        success: true,
        action: "list_clients",
        clients,
      });
    }


    if (action === "auditor" || action === "profile") {
      const auditor = getAuditorProfile();
      return apiResponse({
        success: true,
        action: "auditor_profile",
        auditor,
      });
    }

    // 2) Parse message / query
    let messages: ChatMessage[] = [];
    if (Array.isArray(body.messages) && body.messages.length > 0) {
      messages = body.messages;
    } else if (typeof body.message === "string" && body.message.trim()) {
      messages = [{ role: "user", content: body.message.trim() }];
    } else if (typeof body.query === "string" && body.query.trim()) {
      messages = [{ role: "user", content: body.query.trim() }];
    } else if (typeof body.prompt === "string" && body.prompt.trim()) {
      messages = [{ role: "user", content: body.prompt.trim() }];
    } else if (!action) {
      return apiError(
        "Please provide a 'message', 'query', or 'messages' array (or 'action': 'list_clients').",
        400
      );
    }

    const question = messages.at(-1)?.content?.trim() ?? "";
    const lowerQuestion = question.toLowerCase();

    // 3) Resolve Client by clientId, clientName, or fuzzy match in message text
    let clientId = body.clientId as string | undefined;
    const clientName = body.clientName as string | undefined;

    let client: { id: string; name: string; email: string | null } | null = null;

    if (isSupabaseConfigured()) {
      try {
        if (clientId) {
          const { data, error } = await supabase
            .from("clients")
            .select("id, name, email")
            .eq("id", clientId)
            .maybeSingle();
          if (!error && data) client = data;
        }

        if (!client && clientName) {
          const { data, error } = await supabase
            .from("clients")
            .select("id, name, email")
            .ilike("name", `%${clientName.trim()}%`)
            .limit(1)
            .maybeSingle();
          if (!error && data) client = data;
        }
      } catch (sbErr) {
        console.warn("Supabase client lookup error:", sbErr);
      }
    }

    if (!client && (clientId || clientName)) {
      const match = memoryStore.findClient(clientId || clientName || "");
      if (match) client = { id: match.id, name: match.name, email: match.email };
    }

    // Fetch all clients once for matching & fallback suggestions
    let allClients: Array<{ id: string; name: string; email: string | null }> = [];
    if (isSupabaseConfigured()) {
      try {
        const { data } = await supabase
          .from("clients")
          .select("id, name, email")
          .order("name");
        if (data && data.length > 0) allClients = data;
      } catch {}
    }
    if (allClients.length === 0) {
      allClients = memoryStore.getClients();
    }

    // Match client name inside query text if not explicitly passed
    if (!client && allClients && allClients.length > 0) {
      for (const c of allClients) {
        const cLower = c.name.toLowerCase();
        const primaryWord = cLower.split(/\s+/)[0];
        if (
          lowerQuestion.includes(cLower) ||
          (primaryWord.length >= 3 && lowerQuestion.includes(primaryWord))
        ) {
          client = c;
          clientId = c.id;
          break;
        }
      }
    }

    // If still only 1 client exists in DB, use it as default
    if (!client && !clientId && !clientName && allClients?.length === 1) {
      client = allClients[0];
      clientId = client.id;
    }


    // 4) Check Meeting Intent (Autonomous Google Meet & Calendar Scheduling)
    const tz = process.env.TIMEZONE || "Asia/Kolkata";
    const meetingIntent = parseMeetingIntent(question, tz, messages.slice(0, -1));

    if (meetingIntent.isMeetingQuery || action === "schedule_meeting") {
      const meetingReply = await executeMeetingAction({
        query: question || body.topic || "CA Audit Consultation",
        clientName: client?.name || body.attendeeName || "Audit Client",
        clientEmail: client?.email || body.attendeeEmail || null,
        history: messages.slice(0, -1),
      });

      if (meetingReply) {
        return apiResponse({
          success: true,
          reply: meetingReply,
          isMeetingAction: true,
          client: client ? { id: client.id, name: client.name, email: client.email } : null,
        });
      }
    }

    // 5) Handle Auditor Profile / Firm Inquiries (without requiring client)
    const isAuditorQuery =
      /(who is the auditor|who are you|auditor details|firm details|ca details|contact details|office address|credentials|qualifications|about keerthiga|keerthiga sri)/i.test(
        lowerQuestion
      );

    if (isAuditorQuery && !client) {
      const auditor = getAuditorProfile();
      const clientNames = (allClients || []).map((c) => c.name).join(", ");
      const reply = `I am the AI Audit Assistant for **${auditor.name}** (${auditor.regNo}), ${auditor.designation} at **${auditor.firm}**.\n\n` +
        `📍 **Office Address:** ${auditor.officeAddress}\n` +
        `📧 **Email:** ${auditor.email}\n` +
        `📞 **Phone:** ${auditor.phone}\n` +
        `🎯 **Specialization:** ${auditor.specialization}\n\n` +
        `Currently available audit clients in system: **${clientNames || "None registered"}**.\n` +
        `You can ask financial questions for any client or ask me to schedule a Google Meet consultation!`;

      return apiResponse({
        success: true,
        reply,
        isMeetingAction: false,
        auditor,
      });
    }

    // 6) Handle "List Clients" Inquiries in Natural Language
    const isListClientsQuery =
      /(list (?:all )?clients|show clients|what clients|who are the clients|available clients|registered clients)/i.test(
        lowerQuestion
      );

    if (isListClientsQuery && !client) {
      const clientList = allClients || [];
      const reply = `Here are the active audit clients registered in the system:\n\n` +
        clientList.map((c, i) => `${i + 1}. **${c.name}** (${c.email || "No email"}) — ID: \`${c.id}\``).join("\n") +
        `\n\nTo audit any client, simply ask: *"What was ${clientList[0]?.name || "client"}'s profit in 2020?"* or provide their name in your request.`;

      return apiResponse({
        success: true,
        reply,
        isMeetingAction: false,
        clients: clientList,
      });
    }

    // 7) If no client was specified and could not be determined:
    if (!client) {
      const clientList = allClients || [];
      const namesList = clientList.map((c) => `• **${c.name}**`).join("\n");
      const reply = `Please specify which client you'd like to analyze. The registered audit clients are:\n\n${namesList}\n\n` +
        `Example query: *"What was ${clientList[0]?.name || "Apex Enterprises"}'s net profit in 2020?"* or *"Schedule a meeting for ${clientList[0]?.name || "Apex Enterprises"} tomorrow at 3 PM"*`;

      return apiResponse({
        success: true,
        reply,
        isMeetingAction: false,
        availableClients: clientList,
        clientRequired: true,
      });
    }

    clientId = client.id;

    // 8) RAG: Retrieve 10-Year Financials and Semantic Chunks for this Client
    const qVec = await embedQuery(question);

    let financials: any[] = [];
    let excerpts: string[] = [];

    if (isSupabaseConfigured()) {
      try {
        const [yearsRes, chunksRes] = await Promise.all([
          supabase
            .from("financials")
            .select("year, income, profit, loss")
            .eq("client_id", clientId)
            .order("year", { ascending: true }),
          supabase.rpc("match_chunks", {
            q: qVec as unknown as string,
            cid: clientId,
            k: 3,
          }),
        ]);

        if (yearsRes.data && yearsRes.data.length > 0) {
          financials = yearsRes.data;
        }
        if (chunksRes.data) {
          excerpts = ((chunksRes.data as { content: string }[]) ?? []).map((c) => c.content);
        }
      } catch (sbErr) {
        console.warn("Supabase RAG query failed, using memoryStore:", sbErr);
      }
    }

    // Fallback to memoryStore if Supabase is offline or empty
    if (financials.length === 0) {
      financials = memoryStore.getFinancials(clientId);
    }
    if (excerpts.length === 0) {
      excerpts = memoryStore.getChunks(clientId).slice(0, 3).map((c) => c.content);
    }


    // 9) Execute Chat via LangChain RAG Pipeline
    const reply = await runLangChainAuditChat({
      messages,
      clientName: client.name,
      clientEmail: client.email,
      financials,
      excerpts,
      mcpClient: null,
    });

    return apiResponse({
      success: true,
      reply,
      isMeetingAction: false,
      client: { id: client.id, name: client.name, email: client.email },
      citations: excerpts,
      financials,
    });
  } catch (e: any) {
    console.error("Chat API error:", e);
    return apiError(
      e?.message ?? "An error occurred while processing the audit query.",
      500
    );
  }
}
