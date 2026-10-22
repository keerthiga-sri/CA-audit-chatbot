import { NextRequest } from "next/server";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { evaluateCallTranscript, CallAuditEvaluation } from "@/lib/call-audit";
import { memoryStore } from "@/lib/memory-store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";
import { ai, CHAT_MODEL, isLocalModel } from "@/lib/gemini";

export const runtime = "nodejs";

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";

    let transcript = "";
    let clientName = "Sri";
    let clientId: string | undefined = undefined;
    let auditorName = "CA Keerthiga Sri J.M.";
    let callTitle = "Statutory Audit Review Consultation";
    let callDate = new Date().toISOString().slice(0, 10);
    let callDurationMinutes = 25;
    let audioFileName: string | undefined = undefined;
    let hasAudio = false;

    // 1. Handle multipart/form-data with audio file
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as Blob | null;

      clientName = (formData.get("clientName") as string) || clientName;
      clientId = (formData.get("clientId") as string) || undefined;
      auditorName = (formData.get("auditorName") as string) || auditorName;
      callTitle = (formData.get("callTitle") as string) || `Statutory Audit Consultation - ${clientName}`;
      callDate = (formData.get("callDate") as string) || callDate;
      const durationStr = formData.get("callDurationMinutes") as string;
      if (durationStr) callDurationMinutes = parseInt(durationStr, 10) || 25;

      const manualTranscript = formData.get("transcript") as string;

      if (file && file.size > 0) {
        hasAudio = true;
        audioFileName = (file as any).name || "consultation_recording.webm";
        const mimeType = (file.type || "audio/webm").split(";")[0].trim();
        const buffer = Buffer.from(await file.arrayBuffer());
        const base64Audio = buffer.toString("base64");

        // Transcribe audio using Gemini Multimodal Audio if available
        if (process.env.GEMINI_API_KEY && !isLocalModel()) {
          try {
            const transcriptionRes = await ai.models.generateContent({
              model: CHAT_MODEL,
              contents: [
                {
                  inlineData: {
                    mimeType,
                    data: base64Audio,
                  },
                },
                {
                  text: `You are an expert transcriber for Chartered Accountant and financial audit consultation calls in India.
Transcribe this entire consultation call audio recording into a clear, turn-by-turn dialogue format with timestamps and speaker tags (e.g., "[00:15] Auditor (CA Keerthiga Sri): ...", "[00:45] Client: ...").
Accurately transcribe all financial terminology: Profit, Loss, Revenue, Turnover, Indian Rupees, Lakhs, Crores, Financial Year, FY, Balance Sheet, Form 3CD, CARO 2020, Companies Act 2013, Income Tax Act, depreciation, receivables.
Output ONLY the transcribed dialogue. Do not include introductory notes or commentary.`,
                },
              ],
            });

            transcript = (transcriptionRes.text || "").trim();
          } catch (transcribeErr: any) {
            console.warn("Gemini audio transcription failed:", transcribeErr?.message);
            transcript = manualTranscript || "";
          }
        } else {
          transcript = manualTranscript || "";
        }
      }

      // If no audio transcription succeeded and no manual transcript was provided
      if (!transcript && manualTranscript) {
        transcript = manualTranscript;
      }

      if (!transcript) {
        return apiError(
          "No transcript could be obtained from the audio file. Please provide audio with clear speech or paste the consultation transcript text directly.",
          400
        );
      }
    } else {
      // 2. Handle JSON payload
      const json = await req.json();
      transcript = (json.transcript || "").trim();
      clientName = json.clientName || clientName;
      clientId = json.clientId || undefined;
      auditorName = json.auditorName || auditorName;
      callTitle = json.callTitle || `Statutory Audit Consultation - ${clientName}`;
      callDate = json.callDate || callDate;
      callDurationMinutes = Number(json.callDurationMinutes) || 25;
      audioFileName = json.audioFileName || undefined;
      hasAudio = Boolean(json.hasAudio);

      if (!transcript) {
        return apiError("Missing 'transcript' in request body.", 400);
      }
    }

    // Run deep ICAI audit evaluation
    const evaluation: CallAuditEvaluation = await evaluateCallTranscript({
      transcript,
      clientName,
      clientId,
      auditorName,
      callTitle,
      callDate,
      callDurationMinutes,
      audioFileName,
      hasAudio,
    });

    // Save in memory store
    memoryStore.saveCallAudit(evaluation);

    // Save in Supabase if configured
    if (isSupabaseConfigured()) {
      try {
        await supabase.from("call_audits").upsert({
          id: evaluation.id,
          client_id: evaluation.clientId || null,
          client_name: evaluation.clientName,
          auditor_name: evaluation.auditorName,
          call_title: evaluation.callTitle,
          call_date: evaluation.callDate,
          call_duration_minutes: evaluation.callDurationMinutes,
          audio_file_name: evaluation.audioFileName || null,
          has_audio: evaluation.hasAudio,
          overall_score: evaluation.overallScore,
          grade: evaluation.grade,
          compliance_status: evaluation.complianceStatus,
          executive_summary: evaluation.executiveSummary,
          transcript: evaluation.transcript,
          dimensions: evaluation.dimensions,
          strengths: evaluation.strengths,
          critical_risks: evaluation.criticalRisks,
          improvement_recommendations: evaluation.improvementRecommendations,
          moments: evaluation.moments,
          action_items: evaluation.actionItems,
          ca_partner_sign_off: evaluation.caPartnerSignOff,
        });
      } catch (sbErr) {
        console.warn("Failed to persist evaluated audit to Supabase:", sbErr);
      }
    }

    return apiResponse({
      success: true,
      evaluation,
      message: `Call audit evaluation completed successfully for ${clientName}. Grade: ${evaluation.grade} (${evaluation.overallScore}/100)`,
    });
  } catch (err: any) {
    console.error("[api/call-audit/evaluate] Error:", err);
    return apiError(err?.message || "Failed to evaluate call consultation", 500);
  }
}
