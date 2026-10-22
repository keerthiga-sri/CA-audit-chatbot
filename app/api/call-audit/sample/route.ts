import { NextRequest } from "next/server";
import { apiResponse, handleCorsPreflight } from "@/lib/cors";
import { SAMPLE_CONSULTATION_CALLS, DEFAULT_CA_RUBRIC } from "@/lib/call-audit";

export const runtime = "nodejs";

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(_req: NextRequest) {
  return apiResponse({
    success: true,
    samples: SAMPLE_CONSULTATION_CALLS,
    rubric: DEFAULT_CA_RUBRIC,
  });
}
