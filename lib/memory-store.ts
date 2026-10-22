/**
 * Centralized in-memory fallback store for Clients, Financials, and Chunks
 * Used when Supabase is offline or environment variables are not yet configured on Vercel.
 */

export interface ClientRecord {
  id: string;
  name: string;
  email: string | null;
  created_at: string;
  financialYearsAudited?: number;
  documentChunks?: number;
  hasDocuments?: boolean;
}

export interface FinancialRecord {
  client_id: string;
  year: number;
  income: number | null;
  profit: number | null;
  loss: number | null;
}

export interface ChunkRecord {
  client_id: string;
  content: string;
  embedding: number[] | string;
}

// Pre-seeded with sample clients and 10-year audit history
const memoryClients: ClientRecord[] = [
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

// Sample 10-year financials for Sri (FY 2015 to FY 2024)
const memoryFinancials: FinancialRecord[] = [
  { client_id: "sample-apex-001", year: 2015, income: 12500000, profit: 1420000, loss: 0 },
  { client_id: "sample-apex-001", year: 2016, income: 14800000, profit: 1850000, loss: 0 },
  { client_id: "sample-apex-001", year: 2017, income: 18200000, profit: 2300000, loss: 0 },
  { client_id: "sample-apex-001", year: 2018, income: 21500000, profit: 2750000, loss: 0 },
  { client_id: "sample-apex-001", year: 2019, income: 25800000, profit: 3400000, loss: 0 },
  { client_id: "sample-apex-001", year: 2020, income: 22100000, profit: 0, loss: 950000 },
  { client_id: "sample-apex-001", year: 2021, income: 28400000, profit: 3100000, loss: 0 },
  { client_id: "sample-apex-001", year: 2022, income: 36500000, profit: 4850000, loss: 0 },
  { client_id: "sample-apex-001", year: 2023, income: 44200000, profit: 6200000, loss: 0 },
  { client_id: "sample-apex-001", year: 2024, income: 52800000, profit: 7900000, loss: 0 },
];

const memoryChunks: ChunkRecord[] = [];

export const memoryStore = {
  getClients(): ClientRecord[] {
    return memoryClients;
  },

  findClient(idOrName: string): ClientRecord | undefined {
    const clean = idOrName.trim().toLowerCase();
    return memoryClients.find(
      (c) => c.id === idOrName || c.name.toLowerCase() === clean || c.name.toLowerCase().includes(clean)
    );
  },

  addClient(name: string, email: string | null = null): ClientRecord {
    const existing = this.findClient(name);
    if (existing) return existing;

    const newClient: ClientRecord = {
      id: `client-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: name.trim(),
      email: email ? email.trim() : null,
      created_at: new Date().toISOString(),
      financialYearsAudited: 0,
      documentChunks: 0,
      hasDocuments: false,
    };
    memoryClients.unshift(newClient);
    return newClient;
  },

  getFinancials(clientId: string): FinancialRecord[] {
    return memoryFinancials
      .filter((f) => f.client_id === clientId)
      .sort((a, b) => a.year - b.year);
  },

  saveFinancials(
    clientId: string,
    rows: Array<{ year: number; income?: number | null; profit?: number | null; loss?: number | null }>
  ): void {
    // Remove existing
    for (let i = memoryFinancials.length - 1; i >= 0; i--) {
      if (memoryFinancials[i].client_id === clientId) {
        memoryFinancials.splice(i, 1);
      }
    }
    // Add new
    for (const r of rows) {
      memoryFinancials.push({
        client_id: clientId,
        year: r.year,
        income: r.income ?? null,
        profit: r.profit ?? null,
        loss: r.loss ?? null,
      });
    }

    const client = memoryClients.find((c) => c.id === clientId);
    if (client) {
      client.financialYearsAudited = rows.length;
      client.hasDocuments = rows.length > 0;
    }
  },

  saveChunks(clientId: string, chunks: Array<{ content: string; embedding: number[] | string }>): void {
    for (let i = memoryChunks.length - 1; i >= 0; i--) {
      if (memoryChunks[i].client_id === clientId) {
        memoryChunks.splice(i, 1);
      }
    }
    for (const c of chunks) {
      memoryChunks.push({
        client_id: clientId,
        content: c.content,
        embedding: c.embedding,
      });
    }

    const client = memoryClients.find((c) => c.id === clientId);
    if (client) {
      client.documentChunks = chunks.length;
      client.hasDocuments = chunks.length > 0;
    }
  },

  getChunks(clientId: string): ChunkRecord[] {
    return memoryChunks.filter((c) => c.client_id === clientId);
  },

  getCallAudits(filter?: { clientName?: string; grade?: string; status?: string; query?: string }): any[] {
    let list = [...memoryCallAudits];
    if (filter?.clientName) {
      const cn = filter.clientName.toLowerCase();
      list = list.filter((a) => a.clientName.toLowerCase().includes(cn));
    }
    if (filter?.grade) {
      list = list.filter((a) => a.grade === filter.grade);
    }
    if (filter?.status) {
      list = list.filter((a) => a.complianceStatus === filter.status);
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      list = list.filter(
        (a) =>
          a.callTitle.toLowerCase().includes(q) ||
          a.clientName.toLowerCase().includes(q) ||
          a.auditorName.toLowerCase().includes(q) ||
          a.executiveSummary.toLowerCase().includes(q)
      );
    }
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  },

  getCallAuditById(id: string): any | undefined {
    return memoryCallAudits.find((a) => a.id === id);
  },

  saveCallAudit(audit: any): any {
    const existingIdx = memoryCallAudits.findIndex((a) => a.id === audit.id);
    if (existingIdx >= 0) {
      memoryCallAudits[existingIdx] = audit;
    } else {
      memoryCallAudits.unshift(audit);
    }
    return audit;
  },

  deleteCallAudit(id: string): boolean {
    const idx = memoryCallAudits.findIndex((a) => a.id === id);
    if (idx >= 0) {
      memoryCallAudits.splice(idx, 1);
      return true;
    }
    return false;
  },

  getCallAuditStats(): {
    totalAudited: number;
    avgScore: number;
    passRate: number;
    flaggedCount: number;
    gradeDistribution: { "A+": number; A: number; B: number; C: number; D: number };
  } {
    const total = memoryCallAudits.length;
    if (total === 0) {
      return {
        totalAudited: 0,
        avgScore: 0,
        passRate: 100,
        flaggedCount: 0,
        gradeDistribution: { "A+": 0, A: 0, B: 0, C: 0, D: 0 },
      };
    }
    const sumScore = memoryCallAudits.reduce((acc, a) => acc + (a.overallScore || 0), 0);
    const avgScore = Number((sumScore / total).toFixed(1));
    const passedCount = memoryCallAudits.filter((a) => a.complianceStatus === "PASSED").length;
    const passRate = Math.round((passedCount / total) * 100);
    const flaggedCount = memoryCallAudits.filter((a) => a.complianceStatus !== "PASSED").length;

    const gradeDistribution: { "A+": number; A: number; B: number; C: number; D: number } = {
      "A+": 0,
      A: 0,
      B: 0,
      C: 0,
      D: 0,
    };
    for (const a of memoryCallAudits) {
      if (a.grade && gradeDistribution[a.grade as keyof typeof gradeDistribution] !== undefined) {
        gradeDistribution[a.grade as keyof typeof gradeDistribution]++;
      }
    }

    return {
      totalAudited: total,
      avgScore,
      passRate,
      flaggedCount,
      gradeDistribution,
    };
  },
};

// Pre-seeded with 2 high quality initial call audits
const memoryCallAudits: any[] = [
  {
    id: "audit-apex-seed-001",
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    clientName: "Sri",
    clientId: "sample-apex-001",
    auditorName: "CA Keerthiga Sri J.M.",
    callTitle: "FY 2023-24 Statutory Audit Review & Balance Sheet Finalization",
    callDate: "2026-10-20",
    callDurationMinutes: 28,
    audioFileName: "apex_fy24_statutory_audit.webm",
    hasAudio: true,
    overallScore: 94,
    grade: "A+",
    complianceStatus: "PASSED",
    executiveSummary:
      "Exemplary consultation adherence to ICAI Code of Ethics and Companies Act 2013 standards. CA Keerthiga Sri rigorously verified 10-year ledger trends for client Sri, confirmed FY 2024 revenue (₹5.28 Cr) and profit (₹79 L), and enforced strict Form 3CD submission deadlines with Google Meet scheduling.",
    transcript:
      "[00:00] Auditor (CA Keerthiga Sri): Good morning, Sara. I am CA Keerthiga Sri J.M., Senior Partner at J.M. & Associates. Thank you for joining our scheduled statutory audit consultation for Sri.\n[00:25] Client (Sara): Good morning, CA Keerthiga. Pleased to speak with you.\n[00:32] Auditor: Before we begin, please note that this call is governed by ICAI confidentiality standards. Our discussion today covers our preliminary audit review of your 10-year financials leading into FY 2023-24. Verbal determinations made today are draft observations subject to our final certified audit report.\n[01:05] Client: Understood and completely agreed.\n[01:10] Auditor: Excellent. Examining your 10-year financial records, Sri has demonstrated impressive recovery. Following the ₹9.5 Lakh loss incurred in FY 2020, your revenue has climbed steadily from ₹2.84 Crores in FY 2021 to ₹5.28 Crores in FY 2024, with net profit reaching ₹79 Lakhs.\n[02:15] Client: Yes, our export orders picked up significantly over the last three years.\n[02:24] Auditor: That aligns with our sample testing of your export ledgers. However, during our verification under Section 143 of the Companies Act 2013, we noted two specific reconciliation items. First, there is a ₹4.2 Lakh timing difference in trade receivables under aging beyond 180 days. Second, we require the updated depreciation schedule for plant and machinery acquired in Q3 FY 2024 to verify deductions claimed under Section 32 of the Income Tax Act.\n[03:40] Client: We have the invoices for the machinery installed in November. Our accounts manager can send the fixed asset register and invoice copies today.\n[04:00] Auditor: Perfect. Under CARO 2020 requirements, we must verify physical asset tags against the asset register. Can your accounts team email the signed depreciation schedule and bank confirmation statements by Thursday, 5:00 PM?\n[04:30] Client: Yes, absolutely. I will personally ensure our CFO emails them before Thursday 5 PM.\n[04:45] Auditor: Wonderful. Once received, our team will complete the Form 3CD tax audit annexures and prepare the final Independent Auditor's Report. I will also schedule a 30-minute Google Meet consultation for next Monday at 3:00 PM with all directors to review the final certified draft before filing with MCA.\n[05:20] Client: That sounds great. Please send the Google Calendar invite with the Meet link to sri@clientaudit.com.\n[05:35] Auditor: Will do immediately through Audit Desk. To recap our action items: Sri will submit the ₹4.2 Lakh receivables reconciliation, machinery invoices, and depreciation schedule by Thursday 5 PM; J.M. & Associates will issue the CARO 2020 workpapers and host our Google Meet review on Monday. Thank you for your cooperation, Sara.\n[06:05] Client: Thank you very much, CA Keerthiga. Have a great day.",
    dimensions: [
      {
        id: "statutoryCompliance",
        name: "Statutory & Regulatory Compliance (ICAI Standards)",
        weight: 40,
        score: 96,
        weightedScore: 38.4,
        status: "PASS",
        feedback: "Flawless disclaimer of draft verbal review vs final certified report. Rigorous citation of Section 143, CARO 2020, and Section 32.",
        keyObservations: [
          "Issued mandatory ICAI verbal disclaimer before discussing figures.",
          "Referenced Section 143 of Companies Act and CARO 2020 asset verification.",
        ],
        criteriaChecks: [
          { criterion: "Stated clearly that verbal review is preliminary pending final certified audit report", passed: true, evidence: "Explicitly articulated in opening minutes." },
          { criterion: "Maintained strict client data confidentiality and regulatory compliance posture", passed: true, evidence: "ICAI confidentiality reiterated." },
          { criterion: "Refused to endorse unauthorized tax avoidance or non-compliant balance sheet adjustments", passed: true, evidence: "Strict adherence to statutory depreciation." },
          { criterion: "Provided appropriate statutory references (Section 143, Form 3CD, CARO 2020 where applicable)", passed: true, evidence: "Section 143, CARO 2020, and Form 3CD cited." }
        ]
      },
      {
        id: "financialAccuracy",
        name: "Financial & Ledger Verification Accuracy",
        weight: 40,
        score: 95,
        weightedScore: 38.0,
        status: "PASS",
        feedback: "Exact match with verified 10-year ledger: ₹9.5L loss in FY 2020, ₹2.84 Cr in FY 2021, and ₹5.28 Cr with ₹79L profit in FY 2024.",
        keyObservations: [
          "Accurately cited 10-year audited trend figures without variance.",
          "Isolated ₹4.2 Lakh aging debtor discrepancy for reconciliation.",
        ],
        criteriaChecks: [
          { criterion: "Referenced exact figures from verified multi-year financial statements", passed: true, evidence: "Figures matched 10-year ledger exactly." },
          { criterion: "Identified and investigated discrepancies between reported income and ledger receipts", passed: true, evidence: "Flagged trade receivables timing difference." },
          { criterion: "Examined loss years or margin compressions with rigorous analytical inquiry", passed: true, evidence: "Analyzed FY 2020 loss recovery trajectory." },
          { criterion: "Explained reconciliation requirements for balance sheet and tax return schedules", passed: true, evidence: "Detailed Form 3CD depreciation requirements." }
        ]
      },
      {
        id: "riskDetection",
        name: "Risk, Red Flag & Anomaly Detection",
        weight: 20,
        score: 90,
        weightedScore: 18.0,
        status: "PASS",
        feedback: "Proactive scrutiny of aged debtors and physical asset tags.",
        keyObservations: [
          "Aged debtors over 180 days tested for expected credit loss.",
          "Machinery additions audited for physical verification under CARO 2020.",
        ],
        criteriaChecks: [
          { criterion: "Flagged unusual fluctuations in revenue, expenses, or profit margins", passed: true, evidence: "Checked export revenue surge." },
          { criterion: "Questioned unvouched cash transactions, related-party loans, or aging debtors", passed: true, evidence: "Investigated 180-day receivables." },
          { criterion: "Assessed potential exposure to tax penalties or statutory non-compliance", passed: true, evidence: "Ensured Section 32 tax compliance." }
        ]
      }
    ],
    strengths: [
      "Rigorous verbal disclaimer establishing draft review scope under ICAI ethical guidelines.",
      "Exact mathematical citation of 10-year ledger figures without deviation.",
      "Clear, actionable deadline established for client team (Thursday 5:00 PM) with scheduled Google Meet.",
    ],
    criticalRisks: [],
    improvementRecommendations: [
      "Continue providing written confirmation of agreed action items via email immediately after call.",
      "Incorporate digital attendance log for audit audit trail records.",
    ],
    moments: [
      {
        timestamp: "00:32",
        speaker: "Auditor",
        quote: "Before we begin, please note that this call is governed by ICAI confidentiality standards. Verbal determinations made today are draft observations subject to our final certified audit report.",
        type: "COMPLIANCE_NOTE",
        comment: "Exemplary adherence to ICAI confidentiality and disclaimer guidelines.",
      },
      {
        timestamp: "01:10",
        speaker: "Auditor",
        quote: "Following the ₹9.5 Lakh loss incurred in FY 2020, your revenue has climbed steadily from ₹2.84 Crores in FY 2021 to ₹5.28 Crores in FY 2024, with net profit reaching ₹79 Lakhs.",
        type: "STRENGTH",
        comment: "Precise financial citation from verified 10-year audited accounts.",
      },
      {
        timestamp: "04:45",
        speaker: "Auditor",
        quote: "I will also schedule a 30-minute Google Meet consultation for next Monday at 3:00 PM with all directors to review the final certified draft before filing with MCA.",
        type: "STRENGTH",
        comment: "Effective consultation continuity and procedural follow-up.",
      }
    ],
    actionItems: [
      "Sri CFO to email ₹4.2 Lakh receivables reconciliation by Thursday 5:00 PM.",
      "Sri Accounts Manager to furnish machinery invoices & fixed asset register for CARO 2020.",
      "J.M. & Associates to issue Google Meet invitation for Monday 3:00 PM sign-off review.",
    ],
    caPartnerSignOff: {
      auditor: "CA Keerthiga Sri J.M.",
      membershipNumber: "FCA-084920",
      firm: "J.M. & Associates, Chartered Accountants",
      recommendation: "Approved: Stellar consultation exhibiting highest ICAI professional compliance standards.",
      signedAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    }
  },
  {
    id: "audit-zenith-seed-002",
    createdAt: new Date(Date.now() - 3600000 * 72).toISOString(),
    clientName: "KS",
    clientId: "sample-zenith-002",
    auditorName: "CA Keerthiga Sri J.M.",
    callTitle: "Depreciation Schedule Query & Unreconciled GST Discrepancy",
    callDate: "2026-10-18",
    callDurationMinutes: 22,
    audioFileName: "zenith_gst_depr_review.webm",
    hasAudio: true,
    overallScore: 82,
    grade: "A",
    complianceStatus: "FLAGGED_WITH_WARNINGS",
    executiveSummary:
      "Satisfactory audit consultation with technical diligence for client KS. Auditor successfully caught an ₹8.6 Lakh GSTR-2B Input Tax Credit mismatch and corrected an unapproved straight-line vehicle depreciation calculation. Minor follow-up required on Google Meet invite scheduling.",
    transcript:
      "[00:00] Auditor (CA Keerthiga Sri): Hello, is this Mr. Raman from KS?\n[00:12] Client (Mr. Raman): Yes, speaking. Good afternoon.\n[00:18] Auditor: Good afternoon. I am CA Keerthiga Sri from J.M. & Associates. We are currently performing the interim statutory review for KS.\n[00:40] Client: Yes, we submitted the trial balance and P&L statements last week.\n[00:48] Auditor: Yes, we reviewed the 10-year ledger. Your FY 2023 revenue stood at ₹4.42 Crores, but in comparing your GSTR-2B automated portal credits with your books of accounts, there is an unreconciled mismatch of ₹8.6 Lakhs in Input Tax Credit.\n[01:25] Client: Our logistics software had an integration glitch in October. Our vendors filed their returns, but some e-invoices were delayed. Can we claim the ITC now and reconcile later?\n[02:00] Auditor: No, under Section 16(2)(aa) of the CGST Act, ITC cannot be availed unless the supplier has furnished details in GSTR-1 and it reflects in your GSTR-2B. Claiming ineligible credits risks 18% interest and penalty under Section 73. You must obtain supplier confirmation letters or reverse the ineligible ITC.\n[02:45] Client: I understand. That makes sense. We will reach out to the vendors right away.\n[03:00] Auditor: Also, we noticed your vehicle fleet depreciation was computed using the straight-line method, whereas your Board resolution specified WDV. We will need the corrected depreciation ledger under Schedule II of the Companies Act.\n[03:40] Client: We will ask our internal auditor to revise the fleet depreciation sheet.\n[04:00] Auditor: Please have your team send the vendor GSTR confirmations and revised WDV schedules by next Friday. We will review them before issuing our audit observations.\n[04:30] Client: Understood. Thank you for flagging this before filing.\n[04:45] Auditor: You're welcome. Good day.",
    dimensions: [
      {
        id: "statutoryCompliance",
        name: "Statutory & Regulatory Compliance (ICAI Standards)",
        weight: 40,
        score: 82,
        weightedScore: 32.8,
        status: "PASS",
        feedback: "Properly stopped client from availing ineligible GST credit under Section 16(2)(aa). Verbal opening disclaimer was somewhat brief.",
        keyObservations: [
          "Correctly cited CGST Section 16(2)(aa) and Section 73 penalty risk.",
          "Enforced Companies Act Schedule II depreciation rules.",
        ],
        criteriaChecks: [
          { criterion: "Stated clearly that verbal review is preliminary pending final certified audit report", passed: false, evidence: "Opening disclaimer omitted; remind auditor to state disclaimer." },
          { criterion: "Maintained strict client data confidentiality and regulatory compliance posture", passed: true, evidence: "Confidentiality maintained." },
          { criterion: "Refused to endorse unauthorized tax avoidance or non-compliant balance sheet adjustments", passed: true, evidence: "Firmly refused to allow unverified ITC claim." },
          { criterion: "Provided appropriate statutory references (Section 143, Form 3CD, CARO 2020 where applicable)", passed: true, evidence: "CGST Section 16 & Schedule II cited." }
        ]
      },
      {
        id: "financialAccuracy",
        name: "Financial & Ledger Verification Accuracy",
        weight: 40,
        score: 85,
        weightedScore: 34.0,
        status: "PASS",
        feedback: "Excellent technical scrutiny detecting ₹8.6 Lakh ITC gap and SLM vs WDV calculation discrepancy.",
        keyObservations: [
          "Identified GST portal vs books mismatch.",
          "Spotted vehicle fleet depreciation method variance.",
        ],
        criteriaChecks: [
          { criterion: "Referenced exact figures from verified multi-year financial statements", passed: true, evidence: "FY 2023 revenue ₹4.42 Cr and ₹8.6L gap cited." },
          { criterion: "Identified and investigated discrepancies between reported income and ledger receipts", passed: true, evidence: "Investigated GSTR-2B gap." },
          { criterion: "Examined loss years or margin compressions with rigorous analytical inquiry", passed: true, evidence: "Reconciled ledger balances." },
          { criterion: "Explained reconciliation requirements for balance sheet and tax return schedules", passed: true, evidence: "Explained GSTR supplier confirmation process." }
        ]
      },
      {
        id: "riskDetection",
        name: "Risk, Red Flag & Anomaly Detection",
        weight: 20,
        score: 75,
        weightedScore: 15.0,
        status: "PASS",
        feedback: "Detected ITC interest liability risk under Section 73.",
        keyObservations: [
          "Identified ₹8.6L potential tax liability risk.",
        ],
        criteriaChecks: [
          { criterion: "Flagged unusual fluctuations in revenue, expenses, or profit margins", passed: true, evidence: "GSTR-2B fluctuation queried." },
          { criterion: "Questioned unvouched cash transactions, related-party loans, or aging debtors", passed: true, evidence: "Unverified vendor credits scrutinized." },
          { criterion: "Assessed potential exposure to tax penalties or statutory non-compliance", passed: true, evidence: "Warned against 18% penalty interest." }
        ]
      }
    ],
    strengths: [
      "Rigorous statutory vigilance refusing premature ITC claims under CGST Act Section 16(2)(aa).",
      "Diligent review of fixed asset schedules detecting SLM vs WDV method divergence.",
    ],
    criticalRisks: [
      "₹8.6 Lakhs unverified Input Tax Credit exposed to 18% statutory penalty under Section 73 if not reconciled.",
    ],
    improvementRecommendations: [
      "Ensure standard ICAI verbal disclaimer is recited in call introduction.",
      "Always schedule a Google Meet follow-up invitation to review reconciliation status.",
    ],
    moments: [
      {
        timestamp: "02:00",
        speaker: "Auditor",
        quote: "No, under Section 16(2)(aa) of the CGST Act, ITC cannot be availed unless the supplier has furnished details in GSTR-1 and it reflects in your GSTR-2B. Claiming ineligible credits risks 18% interest and penalty under Section 73.",
        type: "RISK_ALERT",
        comment: "Critical compliance protection preventing illegal tax credit claim.",
      },
      {
        timestamp: "03:00",
        speaker: "Auditor",
        quote: "We noticed your vehicle fleet depreciation was computed using the straight-line method, whereas your Board resolution specified WDV. We will need the corrected depreciation ledger under Schedule II of the Companies Act.",
        type: "STRENGTH",
        comment: "Detailed verification of board resolutions against accounting ledgers.",
      }
    ],
    actionItems: [
      "KS to obtain GSTR-1 filing acknowledgments from delayed vendors by Friday.",
      "Accounts team to recalculate fleet depreciation under WDV as per Companies Act Schedule II.",
      "Auditor to issue reconciliation memo upon receipt.",
    ],
    caPartnerSignOff: {
      auditor: "CA Keerthiga Sri J.M.",
      membershipNumber: "FCA-084920",
      firm: "J.M. & Associates, Chartered Accountants",
      recommendation: "Conditional Pass: Re-verify vendor GSTR-2B reconciliation before certifying Form 3CD.",
      signedAt: new Date(Date.now() - 3600000 * 72).toISOString(),
    }
  }
];
