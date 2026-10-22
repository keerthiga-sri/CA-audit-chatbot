import { NextRequest } from "next/server";
import { apiResponse, apiError, handleCorsPreflight } from "@/lib/cors";
import { memoryStore } from "@/lib/memory-store";
import { supabase, isSupabaseConfigured } from "@/lib/supabase";

export const runtime = "nodejs";

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const clientName = searchParams.get("clientName") || undefined;
    const grade = searchParams.get("grade") || undefined;
    const status = searchParams.get("status") || undefined;
    const query = searchParams.get("query") || undefined;

    let audits: any[] = [];
    let stats = memoryStore.getCallAuditStats();

    if (isSupabaseConfigured()) {
      try {
        let queryBuilder = supabase
          .from("call_audits")
          .select("*")
          .order("created_at", { ascending: false });

        if (clientName) {
          queryBuilder = queryBuilder.ilike("client_name", `%${clientName}%`);
        }
        if (grade) {
          queryBuilder = queryBuilder.eq("grade", grade);
        }
        if (status) {
          queryBuilder = queryBuilder.eq("compliance_status", status);
        }

        const { data, error } = await queryBuilder;
        if (!error && data && data.length > 0) {
          audits = data.map((row) => ({
            id: row.id,
            createdAt: row.created_at,
            clientName: row.client_name,
            clientId: row.client_id,
            auditorName: row.auditor_name,
            callTitle: row.call_title,
            callDate: row.call_date,
            callDurationMinutes: row.call_duration_minutes,
            audioFileName: row.audio_file_name,
            hasAudio: row.has_audio,
            transcript: row.transcript,
            overallScore: row.overall_score,
            grade: row.grade,
            complianceStatus: row.compliance_status,
            executiveSummary: row.executive_summary,
            dimensions: row.dimensions || [],
            strengths: row.strengths || [],
            criticalRisks: row.critical_risks || [],
            improvementRecommendations: row.improvement_recommendations || [],
            moments: row.moments || [],
            actionItems: row.action_items || [],
            caPartnerSignOff: row.ca_partner_sign_off || {},
          }));

          // Recalculate stats from Supabase records
          const total = audits.length;
          const sum = audits.reduce((acc, a) => acc + (a.overallScore || 0), 0);
          const passed = audits.filter((a) => a.complianceStatus === "PASSED").length;
          const gradeDistribution: { "A+": number; A: number; B: number; C: number; D: number } = {
            "A+": 0,
            A: 0,
            B: 0,
            C: 0,
            D: 0,
          };
          for (const a of audits) {
            if (a.grade && gradeDistribution[a.grade as keyof typeof gradeDistribution] !== undefined) {
              gradeDistribution[a.grade as keyof typeof gradeDistribution]++;
            }
          }
          stats = {
            totalAudited: total,
            avgScore: Number((sum / total).toFixed(1)),
            passRate: Math.round((passed / total) * 100),
            flaggedCount: total - passed,
            gradeDistribution,
          };
        } else {
          audits = memoryStore.getCallAudits({ clientName, grade, status, query });
        }
      } catch (sbErr) {
        console.warn("Supabase call_audits query failed, using memoryStore:", sbErr);
        audits = memoryStore.getCallAudits({ clientName, grade, status, query });
      }
    } else {
      audits = memoryStore.getCallAudits({ clientName, grade, status, query });
    }

    return apiResponse({
      success: true,
      audits,
      stats,
      count: audits.length,
    });
  } catch (err: any) {
    console.error("[api/call-audit] Error:", err);
    return apiError(err?.message || "Failed to fetch call audits", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body || !body.id) {
      return apiError("Missing audit record or ID", 400);
    }

    // Save in memory store
    memoryStore.saveCallAudit(body);

    // Save to Supabase if configured
    if (isSupabaseConfigured()) {
      try {
        await supabase.from("call_audits").upsert({
          id: body.id,
          client_id: body.clientId || null,
          client_name: body.clientName,
          auditor_name: body.auditorName || "CA Keerthiga Sri J.M.",
          call_title: body.callTitle || "Consultation Audit",
          call_date: body.callDate || new Date().toISOString().slice(0, 10),
          call_duration_minutes: body.callDurationMinutes || 20,
          audio_file_name: body.audioFileName || null,
          has_audio: Boolean(body.hasAudio),
          overall_score: body.overallScore,
          grade: body.grade,
          compliance_status: body.complianceStatus,
          executive_summary: body.executiveSummary || "",
          transcript: body.transcript || "",
          dimensions: body.dimensions || [],
          strengths: body.strengths || [],
          critical_risks: body.criticalRisks || [],
          improvement_recommendations: body.improvementRecommendations || [],
          moments: body.moments || [],
          action_items: body.actionItems || [],
          ca_partner_sign_off: body.caPartnerSignOff || {},
        });
      } catch (sbErr) {
        console.warn("Failed to persist call audit to Supabase:", sbErr);
      }
    }

    return apiResponse({
      success: true,
      audit: body,
      message: "Call audit evaluation saved successfully",
    });
  } catch (err: any) {
    console.error("[api/call-audit POST] Error:", err);
    return apiError(err?.message || "Failed to save call audit", 500);
  }
}
