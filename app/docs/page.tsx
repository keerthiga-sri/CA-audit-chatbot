"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface EndpointDef {
  id: string;
  name: string;
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  category: string;
  description: string;
  useCase: string;
  sampleBody?: Record<string, any>;
  sampleQuery?: Record<string, string>;
  samplePathParams?: Record<string, string>;
}

interface ApiKeyItem {
  id: string;
  name: string;
  key: string;
  prefix: string;
  createdAt: string;
  lastUsedAt?: string | null;
  usageCount: number;
  isActive: boolean;
}

const ENDPOINTS: EndpointDef[] = [
  {
    id: "chat",
    name: "Audit Chatbot (RAG + Meetings)",
    method: "POST",
    path: "/api/chat",
    category: "AI & RAG",
    description:
      "Ask questions about a client's 10-year financials or trigger automated Google Meet scheduling and updates. Requires an active API key in 'X-API-Key' or 'Authorization: Bearer <key>'.",
    useCase: "Power external chatbots, customer portals, Telegram/Slack bots, or CRM dashboards.",
    sampleBody: {
      clientName: "Apex Enterprises",
      message: "What was the total profit over the 10 years, and which year had the highest loss?",
    },
  },
  {
    id: "chat-meeting",
    name: "Schedule Google Meet via Chat Prompt",
    method: "POST",
    path: "/api/chat",
    category: "AI & RAG",
    description:
      "Provide a natural language meeting request. The AI will parse the date, time, topic, and attendees, creating a Google Calendar event with a Meet link and notifying participants.",
    useCase: "Book appointments from text or voice assistants without building complex scheduling logic.",
    sampleBody: {
      clientName: "Apex Enterprises",
      message:
        "Schedule a Google Meet about the FY 2024 tax audit tomorrow at 3 PM for 45 minutes with palanitce@gmail.com",
    },
  },
  {
    id: "call-audit-eval",
    name: "Evaluate Consultation Call (Audio or Transcript)",
    method: "POST",
    path: "/api/call-audit/evaluate",
    category: "Call QA & Scoring",
    description:
      "Performs deep compliance and quality scoring on auditor-client consultation calls. Evaluates against ICAI Code of Ethics, Companies Act 2013 Section 143, CARO 2020, numerical ledger consistency, and follow-up discipline. Supports raw text transcripts or audio uploads with automatic Gemini speech-to-text transcription.",
    useCase: "Quality assurance audits, auditor coaching, statutory compliance certification, and client consultation recording evaluations.",
    sampleBody: {
      clientName: "Apex Enterprises Pvt Ltd",
      auditorName: "CA Keerthiga Sri J.M.",
      callTitle: "FY 2023-24 Statutory Audit Review & Balance Sheet Finalization",
      callDate: "2026-10-20",
      callDurationMinutes: 28,
      transcript:
        "[00:00] Auditor (CA Keerthiga Sri): Good morning, Sara. I am CA Keerthiga Sri J.M., Senior Partner at J.M. & Associates. We are reviewing your 10-year financials today under ICAI confidentiality standards.\n[00:40] Client: Good morning. We reviewed the numbers.\n[01:10] Auditor: Your revenue climbed from ₹2.84 Cr in FY 2021 to ₹5.28 Cr in FY 2024 with ₹79L profit. Please submit the receivables reconciliation by Thursday so we can issue the Form 3CD report and hold our final Google Meet on Monday.\n[02:00] Client: Agreed, our accounts manager will send the documents.",
    },
  },
  {
    id: "call-audit-list",
    name: "List Call Audits & QA Metrics",
    method: "GET",
    path: "/api/call-audit",
    category: "Call QA & Scoring",
    description:
      "Fetches the log of evaluated consultation calls, average quality scores, statutory compliance pass rates, risk flags, and grade distributions.",
    useCase: "Populate compliance dashboards, partner oversight portals, and audit committee quality logs.",
    sampleQuery: {
      clientName: "Apex",
      grade: "A+",
    },
  },
  {
    id: "call-audit-samples",
    name: "Get Pre-Loaded Consultation Samples & Rubric",
    method: "GET",
    path: "/api/call-audit/sample",
    category: "Call QA & Scoring",
    description:
      "Returns curated sample consultation calls (Exemplary, Discrepancy Query, Flagged Risk) along with the official 5-dimensional ICAI consultation rubric definition.",
    useCase: "Test scoring pipelines, train auditors, and preview QA benchmarks.",
  },
  {
    id: "ingest-json",
    name: "Ingest Document / Financial Data",
    method: "POST",
    path: "/api/ingest",
    category: "Ingestion",
    description:
      "Upload documents (PDF, Excel, CSV, TXT via multipart/form-data) or send raw CSV/JSON directly. Automatically extracts 10-year figures and creates 768-dim vector embeddings in Supabase.",
    useCase: "Integrate into document management systems, accounting software, or batch audit pipelines.",
    sampleBody: {
      clientName: "Apex Enterprises",
      fileName: "financial_records.csv",
      text: "Year,Income,Profit,Loss\n2020,3500000,500000,0\n2021,4200000,650000,0\n2022,4900000,750000,0\n2023,5600000,880000,0\n2024,6500000,1050000,0",
    },
  },
  {
    id: "keys-list",
    name: "List Generated API Keys",
    method: "GET",
    path: "/api/keys",
    category: "API Keys",
    description: "Lists all generated API keys with usage metrics, last used timestamps, and active status.",
    useCase: "Manage external client access and audit API consumption.",
  },
  {
    id: "keys-create",
    name: "Generate New API Key",
    method: "POST",
    path: "/api/keys",
    category: "API Keys",
    description: "Generates a new secure API key with prefix 'ca_live_' and assigns it to a named user/client.",
    useCase: "Issue API keys for new users, client apps, or third-party developers.",
    sampleBody: {
      name: "Partner Accounting Portal",
    },
  },
  {
    id: "keys-toggle",
    name: "Activate / Revoke API Key",
    method: "PATCH",
    path: "/api/keys",
    category: "API Keys",
    description: "Instantly deactivates or reactivates an API key without deleting it.",
    useCase: "Suspend access temporarily or revoke a compromised token.",
    sampleBody: {
      id: "KEY_UUID_HERE",
      isActive: false,
    },
  },
  {
    id: "keys-delete",
    name: "Delete API Key",
    method: "DELETE",
    path: "/api/keys",
    category: "API Keys",
    description: "Permanently removes an API key from the database.",
    useCase: "Offboard integrations and remove inactive keys.",
    sampleQuery: { id: "KEY_UUID_HERE" },
  },
  {
    id: "clients-list",
    name: "List All Clients",
    method: "GET",
    path: "/api/clients",
    category: "Clients",
    description:
      "Fetches all registered audit clients with optional financial years count and indexing status.",
    useCase: "Populate client dropdowns, directories, or auditor dashboards.",
    sampleQuery: { stats: "true" },
  },
  {
    id: "clients-create",
    name: "Register New Client",
    method: "POST",
    path: "/api/clients",
    category: "Clients",
    description: "Registers a client in the audit registry with optional primary email address.",
    useCase: "Onboard new business entities or clients from your CRM.",
    sampleBody: {
      name: "Zenith Retail Corp",
      email: "finance@zenithretail.com",
    },
  },
  {
    id: "clients-get",
    name: "Get Client Profile & Stats",
    method: "GET",
    path: "/api/clients/:id",
    category: "Clients",
    description:
      "Retrieves single client metadata, verified 10-year financial records, and indexed chunk count.",
    useCase: "Client detail view and audit preparation checks.",
    samplePathParams: { id: "CLIENT_UUID" },
  },
  {
    id: "clients-delete",
    name: "Delete Client & Audit Data",
    method: "DELETE",
    path: "/api/clients/:id",
    category: "Clients",
    description:
      "Cascades deletion of client record, all vector chunks, and all 10-year financial figures.",
    useCase: "Client offboarding or data purge compliance.",
    samplePathParams: { id: "CLIENT_UUID" },
  },
  {
    id: "financials-get",
    name: "Get 10-Year Financial Ledger",
    method: "GET",
    path: "/api/financials",
    category: "Financials",
    description:
      "Returns verified income, profit, and loss figures per financial year, along with computed aggregate metrics (total income, net gain/loss, profit margins).",
    useCase: "Render charts, balance sheets, financial comparison reports.",
    sampleQuery: { clientName: "Apex Enterprises", order: "asc" },
  },
  {
    id: "financials-upsert",
    name: "Upsert Financial Records",
    method: "POST",
    path: "/api/financials",
    category: "Financials",
    description:
      "Programmatically add or update financial year entries for a client.",
    useCase: "Sync with ERP or Tally/QuickBooks accounting ledgers.",
    sampleBody: {
      clientName: "Apex Enterprises",
      records: [
        { year: 2024, income: 6500000, profit: 1050000, loss: 0 },
        { year: 2023, income: 5600000, profit: 880000, loss: 0 },
      ],
    },
  },
  {
    id: "calendar-sync",
    name: "Schedule / Update Google Meet",
    method: "POST",
    path: "/api/calendar/sync",
    category: "Calendar & Meet",
    description:
      "Directly schedules or modifies a Google Meet consultation in Google Calendar with participant emails and return links.",
    useCase: "Programmatic meeting creation and synchronization.",
    sampleBody: {
      topic: "10-Year Statutory Audit Review",
      start: "2026-10-10T14:30:00",
      durationMinutes: 45,
      attendees: ["client@apex.com", "palanitce@gmail.com"],
      action: "create",
    },
  },
  {
    id: "calendar-query",
    name: "Query Upcoming Consultations",
    method: "GET",
    path: "/api/calendar/sync",
    category: "Calendar & Meet",
    description: "Searches upcoming or most recent scheduled Google Calendar events.",
    useCase: "Calendar widget or appointment countdown display.",
    sampleQuery: { q: "Audit" },
  },
  {
    id: "email-send",
    name: "Send Calendar Invite Email",
    method: "POST",
    path: "/api/email/send",
    category: "Email & Dispatch",
    description:
      "Sends branded HTML email with RFC 5545 iCalendar (.ics) invite attachment directly to attendees.",
    useCase: "Automated client email reminders and calendar invitations.",
    sampleBody: {
      topic: "CA Audit Consultation",
      start: "2026-10-10T14:30:00",
      durationMinutes: 45,
      meetLink: "https://meet.google.com/new",
      attendees: ["client@apex.com"],
    },
  },
  {
    id: "health",
    name: "System Health & Uptime",
    method: "GET",
    path: "/api/health",
    category: "Health & Ops",
    description: "Returns API status, database latency, active model provider, and registered clients.",
    useCase: "Docker / Kubernetes liveness probes and uptime monitors.",
  },
  {
    id: "discovery",
    name: "API Service Discovery",
    method: "GET",
    path: "/api",
    category: "Health & Ops",
    description: "Root metadata endpoint listing server config, active auditor profile, and endpoint map.",
    useCase: "Automatic API exploration and configuration verification.",
  },
];

export default function ApiDocsPage() {
  const [currentView, setCurrentView] = useState<"explorer" | "keys">("explorer");
  const [selectedEndpoint, setSelectedEndpoint] = useState<EndpointDef>(ENDPOINTS[0]);
  const [baseUrl, setBaseUrl] = useState("http://localhost:3000");
  const [apiKey, setApiKey] = useState("");
  const [activeTab, setActiveTab] = useState<"curl" | "fetch" | "python" | "tester">("tester");
  const [requestBodyText, setRequestBodyText] = useState("");
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [pathParamId, setPathParamId] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);

  // API Tester States
  const [testLoading, setTestLoading] = useState(false);
  const [testStatus, setTestStatus] = useState<number | null>(null);
  const [testResponse, setTestResponse] = useState<any>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // API Key Management States
  const [keysList, setKeysList] = useState<ApiKeyItem[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<string | null>(null);
  const [creatingKey, setCreatingKey] = useState(false);
  const [copiedKeyText, setCopiedKeyText] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setBaseUrl(window.location.origin);
    }
    loadKeys();
  }, []);

  async function loadKeys() {
    setKeysLoading(true);
    try {
      const res = await fetch("/api/keys");
      const d = await res.json();
      if (d?.keys) {
        setKeysList(d.keys);
        // Pre-fill active key in tester if empty
        const firstActive = d.keys.find((k: ApiKeyItem) => k.isActive);
        if (firstActive && !apiKey) {
          // Keep empty or let user choose
        }
      }
    } catch (e) {
      console.warn("Failed to load keys:", e);
    } finally {
      setKeysLoading(false);
    }
  }

  async function handleCreateKey() {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await fetch("/api/keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      const data = await res.json();
      if (res.ok && data?.key) {
        setNewlyCreatedKey(data.key);
        setApiKey(data.key); // Automatically set in tester!
        setNewKeyName("");
        loadKeys();
      }
    } catch (e) {
      console.error("Failed to generate key:", e);
    } finally {
      setCreatingKey(false);
    }
  }

  async function handleToggleKey(id: string, currentActive: boolean) {
    try {
      await fetch("/api/keys", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, isActive: !currentActive }),
      });
      loadKeys();
    } catch (e) {
      console.error("Failed to toggle key:", e);
    }
  }

  async function handleDeleteKey(id: string) {
    if (!confirm("Are you sure you want to permanently delete this API key? External apps using this key will be blocked immediately.")) return;
    try {
      await fetch(`/api/keys?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      loadKeys();
    } catch (e) {
      console.error("Failed to delete key:", e);
    }
  }

  useEffect(() => {
    setRequestBodyText(
      selectedEndpoint.sampleBody
        ? JSON.stringify(selectedEndpoint.sampleBody, null, 2)
        : ""
    );
    setQueryParams(selectedEndpoint.sampleQuery || {});
    setPathParamId(selectedEndpoint.samplePathParams?.id || "");
    setTestStatus(null);
    setTestResponse(null);
    setTestError(null);
  }, [selectedEndpoint]);

  const resolvedPath = () => {
    let p = selectedEndpoint.path;
    if (p.includes(":id")) {
      p = p.replace(":id", pathParamId || "CLIENT_UUID");
    }
    const qKeys = Object.keys(queryParams);
    if (qKeys.length > 0) {
      const sp = new URLSearchParams();
      qKeys.forEach((k) => {
        if (queryParams[k]) sp.set(k, queryParams[k]);
      });
      const qStr = sp.toString();
      if (qStr) p += `?${qStr}`;
    }
    return p;
  };

  const fullUrl = `${baseUrl}${resolvedPath()}`;

  const generateCurl = () => {
    let cmd = `curl -X ${selectedEndpoint.method} "${fullUrl}"`;
    const keyToUse = apiKey || "ca_live_your_api_key_here";
    cmd += ` \\\n  -H "X-API-Key: ${keyToUse}"`;
    if (selectedEndpoint.method !== "GET" && requestBodyText) {
      cmd += ` \\\n  -H "Content-Type: application/json"`;
      cmd += ` \\\n  -d '${requestBodyText.replace(/'/g, "\\'")}'`;
    }
    return cmd;
  };

  const generateFetch = () => {
    const keyToUse = apiKey || "ca_live_your_api_key_here";
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-API-Key": keyToUse,
    };
    if (selectedEndpoint.method !== "GET" && requestBodyText) {
      headers["Content-Type"] = "application/json";
    }

    const options: any = {
      method: selectedEndpoint.method,
      headers,
    };
    if (selectedEndpoint.method !== "GET" && requestBodyText) {
      options.body = requestBodyText;
    }

    return `fetch("${fullUrl}", ${JSON.stringify(options, null, 2)})
  .then(res => res.json())
  .then(data => console.log(data))
  .catch(err => console.error(err));`;
  };

  const generatePython = () => {
    const keyToUse = apiKey || "ca_live_your_api_key_here";
    let code = `import requests\n\n`;
    code += `url = "${fullUrl}"\n`;
    code += `headers = {\n    "Accept": "application/json",\n    "X-API-Key": "${keyToUse}"`;
    if (selectedEndpoint.method !== "GET" && requestBodyText) {
      code += `,\n    "Content-Type": "application/json"`;
    }
    code += `\n}\n`;

    if (selectedEndpoint.method !== "GET" && requestBodyText) {
      code += `payload = ${requestBodyText}\n\n`;
      code += `response = requests.${selectedEndpoint.method.toLowerCase()}(url, headers=headers, json=payload)\n`;
    } else {
      code += `\nresponse = requests.${selectedEndpoint.method.toLowerCase()}(url, headers=headers)\n`;
    }

    code += `print("Status:", response.status_code)\nprint(response.json())\n`;
    return code;
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const runTestRequest = async () => {
    setTestLoading(true);
    setTestStatus(null);
    setTestResponse(null);
    setTestError(null);

    try {
      const headers: Record<string, string> = { Accept: "application/json" };
      if (apiKey) headers["X-API-Key"] = apiKey;

      const opts: RequestInit = {
        method: selectedEndpoint.method,
        headers,
      };

      if (selectedEndpoint.method !== "GET" && requestBodyText) {
        headers["Content-Type"] = "application/json";
        opts.body = requestBodyText;
      }

      const res = await fetch(resolvedPath(), opts);
      setTestStatus(res.status);
      const data = await res.json().catch(() => ({ message: "Non-JSON response" }));
      setTestResponse(data);
    } catch (err: any) {
      setTestError(err?.message || "Request failed");
    } finally {
      setTestLoading(false);
    }
  };

  const categories = Array.from(new Set(ENDPOINTS.map((e) => e.category)));

  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#0b0f17", color: "#e2e8f0", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Top Navigation Bar */}
      <header
        style={{
          borderBottom: "1px solid #1e293b",
          backgroundColor: "#0f172a",
          padding: "16px 28px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "14px",
          position: "sticky",
          top: 0,
          zIndex: 50,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
          <div
            style={{
              background: "linear-gradient(135deg, #10b981 0%, #059669 100%)",
              color: "#fff",
              width: "38px",
              height: "38px",
              borderRadius: "10px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: "16px",
              boxShadow: "0 4px 12px rgba(16,185,129,0.3)",
            }}
          >
            API
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h1 style={{ margin: 0, fontSize: "18px", fontWeight: 700, color: "#f8fafc" }}>
                CA Audit Desk API Portal
              </h1>
              <span
                style={{
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  backgroundColor: "#064e3b",
                  color: "#34d399",
                  fontWeight: 600,
                  border: "1px solid #059669",
                }}
              >
                v1.0.0
              </span>
              <span
                style={{
                  fontSize: "11px",
                  padding: "2px 8px",
                  borderRadius: "999px",
                  backgroundColor: "#1e1b4b",
                  color: "#a5b4fc",
                  fontWeight: 600,
                  border: "1px solid #4338ca",
                }}
              >
                Key Auth Active
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "12px", color: "#94a3b8" }}>
              Shareable REST API with Dynamic Key Generation & 10-Year Due Diligence
            </p>
          </div>
        </div>

        {/* View Switcher & Action Buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => setCurrentView("explorer")}
            style={{
              backgroundColor: currentView === "explorer" ? "#10b981" : "#1e293b",
              color: currentView === "explorer" ? "#ffffff" : "#94a3b8",
              border: "1px solid #334155",
              padding: "7px 14px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>⚡</span> API Endpoints
          </button>

          <button
            type="button"
            onClick={() => {
              setCurrentView("keys");
              loadKeys();
            }}
            style={{
              backgroundColor: currentView === "keys" ? "#f59e0b" : "#1e293b",
              color: currentView === "keys" ? "#0f172a" : "#fbbf24",
              border: "1px solid #d97706",
              padding: "7px 14px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 700,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>🔑</span> Manage API Keys ({keysList.filter((k) => k.isActive).length})
          </button>

          <a
            href="/api/postman.json"
            download="ca-audit-api-postman.json"
            target="_blank"
            rel="noreferrer"
            style={{
              backgroundColor: "#ff6c37",
              color: "#ffffff",
              textDecoration: "none",
              padding: "7px 14px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>📮</span> Postman
          </a>

          <Link
            href="/"
            style={{
              backgroundColor: "#334155",
              color: "#ffffff",
              textDecoration: "none",
              padding: "7px 14px",
              borderRadius: "8px",
              fontSize: "12px",
              fontWeight: 600,
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            <span>←</span> Chatbot
          </Link>
        </div>
      </header>

      {/* ========================================================= */}
      {/* VIEW 1: API KEYS MANAGER (Create & Share API Keys)        */}
      {/* ========================================================= */}
      {currentView === "keys" && (
        <div style={{ maxWidth: "1000px", margin: "32px auto", padding: "0 24px" }}>
          {/* Header Card */}
          <div style={{ backgroundColor: "#111827", borderRadius: "14px", border: "1px solid #1f2937", padding: "24px", marginBottom: "24px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "14px" }}>
              <div>
                <h2 style={{ margin: "0 0 8px 0", fontSize: "22px", fontWeight: 700, color: "#f8fafc" }}>
                  🔑 API Key Generator & Access Control
                </h2>
                <p style={{ margin: 0, fontSize: "14px", color: "#94a3b8", lineHeight: 1.5 }}>
                  Create custom API keys to share with external users, client applications, or third-party developers. Users must pass their key in the <code>X-API-Key</code> header to access the CA Audit API.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCurrentView("explorer")}
                style={{
                  backgroundColor: "#1e293b",
                  color: "#38bdf8",
                  border: "1px solid #334155",
                  padding: "8px 14px",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Go to API Tester →
              </button>
            </div>

            {/* Create Key Form */}
            <div style={{ marginTop: "24px", display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <input
                type="text"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                placeholder="e.g. Mobile App Client, Apex Accounting ERP, John's Integration"
                style={{
                  flex: 1,
                  minWidth: "260px",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid #374151",
                  backgroundColor: "#0b0f17",
                  color: "#f8fafc",
                  fontSize: "14px",
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateKey();
                }}
              />
              <button
                type="button"
                onClick={handleCreateKey}
                disabled={creatingKey || !newKeyName.trim()}
                style={{
                  backgroundColor: creatingKey || !newKeyName.trim() ? "#475569" : "#10b981",
                  color: "#ffffff",
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 20px",
                  fontSize: "14px",
                  fontWeight: 700,
                  cursor: creatingKey || !newKeyName.trim() ? "not-allowed" : "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                {creatingKey ? "Generating..." : "+ Create New API Key"}
              </button>
            </div>
          </div>

          {/* Just Generated Key Banner */}
          {newlyCreatedKey && (
            <div
              style={{
                backgroundColor: "#064e3b",
                borderRadius: "14px",
                border: "1px solid #10b981",
                padding: "20px",
                marginBottom: "24px",
                boxShadow: "0 8px 24px rgba(16,185,129,0.2)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#34d399", textTransform: "uppercase" }}>
                  🎉 New API Key Generated Successfully!
                </span>
                <button
                  type="button"
                  onClick={() => setNewlyCreatedKey(null)}
                  style={{ background: "none", border: "none", color: "#a7f3d0", cursor: "pointer", fontSize: "18px" }}
                >
                  ✕
                </button>
              </div>

              <p style={{ margin: "0 0 12px 0", fontSize: "13px", color: "#d1fae5" }}>
                <strong>Save this key now!</strong> Share this exact key with your user or client. They must send it in the <code>X-API-Key</code> request header.
              </p>

              <div style={{ display: "flex", alignItems: "center", gap: "10px", backgroundColor: "#022c22", padding: "12px 16px", borderRadius: "8px", border: "1px solid #059669" }}>
                <code style={{ fontSize: "15px", fontFamily: "monospace", color: "#6ee7b7", wordBreak: "break-all", flex: 1, fontWeight: 700 }}>
                  {newlyCreatedKey}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(newlyCreatedKey);
                    setCopiedKeyText(true);
                    setTimeout(() => setCopiedKeyText(false), 2000);
                  }}
                  style={{
                    backgroundColor: copiedKeyText ? "#34d399" : "#10b981",
                    color: "#0f172a",
                    border: "none",
                    borderRadius: "6px",
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 700,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {copiedKeyText ? "✓ Copied!" : "📋 Copy Key"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setApiKey(newlyCreatedKey);
                    setCurrentView("explorer");
                  }}
                  style={{
                    backgroundColor: "#1e293b",
                    color: "#38bdf8",
                    border: "1px solid #334155",
                    borderRadius: "6px",
                    padding: "8px 14px",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  ⚡ Use in Live Tester
                </button>
              </div>
            </div>
          )}

          {/* Active Keys Table */}
          <div style={{ backgroundColor: "#111827", borderRadius: "14px", border: "1px solid #1f2937", padding: "20px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
              <h3 style={{ margin: 0, fontSize: "16px", fontWeight: 700, color: "#f8fafc" }}>
                Active & Registered API Keys ({keysList.length})
              </h3>
              <button
                type="button"
                onClick={loadKeys}
                style={{ background: "none", border: "none", color: "#38bdf8", cursor: "pointer", fontSize: "12px" }}
              >
                🔄 Refresh Keys
              </button>
            </div>

            {keysLoading ? (
              <div style={{ padding: "30px", textAlign: "center", color: "#94a3b8" }}>Loading API keys...</div>
            ) : keysList.length === 0 ? (
              <div style={{ padding: "30px", textAlign: "center", color: "#64748b" }}>
                No API keys created yet. Generate your first API key above to start sharing access.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "13px" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid #1f2937", color: "#94a3b8" }}>
                      <th style={{ padding: "10px 12px" }}>Key Name & Description</th>
                      <th style={{ padding: "10px 12px" }}>Masked Key Prefix</th>
                      <th style={{ padding: "10px 12px" }}>Total Requests</th>
                      <th style={{ padding: "10px 12px" }}>Last Used</th>
                      <th style={{ padding: "10px 12px" }}>Status</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {keysList.map((k) => (
                      <tr key={k.id} style={{ borderBottom: "1px solid #1e293b", opacity: k.isActive ? 1 : 0.6 }}>
                        <td style={{ padding: "12px", fontWeight: 600, color: "#f8fafc" }}>
                          {k.name}
                        </td>
                        <td style={{ padding: "12px", fontFamily: "monospace", color: "#38bdf8" }}>
                          {k.prefix || k.key}
                        </td>
                        <td style={{ padding: "12px", color: "#cbd5e1" }}>
                          {k.usageCount} calls
                        </td>
                        <td style={{ padding: "12px", color: "#94a3b8", fontSize: "12px" }}>
                          {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleDateString() : "Never"}
                        </td>
                        <td style={{ padding: "12px" }}>
                          <span
                            style={{
                              fontSize: "11px",
                              padding: "3px 8px",
                              borderRadius: "999px",
                              fontWeight: 700,
                              backgroundColor: k.isActive ? "#064e3b" : "#7f1d1d",
                              color: k.isActive ? "#34d399" : "#f87171",
                              border: `1px solid ${k.isActive ? "#059669" : "#dc2626"}`,
                            }}
                          >
                            {k.isActive ? "Active" : "Revoked"}
                          </span>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "6px" }}>
                            <button
                              type="button"
                              onClick={() => {
                                setApiKey(k.key.includes("*") ? k.prefix : k.key);
                                setCurrentView("explorer");
                              }}
                              title="Test with this key in API Console"
                              style={{
                                backgroundColor: "#1e293b",
                                color: "#38bdf8",
                                border: "1px solid #334155",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              ⚡ Test
                            </button>
                            <button
                              type="button"
                              onClick={() => handleToggleKey(k.id, k.isActive)}
                              style={{
                                backgroundColor: k.isActive ? "#78350f" : "#064e3b",
                                color: k.isActive ? "#fde047" : "#34d399",
                                border: "none",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              {k.isActive ? "Revoke" : "Activate"}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteKey(k.id)}
                              style={{
                                backgroundColor: "#450a0a",
                                color: "#f87171",
                                border: "none",
                                borderRadius: "6px",
                                padding: "4px 8px",
                                fontSize: "11px",
                                cursor: "pointer",
                              }}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* User Instructions Box */}
          <div style={{ marginTop: "24px", padding: "18px", backgroundColor: "#0b1528", borderRadius: "12px", border: "1px solid #1d335a" }}>
            <h4 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: 700, color: "#60a5fa" }}>
              📖 How Your Users Can Use Their API Key
            </h4>
            <p style={{ margin: "0 0 8px 0", fontSize: "12px", color: "#cbd5e1", lineHeight: 1.5 }}>
              Provide the user your server URL (or public tunnel URL) and their generated API key. In their application code, they simply attach the header:
            </p>
            <pre style={{ margin: 0, padding: "10px", backgroundColor: "#0b0f17", borderRadius: "6px", color: "#34d399", fontSize: "12px", fontFamily: "monospace" }}>
              X-API-Key: ca_live_your_generated_key_here
            </pre>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* VIEW 2: API EXPLORER & LIVE TESTER                       */}
      {/* ========================================================= */}
      {currentView === "explorer" && (
        <div style={{ display: "flex", minHeight: "calc(100vh - 71px)" }}>
          {/* Left Sidebar: Endpoints Navigation */}
          <nav
            style={{
              width: "310px",
              borderRight: "1px solid #1e293b",
              backgroundColor: "#0d1322",
              padding: "20px 14px",
              overflowY: "auto",
              flexShrink: 0,
            }}
          >
            {/* Target Server & API Key Configuration */}
            <div style={{ marginBottom: "20px", padding: "12px", backgroundColor: "#131b2e", borderRadius: "10px", border: "1px solid #1e293b" }}>
              <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", marginBottom: "4px" }}>
                Target Server URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="http://localhost:3000"
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid #334155",
                  backgroundColor: "#0b0f17",
                  color: "#e2e8f0",
                  fontSize: "12px",
                  fontFamily: "monospace",
                  marginBottom: "8px",
                }}
              />

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                <label style={{ fontSize: "11px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase" }}>
                  Active API Key
                </label>
                <button
                  type="button"
                  onClick={() => setCurrentView("keys")}
                  style={{ background: "none", border: "none", color: "#fbbf24", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}
                >
                  + Generate New
                </button>
              </div>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="ca_live_..."
                style={{
                  width: "100%",
                  padding: "6px 8px",
                  borderRadius: "6px",
                  border: "1px solid #334155",
                  backgroundColor: "#0b0f17",
                  color: "#34d399",
                  fontSize: "12px",
                  fontFamily: "monospace",
                }}
              />
            </div>

            <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#64748b", padding: "0 8px 10px" }}>
              API Endpoints Catalog
            </div>

            {categories.map((cat) => (
              <div key={cat} style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#38bdf8", padding: "4px 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {cat}
                </div>
                {ENDPOINTS.filter((e) => e.category === cat).map((ep) => {
                  const isSelected = selectedEndpoint.id === ep.id;
                  const methodColor =
                    ep.method === "GET"
                      ? "#38bdf8"
                      : ep.method === "POST"
                      ? "#34d399"
                      : ep.method === "DELETE"
                      ? "#f87171"
                      : "#fbbf24";

                  return (
                    <button
                      key={ep.id}
                      onClick={() => setSelectedEndpoint(ep)}
                      style={{
                        width: "100%",
                        textAlign: "left",
                        padding: "8px 10px",
                        borderRadius: "8px",
                        border: isSelected ? "1px solid #3b82f6" : "1px solid transparent",
                        backgroundColor: isSelected ? "#1e293b" : "transparent",
                        color: isSelected ? "#f8fafc" : "#94a3b8",
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        cursor: "pointer",
                        marginBottom: "3px",
                        fontSize: "12px",
                        fontWeight: isSelected ? 600 : 500,
                        transition: "all 0.15s ease",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 800,
                          color: methodColor,
                          padding: "2px 5px",
                          borderRadius: "4px",
                          backgroundColor: "#0f172a",
                          border: `1px solid ${methodColor}40`,
                          fontFamily: "monospace",
                          minWidth: "40px",
                          textAlign: "center",
                        }}
                      >
                        {ep.method}
                      </span>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {ep.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          {/* Right Content Area: Documentation & Live Tester */}
          <main style={{ flex: 1, padding: "28px 36px", overflowY: "auto" }}>
            {/* Endpoint Header Card */}
            <div style={{ backgroundColor: "#111827", borderRadius: "14px", border: "1px solid #1f2937", padding: "24px", marginBottom: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}>
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 800,
                    color:
                      selectedEndpoint.method === "GET"
                        ? "#38bdf8"
                        : selectedEndpoint.method === "POST"
                        ? "#34d399"
                        : selectedEndpoint.method === "DELETE"
                        ? "#f87171"
                        : "#fbbf24",
                    padding: "4px 10px",
                    borderRadius: "6px",
                    backgroundColor: "#1e293b",
                    border: "1px solid #334155",
                    fontFamily: "monospace",
                  }}
                >
                  {selectedEndpoint.method}
                </span>
                <span style={{ fontSize: "17px", fontWeight: 700, fontFamily: "monospace", color: "#f8fafc" }}>
                  {selectedEndpoint.path}
                </span>
              </div>

              <h2 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: 700, color: "#f8fafc" }}>
                {selectedEndpoint.name}
              </h2>

              <p style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#cbd5e1", lineHeight: 1.5 }}>
                {selectedEndpoint.description}
              </p>

              <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", backgroundColor: "#1e293b", padding: "6px 12px", borderRadius: "8px", fontSize: "12px", color: "#94a3b8" }}>
                <span style={{ color: "#38bdf8", fontWeight: 600 }}>Use Case:</span> {selectedEndpoint.useCase}
              </div>
            </div>

            {/* Interactive Navigation Tabs */}
            <div style={{ display: "flex", gap: "8px", borderBottom: "1px solid #1f2937", paddingBottom: "10px", marginBottom: "20px" }}>
              <button
                onClick={() => setActiveTab("tester")}
                style={{
                  backgroundColor: activeTab === "tester" ? "#10b981" : "#1e293b",
                  color: activeTab === "tester" ? "#ffffff" : "#94a3b8",
                  border: "none",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "6px",
                }}
              >
                <span>🧪</span> Live API Tester
              </button>
              <button
                onClick={() => setActiveTab("curl")}
                style={{
                  backgroundColor: activeTab === "curl" ? "#3b82f6" : "#1e293b",
                  color: activeTab === "curl" ? "#ffffff" : "#94a3b8",
                  border: "none",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                cURL
              </button>
              <button
                onClick={() => setActiveTab("fetch")}
                style={{
                  backgroundColor: activeTab === "fetch" ? "#3b82f6" : "#1e293b",
                  color: activeTab === "fetch" ? "#ffffff" : "#94a3b8",
                  border: "none",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                JavaScript / Fetch
              </button>
              <button
                onClick={() => setActiveTab("python")}
                style={{
                  backgroundColor: activeTab === "python" ? "#3b82f6" : "#1e293b",
                  color: activeTab === "python" ? "#ffffff" : "#94a3b8",
                  border: "none",
                  padding: "8px 18px",
                  borderRadius: "8px",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                Python (Requests)
              </button>
            </div>

            {/* TAB 1: LIVE API TESTER */}
            {activeTab === "tester" && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
                {/* Parameters & Request Pane */}
                <div style={{ backgroundColor: "#111827", borderRadius: "12px", border: "1px solid #1f2937", padding: "18px" }}>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc", marginBottom: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span>Request Parameters</span>
                    <span style={{ fontSize: "11px", color: apiKey ? "#34d399" : "#fbbf24" }}>
                      {apiKey ? "✓ Key Attached" : "⚠️ No Key Set"}
                    </span>
                  </div>

                  {/* Path Params */}
                  {selectedEndpoint.samplePathParams && (
                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#94a3b8", marginBottom: "4px" }}>
                        URL Path Parameter (:id)
                      </label>
                      <input
                        type="text"
                        value={pathParamId}
                        onChange={(e) => setPathParamId(e.target.value)}
                        placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                        style={{
                          width: "100%",
                          padding: "8px 10px",
                          borderRadius: "6px",
                          border: "1px solid #374151",
                          backgroundColor: "#0b0f17",
                          color: "#f8fafc",
                          fontSize: "12px",
                          fontFamily: "monospace",
                        }}
                      />
                    </div>
                  )}

                  {/* Query Params */}
                  {selectedEndpoint.sampleQuery && (
                    <div style={{ marginBottom: "14px" }}>
                      <label style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#94a3b8", marginBottom: "6px" }}>
                        Query Parameters
                      </label>
                      {Object.keys(queryParams).map((qKey) => (
                        <div key={qKey} style={{ display: "flex", gap: "8px", marginBottom: "6px", alignItems: "center" }}>
                          <span style={{ fontSize: "12px", fontFamily: "monospace", color: "#38bdf8", minWidth: "90px" }}>
                            {qKey}:
                          </span>
                          <input
                            type="text"
                            value={queryParams[qKey]}
                            onChange={(e) => setQueryParams({ ...queryParams, [qKey]: e.target.value })}
                            style={{
                              flex: 1,
                              padding: "6px 8px",
                              borderRadius: "6px",
                              border: "1px solid #374151",
                              backgroundColor: "#0b0f17",
                              color: "#f8fafc",
                              fontSize: "12px",
                              fontFamily: "monospace",
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* JSON Body */}
                  {selectedEndpoint.method !== "GET" && (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <label style={{ fontSize: "12px", fontWeight: 600, color: "#94a3b8" }}>
                          JSON Request Body
                        </label>
                        <button
                          type="button"
                          onClick={() =>
                            setRequestBodyText(
                              JSON.stringify(selectedEndpoint.sampleBody || {}, null, 2)
                            )
                          }
                          style={{
                            background: "none",
                            border: "none",
                            color: "#38bdf8",
                            fontSize: "11px",
                            cursor: "pointer",
                            textDecoration: "underline",
                          }}
                        >
                          Reset Sample
                        </button>
                      </div>
                      <textarea
                        rows={10}
                        value={requestBodyText}
                        onChange={(e) => setRequestBodyText(e.target.value)}
                        style={{
                          width: "100%",
                          padding: "10px",
                          borderRadius: "8px",
                          border: "1px solid #374151",
                          backgroundColor: "#0b0f17",
                          color: "#34d399",
                          fontSize: "12px",
                          fontFamily: "monospace",
                          lineHeight: 1.4,
                        }}
                      />
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={runTestRequest}
                    disabled={testLoading}
                    style={{
                      width: "100%",
                      backgroundColor: testLoading ? "#059669" : "#10b981",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      padding: "10px",
                      fontSize: "14px",
                      fontWeight: 700,
                      cursor: testLoading ? "wait" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "8px",
                    }}
                  >
                    {testLoading ? (
                      <>
                        <span>⏳</span> Executing Request...
                      </>
                    ) : (
                      <>
                        <span>▶</span> Send Live Test Request
                      </>
                    )}
                  </button>
                </div>

                {/* Response Pane */}
                <div style={{ backgroundColor: "#111827", borderRadius: "12px", border: "1px solid #1f2937", padding: "18px", display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "14px" }}>
                    <span style={{ fontSize: "14px", fontWeight: 700, color: "#f8fafc" }}>Response Output</span>
                    {testStatus !== null && (
                      <span
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          padding: "3px 8px",
                          borderRadius: "6px",
                          backgroundColor: testStatus >= 200 && testStatus < 300 ? "#064e3b" : "#7f1d1d",
                          color: testStatus >= 200 && testStatus < 300 ? "#34d399" : "#f87171",
                          border: `1px solid ${testStatus >= 200 && testStatus < 300 ? "#059669" : "#dc2626"}`,
                        }}
                      >
                        HTTP {testStatus}
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      flex: 1,
                      minHeight: "280px",
                      backgroundColor: "#0b0f17",
                      borderRadius: "8px",
                      border: "1px solid #1f2937",
                      padding: "14px",
                      overflow: "auto",
                      fontFamily: "monospace",
                      fontSize: "12px",
                      lineHeight: 1.4,
                    }}
                  >
                    {testLoading && (
                      <div style={{ color: "#94a3b8", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>Processing request with attached API key...</span>
                      </div>
                    )}

                    {!testLoading && testError && (
                      <div style={{ color: "#f87171" }}>
                        <strong>Error:</strong> {testError}
                      </div>
                    )}

                    {!testLoading && !testError && testResponse && (
                      <pre style={{ margin: 0, color: "#e2e8f0", whiteSpace: "pre-wrap" }}>
                        {JSON.stringify(testResponse, null, 2)}
                      </pre>
                    )}

                    {!testLoading && !testError && !testResponse && (
                      <div style={{ color: "#64748b", textAlign: "center", marginTop: "80px" }}>
                        Click <strong>&ldquo;Send Live Test Request&rdquo;</strong> to inspect the live response directly from your API.
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2, 3, 4: CODE GENERATOR (cURL, Fetch, Python) */}
            {activeTab !== "tester" && (
              <div style={{ backgroundColor: "#111827", borderRadius: "12px", border: "1px solid #1f2937", overflow: "hidden" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 18px", backgroundColor: "#1e293b", borderBottom: "1px solid #334155" }}>
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "#38bdf8", textTransform: "uppercase" }}>
                    {activeTab.toUpperCase()} Snippet (With Your API Key)
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      const text =
                        activeTab === "curl"
                          ? generateCurl()
                          : activeTab === "fetch"
                          ? generateFetch()
                          : generatePython();
                      handleCopy(text);
                    }}
                    style={{
                      backgroundColor: copiedCode ? "#10b981" : "#334155",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      padding: "6px 12px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    {copiedCode ? "✓ Copied!" : "📋 Copy Code"}
                  </button>
                </div>

                <pre
                  style={{
                    margin: 0,
                    padding: "18px",
                    backgroundColor: "#0b0f17",
                    color: "#a5f3fc",
                    fontSize: "13px",
                    fontFamily: "monospace",
                    lineHeight: 1.5,
                    overflowX: "auto",
                  }}
                >
                  {activeTab === "curl" && generateCurl()}
                  {activeTab === "fetch" && generateFetch()}
                  {activeTab === "python" && generatePython()}
                </pre>
              </div>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
