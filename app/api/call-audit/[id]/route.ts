import { NextRequest } from "next/server";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { memoryStore } from "@/lib/memory-store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    if (!id) return apiError("Missing audit ID", 400);

    let audit = memoryStore.getCallAuditById(id);

    if (!audit && isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from("call_audits")
          .select("*")
          .eq("id", id)
          .single();

        if (!error && data) {
          audit = {
            id: data.id,
            createdAt: data.created_at,
            clientName: data.client_name,
            clientId: data.client_id,
            auditorName: data.auditor_name,
            callTitle: data.call_title,
            callDate: data.call_date,
            callDurationMinutes: data.call_duration_minutes,
            audioFileName: data.audio_file_name,
            hasAudio: data.has_audio,
            transcript: data.transcript,
            overallScore: data.overall_score,
            grade: data.grade,
            complianceStatus: data.compliance_status,
            executiveSummary: data.executive_summary,
            dimensions: data.dimensions || [],
            strengths: data.strengths || [],
            criticalRisks: data.critical_risks || [],
            improvementRecommendations: data.improvement_recommendations || [],
            moments: data.moments || [],
            actionItems: data.action_items || [],
            caPartnerSignOff: data.ca_partner_sign_off || {},
          };
        }
      } catch (sbErr) {
        console.warn("Supabase single call_audit fetch error:", sbErr);
      }
    }

    if (!audit) {
      return apiError(`Call audit with ID '${id}' not found`, 404);
    }

    return apiResponse({
      success: true,
      audit,
    });
  } catch (err: any) {
    console.error("[api/call-audit/[id]] Error:", err);
    return apiError(err?.message || "Failed to fetch call audit", 500);
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const id = params.id;
    if (!id) return apiError("Missing audit ID", 400);

    const deletedFromMemory = memoryStore.deleteCallAudit(id);

    if (isSupabaseConfigured()) {
      try {
        await supabase.from("call_audits").delete().eq("id", id);
      } catch (sbErr) {
        console.warn("Failed to delete call audit from Supabase:", sbErr);
      }
    }

    return apiResponse({
      success: true,
      deletedId: id,
      message: "Call audit deleted successfully",
    });
  } catch (err: any) {
    console.error("[api/call-audit/[id] DELETE] Error:", err);
    return apiError(err?.message || "Failed to delete call audit", 500);
  }
}
