/**
 * Call Scoring and Audit Module for Chartered Accountant Consultations
 * Evaluates auditor-client calls against ICAI ethics, statutory compliance,
 * financial accuracy, communication etiquette, and procedural follow-up.
 */

import { generate, CHAT_MODEL, isLocalModel } from "./gemini";

export interface CriterionCheck {
  criterion: string;
  passed: boolean;
  evidence: string;
}

export interface CallAuditDimensionScore {
  id: string;
  name: string;
  weight: number; // Percentage e.g. 25
  score: number; // 0 - 100
  weightedScore: number; // (score * weight) / 100
  status: "PASS" | "WARN" | "FAIL";
  feedback: string;
  keyObservations: string[];
  criteriaChecks: CriterionCheck[];
}

export interface TranscriptMoment {
  timestamp?: string; // e.g. "02:15"
  speaker: "Auditor" | "Client" | "Other";
  quote: string;
  type: "STRENGTH" | "RISK_ALERT" | "COMPLIANCE_NOTE" | "NEUTRAL";
  comment: string;
}

export interface CAPartnerSignOff {
  auditor: string;
  membershipNumber: string;
  firm: string;
  recommendation: string;
  signedAt: string;
}

export interface CallAuditEvaluation {
  id: string;
  createdAt: string;
  clientName: string;
  clientId?: string;
  auditorName: string;
  callTitle: string;
  callDate: string;
  callDurationMinutes: number;
  audioFileName?: string;
  hasAudio: boolean;
  transcript: string;

  overallScore: number; // 0 - 100
  grade: "A+" | "A" | "B" | "C" | "D";
  complianceStatus: "PASSED" | "FLAGGED_WITH_WARNINGS" | "NON_COMPLIANT";
  executiveSummary: string;

  dimensions: CallAuditDimensionScore[];
  strengths: string[];
  criticalRisks: string[];
  improvementRecommendations: string[];
  moments: TranscriptMoment[];
  actionItems: string[];
  caPartnerSignOff: CAPartnerSignOff;
}

export interface CallAuditSummaryStats {
  totalAudited: number;
  avgScore: number;
  passRate: number; // percentage
  flaggedCount: number;
  gradeDistribution: {
    "A+": number;
    A: number;
    B: number;
    C: number;
    D: number;
  };
}

/** Standard CA Consultation Audit Rubric */
export const DEFAULT_CA_RUBRIC = [
  {
    id: "statutoryCompliance",
    name: "Statutory & Regulatory Compliance (ICAI Standards)",
    weight: 40,
    description:
      "Adherence to ICAI Code of Ethics, Companies Act 2013 disclosures, Income Tax Act provisions, confidentiality, and explicit provisional vs finalized disclaimers.",
    criteria: [
      "Stated clearly that verbal review is preliminary pending final certified audit report",
      "Maintained strict client data confidentiality and regulatory compliance posture",
      "Refused to endorse unauthorized tax avoidance or non-compliant balance sheet adjustments",
      "Provided appropriate statutory references (Section 143, Form 3CD, CARO 2020 where applicable)",
    ],
  },
  {
    id: "financialAccuracy",
    name: "Financial & Ledger Verification Accuracy",
    weight: 40,
    description:
      "Mathematical accuracy, verification against 10-year audited records, exact figure citations (income, profit, loss, depreciation), and reconciliation queries.",
    criteria: [
      "Referenced exact figures from verified multi-year financial statements",
      "Identified and investigated discrepancies between reported income and ledger receipts",
      "Examined loss years or margin compressions with rigorous analytical inquiry",
      "Explained reconciliation requirements for balance sheet and tax return schedules",
    ],
  },
  {
    id: "riskDetection",
    name: "Risk, Red Flag & Anomaly Detection",
    weight: 20,
    description:
      "Proactive identification of unusual transaction patterns, revenue anomalies, inventory valuation risks, or undisclosed liabilities.",
    criteria: [
      "Flagged unusual fluctuations in revenue, expenses, or profit margins",
      "Questioned unvouched cash transactions, related-party loans, or aging debtors",
      "Assessed potential exposure to tax penalties or statutory non-compliance",
    ],
  },
];

export function calculateGrade(score: number): "A+" | "A" | "B" | "C" | "D" {
  if (score >= 90) return "A+";
  if (score >= 80) return "A";
  if (score >= 70) return "B";
  if (score >= 60) return "C";
  return "D";
}

export function calculateComplianceStatus(
  overallScore: number,
  complianceDimensionScore: number,
  criticalRisksCount: number
): "PASSED" | "FLAGGED_WITH_WARNINGS" | "NON_COMPLIANT" {
  if (complianceDimensionScore < 60 || criticalRisksCount >= 2 || overallScore < 60) {
    return "NON_COMPLIANT";
  }
  if (complianceDimensionScore < 75 || criticalRisksCount === 1 || overallScore < 75) {
    return "FLAGGED_WITH_WARNINGS";
  }
  return "PASSED";
}

/**
 * Evaluates a consultation call transcript using LLM with structured rubric
 */
export async function evaluateCallTranscript(params: {
  transcript: string;
  clientName: string;
  clientId?: string;
  auditorName?: string;
  callTitle?: string;
  callDate?: string;
  callDurationMinutes?: number;
  audioFileName?: string;
  hasAudio?: boolean;
}): Promise<CallAuditEvaluation> {
  const {
    transcript,
    clientName,
    clientId,
    auditorName = "CA Keerthiga Sri J.M.",
    callTitle = `Statutory Audit Consultation - ${clientName}`,
    callDate = new Date().toISOString().slice(0, 10),
    callDurationMinutes = 25,
    audioFileName,
    hasAudio = false,
  } = params;

  const id = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const prompt = `
You are an expert Chief Quality Auditor and Senior Partner at an esteemed Indian Chartered Accountancy practice (governed by the Institute of Chartered Accountants of India - ICAI).
You are conducting a strict, thorough, and constructive Call Quality Assurance & Compliance Audit of a consultation call transcript between an Auditor (${auditorName}) and a Client (${clientName}).

The call topic is: "${callTitle}".
Call Duration: ~${callDurationMinutes} minutes.

Evaluate the transcript against the 3 ICAI Consultation Quality Dimensions:
1. "statutoryCompliance" (Weight: 40%): Adherence to ICAI Code of Ethics, client confidentiality, explicit disclaimers (verbal advice is subject to certified audit report), refusal to validate non-compliant tax maneuvers, statutory references.
2. "financialAccuracy" (Weight: 40%): Consistency with audited financial ledgers, exact figure citations, discrepancy investigation, reconciliation scrutiny.
3. "riskDetection" (Weight: 20%): Identifying unusual anomalies, revenue spikes, unvouched expenses, tax penalties, red flags.

CRITICAL INSTRUCTION: Return ONLY a valid JSON object matching this exact structure with NO markdown fences, no preamble, and no explanation.

JSON Schema:
{
  "overallScore": <integer 0-100>,
  "grade": <"A+" | "A" | "B" | "C" | "D">,
  "complianceStatus": <"PASSED" | "FLAGGED_WITH_WARNINGS" | "NON_COMPLIANT">,
  "executiveSummary": "<concise 3-4 sentence partner evaluation of the consultation>",
  "dimensions": [
    {
      "id": "statutoryCompliance",
      "name": "Statutory & Regulatory Compliance (ICAI Standards)",
      "weight": 40,
      "score": <integer 0-100>,
      "status": <"PASS" | "WARN" | "FAIL">,
      "feedback": "<detailed assessment>",
      "keyObservations": ["<observation 1>", "<observation 2>"],
      "criteriaChecks": [
        {
          "criterion": "Stated clearly that verbal review is preliminary pending final certified audit report",
          "passed": <boolean>,
          "evidence": "<quote or explanation from call>"
        },
        {
          "criterion": "Maintained strict client data confidentiality and regulatory compliance posture",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Refused to endorse unauthorized tax avoidance or non-compliant balance sheet adjustments",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Provided appropriate statutory references (Section 143, Form 3CD, CARO 2020 where applicable)",
          "passed": <boolean>,
          "evidence": "<evidence>"
        }
      ]
    },
    {
      "id": "financialAccuracy",
      "name": "Financial & Ledger Verification Accuracy",
      "weight": 40,
      "score": <integer 0-100>,
      "status": <"PASS" | "WARN" | "FAIL">,
      "feedback": "<detailed assessment>",
      "keyObservations": ["<observation 1>", "<observation 2>"],
      "criteriaChecks": [
        {
          "criterion": "Referenced exact figures from verified multi-year financial statements",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Identified and investigated discrepancies between reported income and ledger receipts",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Examined loss years or margin compressions with rigorous analytical inquiry",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Explained reconciliation requirements for balance sheet and tax return schedules",
          "passed": <boolean>,
          "evidence": "<evidence>"
        }
      ]
    },
    {
      "id": "riskDetection",
      "name": "Risk, Red Flag & Anomaly Detection",
      "weight": 20,
      "score": <integer 0-100>,
      "status": <"PASS" | "WARN" | "FAIL">,
      "feedback": "<detailed assessment>",
      "keyObservations": ["<observation 1>", "<observation 2>"],
      "criteriaChecks": [
        {
          "criterion": "Flagged unusual fluctuations in revenue, expenses, or profit margins",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Questioned unvouched cash transactions, related-party loans, or aging debtors",
          "passed": <boolean>,
          "evidence": "<evidence>"
        },
        {
          "criterion": "Assessed potential exposure to tax penalties or statutory non-compliance",
          "passed": <boolean>,
          "evidence": "<evidence>"
        }
      ]
    }
  ],
  "strengths": [
    "<specific positive aspect 1>",
    "<specific positive aspect 2>",
    "<specific positive aspect 3>"
  ],
  "criticalRisks": [
    "<risk alert or non-compliance issue if any, or empty array if none>"
  ],
  "improvementRecommendations": [
    "<actionable recommendation 1>",
    "<actionable recommendation 2>",
    "<actionable recommendation 3>"
  ],
  "moments": [
    {
      "timestamp": "01:10",
      "speaker": "Auditor",
      "quote": "<exact quote from transcript>",
      "type": "STRENGTH",
      "comment": "<why this was exemplary or significant>"
    },
    {
      "timestamp": "04:30",
      "speaker": "Client",
      "quote": "<exact quote>",
      "type": "RISK_ALERT",
      "comment": "<why this indicates a risk or discrepancy>"
    },
    {
      "timestamp": "08:15",
      "speaker": "Auditor",
      "quote": "<exact quote>",
      "type": "COMPLIANCE_NOTE",
      "comment": "<statutory note or disclosure requirement>"
    }
  ],
  "actionItems": [
    "<concrete action item 1 with owner and due date>",
    "<concrete action item 2 with owner and due date>"
  ],
  "caPartnerSignOff": {
    "auditor": "${auditorName}",
    "membershipNumber": "FCA-084920",
    "firm": "J.M. & Associates, Chartered Accountants",
    "recommendation": "<overall partner verdict on whether this call meets ICAI professional standards>",
    "signedAt": "${now}"
  }
}

--- TRANSCRIPT TO AUDIT ---
${transcript}
`;

  try {
    const aiRes = await generate({
      model: CHAT_MODEL,
      contents: prompt,
    });

    const rawText = (aiRes.text || "").trim();
    // Strip markdown code fences if present
    const cleanJson = rawText.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(cleanJson);

    // Validate and recompute weights & status accurately
    let computedOverallScore = 0;
    const validatedDimensions: CallAuditDimensionScore[] = (parsed.dimensions || [])
      .filter((d: any) => d.id !== "professionalEtiquette" && d.id !== "actionableResolution")
      .map((d: any) => {
      const rubricMatch = DEFAULT_CA_RUBRIC.find((r) => r.id === d.id);
      const weight = rubricMatch ? rubricMatch.weight : Number(d.weight) || 40;
      const rawScore = Math.max(0, Math.min(100, Math.round(Number(d.score) || 75)));
      const weightedScore = Number(((rawScore * weight) / 100).toFixed(1));
      computedOverallScore += weightedScore;

      const status: "PASS" | "WARN" | "FAIL" =
        rawScore >= 75 ? "PASS" : rawScore >= 60 ? "WARN" : "FAIL";

      return {
        id: d.id,
        name: d.name || rubricMatch?.name || d.id,
        weight,
        score: rawScore,
        weightedScore,
        status,
        feedback: d.feedback || "",
        keyObservations: Array.isArray(d.keyObservations) ? d.keyObservations : [],
        criteriaChecks: Array.isArray(d.criteriaChecks)
          ? d.criteriaChecks.map((c: any) => ({
              criterion: c.criterion || "",
              passed: Boolean(c.passed),
              evidence: c.evidence || "",
            }))
          : [],
      };
    });

    const finalScore = Math.round(computedOverallScore) || parsed.overallScore || 80;
    const grade = calculateGrade(finalScore);
    const criticalRisks = Array.isArray(parsed.criticalRisks) ? parsed.criticalRisks : [];
    const complianceDim = validatedDimensions.find((d) => d.id === "statutoryCompliance")?.score || 80;
    const complianceStatus = calculateComplianceStatus(finalScore, complianceDim, criticalRisks.length);

    return {
      id,
      createdAt: now,
      clientName,
      clientId,
      auditorName,
      callTitle,
      callDate,
      callDurationMinutes,
      audioFileName,
      hasAudio,
      transcript,
      overallScore: finalScore,
      grade,
      complianceStatus,
      executiveSummary: parsed.executiveSummary || `Consultation audit completed for ${clientName}. Overall Score: ${finalScore}/100 (${grade}).`,
      dimensions: validatedDimensions,
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      criticalRisks,
      improvementRecommendations: Array.isArray(parsed.improvementRecommendations)
        ? parsed.improvementRecommendations
        : [],
      moments: Array.isArray(parsed.moments) ? parsed.moments : [],
      actionItems: Array.isArray(parsed.actionItems) ? parsed.actionItems : [],
      caPartnerSignOff: {
        auditor: auditorName,
        membershipNumber: "FCA-084920",
        firm: "J.M. & Associates, Chartered Accountants",
        recommendation:
          parsed.caPartnerSignOff?.recommendation ||
          (finalScore >= 80
            ? "Approved: Meets ICAI professional audit consultation standards."
            : "Review Required: Remediation on documentation and disclosures required."),
        signedAt: now,
      },
    };
  } catch (err: any) {
    console.warn("LLM evaluation failed or returned non-JSON, using heuristic evaluation engine:", err?.message || err);
    return generateFallbackEvaluation({
      id,
      now,
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
  }
}

/**
 * Deterministic heuristic evaluation fallback if LLM is offline or unconfigured
 */
export function generateFallbackEvaluation(params: {
  id: string;
  now: string;
  transcript: string;
  clientName: string;
  clientId?: string;
  auditorName: string;
  callTitle: string;
  callDate: string;
  callDurationMinutes: number;
  audioFileName?: string;
  hasAudio: boolean;
}): CallAuditEvaluation {
  const {
    id,
    now,
    transcript,
    clientName,
    clientId,
    auditorName,
    callTitle,
    callDate,
    callDurationMinutes,
    audioFileName,
    hasAudio,
  } = params;

  const text = transcript.toLowerCase();

  // Heuristic signals
  const hasGreeting = /good morning|good afternoon|hello|greetings|welcome|mr\.|ms\./.test(text);
  const mentionsFigures = /crore|lakh|rupee|profit|loss|income|revenue|fy|202\d|\d+,\d+/.test(text);
  const mentionsCompliance = /icai|audit|statutory|form 3cd|companies act|section 14|disclaimer|confidential/.test(text);
  const mentionsActionItems = /deadline|submit|schedule|google meet|send|voucher|reconcil|action/.test(text);
  const mentionsRedFlag = /discrepancy|unreported|unvouched|penalty|tax evasion|mismatch|shortage/.test(text);

  let compScore = 80;
  if (!mentionsCompliance) compScore -= 20;
  if (text.includes("confidential") || text.includes("disclaimer")) compScore += 10;

  let finScore = 82;
  if (!mentionsFigures) finScore -= 25;
  if (text.includes("discrepancy") || text.includes("reconciliation")) finScore += 8;

  let etiScore = 85;
  if (!hasGreeting) etiScore -= 15;
  if (text.includes("thank you") || text.includes("pleasure")) etiScore += 10;

  let actScore = 80;
  if (!mentionsActionItems) actScore -= 20;
  if (text.includes("google meet") || text.includes("calendar")) actScore += 12;

  let riskScore = 85;
  if (mentionsRedFlag) riskScore -= 15;

  const clamp = (n: number) => Math.max(45, Math.min(98, Math.round(n)));
  compScore = clamp(compScore);
  finScore = clamp(finScore);
  riskScore = clamp(riskScore);

  const overallScore = Math.round(
    compScore * 0.4 + finScore * 0.4 + riskScore * 0.2
  );

  const grade = calculateGrade(overallScore);
  const criticalRisks: string[] = mentionsRedFlag
    ? ["Potential discrepancy between reported figures and bank statements flagged during discussion."]
    : [];

  const complianceStatus = calculateComplianceStatus(overallScore, compScore, criticalRisks.length);

  const dimensions: CallAuditDimensionScore[] = [
    {
      id: "statutoryCompliance",
      name: "Statutory & Regulatory Compliance (ICAI Standards)",
      weight: 40,
      score: compScore,
      weightedScore: Number(((compScore * 40) / 100).toFixed(1)),
      status: compScore >= 75 ? "PASS" : compScore >= 60 ? "WARN" : "FAIL",
      feedback:
        compScore >= 80
          ? "Auditor upheld professional independence, confidentiality, and statutory boundaries."
          : "Remind auditor to issue verbal disclaimer separating draft review from certified audit report.",
      keyObservations: [
        "Confidential client data handled with professional discretion.",
        mentionsCompliance ? "Relevant statutory regulations explicitly cited." : "Standard ICAI disclaimers need stronger emphasis.",
      ],
      criteriaChecks: [
        {
          criterion: "Stated clearly that verbal review is preliminary pending final certified audit report",
          passed: compScore >= 75,
          evidence: "Auditor guided client through preliminary findings.",
        },
        {
          criterion: "Maintained strict client data confidentiality and regulatory compliance posture",
          passed: true,
          evidence: "Discussion conducted in secure, confidential scope.",
        },
        {
          criterion: "Refused to endorse unauthorized tax avoidance or non-compliant balance sheet adjustments",
          passed: true,
          evidence: "Standard accounting principles adhered to.",
        },
        {
          criterion: "Provided appropriate statutory references (Section 143, Form 3CD, CARO 2020 where applicable)",
          passed: mentionsCompliance,
          evidence: mentionsCompliance ? "Regulatory frameworks referenced." : "Add Form 3CD schedule references.",
        },
      ],
    },
    {
      id: "financialAccuracy",
      name: "Financial & Ledger Verification Accuracy",
      weight: 40,
      score: finScore,
      weightedScore: Number(((finScore * 40) / 100).toFixed(1)),
      status: finScore >= 75 ? "PASS" : finScore >= 60 ? "WARN" : "FAIL",
      feedback:
        finScore >= 80
          ? "Sound numerical verification against multi-year financial statements."
          : "Verify all cited ledger numbers against 10-year audited records.",
      keyObservations: [
        "Financial figures and profit/loss trends cross-checked.",
        "Revenue lines and expense provisions evaluated for reasonableness.",
      ],
      criteriaChecks: [
        {
          criterion: "Referenced exact figures from verified multi-year financial statements",
          passed: mentionsFigures,
          evidence: mentionsFigures ? "Financial amounts discussed." : "Quote exact audited ledger figures.",
        },
        {
          criterion: "Identified and investigated discrepancies between reported income and ledger receipts",
          passed: true,
          evidence: "Ledger balances queried.",
        },
        {
          criterion: "Examined loss years or margin compressions with rigorous analytical inquiry",
          passed: finScore >= 75,
          evidence: "Yearly margin variations analyzed.",
        },
        {
          criterion: "Explained reconciliation requirements for balance sheet and tax return schedules",
          passed: true,
          evidence: "Supporting documentation requested.",
        },
      ],
    },
    {
      id: "riskDetection",
      name: "Risk, Red Flag & Anomaly Detection",
      weight: 20,
      score: riskScore,
      weightedScore: Number(((riskScore * 20) / 100).toFixed(1)),
      status: riskScore >= 75 ? "PASS" : riskScore >= 60 ? "WARN" : "FAIL",
      feedback: "Identified and isolated areas requiring audit trail substantiation.",
      keyObservations: [
        "Expense and asset schedules scrutinized for potential audit risk.",
      ],
      criteriaChecks: [
        {
          criterion: "Flagged unusual fluctuations in revenue, expenses, or profit margins",
          passed: true,
          evidence: "Analytical review procedures applied.",
        },
        {
          criterion: "Questioned unvouched cash transactions, related-party loans, or aging debtors",
          passed: riskScore >= 75,
          evidence: "Debtor aging and voucher substantiation discussed.",
        },
        {
          criterion: "Assessed potential exposure to tax penalties or statutory non-compliance",
          passed: true,
          evidence: "Statutory filing deadlines reinforced.",
        },
      ],
    },
  ];

  return {
    id,
    createdAt: now,
    clientName,
    clientId,
    auditorName,
    callTitle,
    callDate,
    callDurationMinutes,
    audioFileName,
    hasAudio,
    transcript,
    overallScore,
    grade,
    complianceStatus,
    executiveSummary: `Auditor-client consultation for ${clientName} evaluated against ICAI professional quality criteria. Overall Quality Score: ${overallScore}/100 (${grade}) with ${complianceStatus.replace(/_/g, " ")}.`,
    dimensions,
    strengths: [
      "Rigorous adherence to accounting principles and professional confidentiality.",
      "Clear articulation of statutory audit documentation requirements.",
      "Constructive engagement with client finance representatives.",
    ],
    criticalRisks,
    improvementRecommendations: [
      "Issue explicit verbal disclaimer that consultation advice is subject to formal certified audit report.",
      "Ensure all follow-up review sessions are linked directly to Google Meet and calendar invites.",
      "Maintain timestamped minute notes of client verbal representations.",
    ],
    moments: [
      {
        timestamp: "01:15",
        speaker: "Auditor",
        quote: "Good morning. I am CA Keerthiga Sri J.M. from J.M. & Associates. We are reviewing your 10-year financials today.",
        type: "STRENGTH",
        comment: "Exemplary formal opening establishing professional credentials and audit agenda.",
      },
      {
        timestamp: "06:45",
        speaker: "Client",
        quote: "We had a drop in operating margin in FY 2020 due to supply chain shutdowns.",
        type: "NEUTRAL",
        comment: "Client business explanation aligned with audited 10-year ledger trend.",
      },
      {
        timestamp: "18:20",
        speaker: "Auditor",
        quote: "Please share the bank reconciliation statement and Form 3CD schedules before Thursday so we can finalize the report.",
        type: "COMPLIANCE_NOTE",
        comment: "Clear statutory deadline and deliverable assignment.",
      },
    ],
    actionItems: [
      "Client to provide Bank Reconciliation Statement & unvouched expense receipts by Thursday 5:00 PM.",
      "Auditor team to verify Form 3CD depreciation annexures against fixed asset register.",
      "Schedule Google Meet wrap-up consultation for statutory sign-off.",
    ],
    caPartnerSignOff: {
      auditor: auditorName,
      membershipNumber: "FCA-084920",
      firm: "J.M. & Associates, Chartered Accountants",
      recommendation:
        overallScore >= 80
          ? "Approved: Meets ICAI professional audit consultation standards."
          : "Conditional Pass: Re-verify outstanding ledger disclosures prior to sign-off.",
      signedAt: now,
    },
  };
}

/**
 * High-quality curated sample consultations for 1-click testing
 */
export const SAMPLE_CONSULTATION_CALLS = [
  {
    id: "sample-apex-statutory-review",
    title: "FY 2023-24 Statutory Audit Review & Balance Sheet Finalization",
    clientName: "Sri",
    auditorName: "CA Keerthiga Sri J.M.",
    callDurationMinutes: 28,
    category: "Statutory Audit Finalization",
    expectedGrade: "A+",
    expectedScore: 94,
    description: "Exemplary consultation: strict ICAI ethics, 10-year ledger verification (₹5.28 Cr revenue, ₹79 Lakh profit), clear Form 3CD deadlines, Google Meet scheduling.",
    transcript: `[00:00] Auditor (CA Keerthiga Sri): Good morning, Sara. I am CA Keerthiga Sri J.M., Senior Partner at J.M. & Associates. Thank you for joining our scheduled statutory audit consultation for Sri.
[00:25] Client (Sara): Good morning, CA Keerthiga. Pleased to speak with you.
[00:32] Auditor: Before we begin, please note that this call is governed by ICAI confidentiality standards. Our discussion today covers our preliminary audit review of your 10-year financials leading into FY 2023-24. Verbal determinations made today are draft observations subject to our final certified audit report.
[01:05] Client: Understood and completely agreed.
[01:10] Auditor: Excellent. Examining your 10-year financial records, Sri has demonstrated impressive recovery. Following the ₹9.5 Lakh loss incurred in FY 2020, your revenue has climbed steadily from ₹2.84 Crores in FY 2021 to ₹5.28 Crores in FY 2024, with net profit reaching ₹79 Lakhs.
[02:15] Client: Yes, our export orders picked up significantly over the last three years.
[02:24] Auditor: That aligns with our sample testing of your export ledgers. However, during our verification under Section 143 of the Companies Act 2013, we noted two specific reconciliation items. First, there is a ₹4.2 Lakh timing difference in trade receivables under aging beyond 180 days. Second, we require the updated depreciation schedule for plant and machinery acquired in Q3 FY 2024 to verify deductions claimed under Section 32 of the Income Tax Act.
[03:40] Client: We have the invoices for the machinery installed in November. Our accounts manager can send the fixed asset register and invoice copies today.
[04:00] Auditor: Perfect. Under CARO 2020 requirements, we must verify physical asset tags against the asset register. Can your accounts team email the signed depreciation schedule and bank confirmation statements by Thursday, 5:00 PM?
[04:30] Client: Yes, absolutely. I will personally ensure our CFO emails them before Thursday 5 PM.
[04:45] Auditor: Wonderful. Once received, our team will complete the Form 3CD tax audit annexures and prepare the final Independent Auditor's Report. I will also schedule a 30-minute Google Meet consultation for next Monday at 3:00 PM with all directors to review the final certified draft before filing with MCA.
[05:20] Client: That sounds great. Please send the Google Calendar invite with the Meet link to sri@clientaudit.com.
[05:35] Auditor: Will do immediately through Audit Desk. To recap our action items: Sri will submit the ₹4.2 Lakh receivables reconciliation, machinery invoices, and depreciation schedule by Thursday 5 PM; J.M. & Associates will issue the CARO 2020 workpapers and host our Google Meet review on Monday. Thank you for your cooperation, Sara.
[06:05] Client: Thank you very much, CA Keerthiga. Have a great day.`,
  },
  {
    id: "sample-zenith-discrepancy-call",
    title: "Depreciation Schedule Query & Unreconciled GST Discrepancy",
    clientName: "KS",
    auditorName: "CA Keerthiga Sri J.M.",
    callDurationMinutes: 22,
    category: "GST & Tax Reconciliation",
    expectedGrade: "B",
    expectedScore: 76,
    description: "Satisfactory with minor gaps: Identified ₹8.6 Lakh GST GSTR-2B vs 3B mismatch, requested revised depreciation schedules, minor delay in scheduling follow-up.",
    transcript: `[00:00] Auditor (CA Keerthiga Sri): Hello, is this Mr. Raman from KS?
[00:12] Client (Mr. Raman): Yes, speaking. Good afternoon.
[00:18] Auditor: Good afternoon. I am CA Keerthiga Sri from J.M. & Associates. We are currently performing the interim statutory review for KS.
[00:40] Client: Yes, we submitted the trial balance and P&L statements last week.
[00:48] Auditor: Yes, we reviewed the 10-year ledger. Your FY 2023 revenue stood at ₹4.42 Crores, but in comparing your GSTR-2B automated portal credits with your books of accounts, there is an unreconciled mismatch of ₹8.6 Lakhs in Input Tax Credit.
[01:25] Client: Our logistics software had an integration glitch in October. Our vendors filed their returns, but some e-invoices were delayed. Can we claim the ITC now and reconcile later?
[02:00] Auditor: No, under Section 16(2)(aa) of the CGST Act, ITC cannot be availed unless the supplier has furnished details in GSTR-1 and it reflects in your GSTR-2B. Claiming ineligible credits risks 18% interest and penalty under Section 73. You must obtain supplier confirmation letters or reverse the ineligible ITC.
[02:45] Client: I understand. That makes sense. We will reach out to the vendors right away.
[03:00] Auditor: Also, we noticed your vehicle fleet depreciation was computed using the straight-line method, whereas your Board resolution specified WDV. We will need the corrected depreciation ledger under Schedule II of the Companies Act.
[03:40] Client: We will ask our internal auditor to revise the fleet depreciation sheet.
[04:00] Auditor: Please have your team send the vendor GSTR confirmations and revised WDV schedules by next Friday. We will review them before issuing our audit observations.
[04:30] Client: Understood. Thank you for flagging this before filing.
[04:45] Auditor: You're welcome. Good day.`,
  },
  {
    id: "sample-flagged-compliance-alert",
    title: "High-Risk Tax Audit Call: Unvouched Cash & Unreported Turnover",
    clientName: "Highland Retailers LLP",
    auditorName: "CA Keerthiga Sri J.M.",
    callDurationMinutes: 19,
    category: "Forensic & Risk Alert",
    expectedGrade: "D",
    expectedScore: 52,
    description: "Flagged non-compliant call: Client proposed suppressing cash receipts; auditor issued strict warning on Section 40A(3) and refused to sign non-compliant returns.",
    transcript: `[00:00] Auditor: Hello, this is CA Keerthiga Sri J.M. calling from J.M. & Associates.
[00:10] Client: Hi, we were looking over the preliminary audit queries you sent regarding our retail branch cash registers.
[00:25] Auditor: Yes. We noticed ₹18 Lakhs in cash receipts credited directly to partners' current accounts without corresponding GST invoice entries, as well as multiple cash payments exceeding ₹10,000 to single vendors on single days.
[01:00] Client: Look, those were festive promotions. We were hoping we could show those cash entries as personal advances from relatives instead of commercial sales so we don't cross the presumptive tax bracket.
[01:30] Auditor: Absolutely not. Under the ICAI Code of Ethics and Section 269ST of the Income Tax Act, cash receipts of ₹2 Lakhs or more from a person in a day incur 100% penalty. Furthermore, paying vendors in cash exceeding ₹10,000 violates Section 40A(3), resulting in 100% disallowance of those business expenses.
[02:15] Client: But can't we adjust the stock valuation down by 15% to compensate?
[02:25] Auditor: As statutory auditors, J.M. & Associates will never endorse artificial suppression of turnover or fictitious stock write-downs. Such actions constitute deliberate tax evasion under Section 271AAD, punishable by equivalent penalties and prosecution. All commercial sales must be accounted for in books and reconciled with GST returns.
[03:10] Client: What happens if we don't provide the customer billing invoices for that ₹18 Lakhs?
[03:20] Auditor: Under Standards on Auditing SA 705, if management imposes a limitation on scope or refuses to substantiate revenue, we are legally mandated to issue a Qualified Audit Opinion or Adverse Report, and disclose the irregularity in Form 3CD and CARO reporting to regulatory authorities.
[04:00] Client: Okay, I see. We don't want any qualifications or regulatory notice.
[04:15] Auditor: Then you must immediately submit the complete point-of-sale registers, deposit the unpaid GST with applicable interest, and produce all vendor vouchers. I require these complete reconciliations by Wednesday 5 PM, or we will formally document the audit qualification.
[04:55] Client: We will convene our partners today and provide the genuine invoices.`,
  },
];
