"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Client = { id: string; name: string; email: string | null };
type Status = { kind: "ok" | "err"; text: string } | null;

const DEFAULT_API_KEY = "ca_live_541c806cb70ae18dab3721e1e6740c5b";

export default function UploadPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);

  async function loadClients(selectId?: string) {
    try {
      const res = await fetch("/api/clients", {
        headers: { "x-api-key": DEFAULT_API_KEY },
      });
      const d = await res.json();
      const list = d.clients ?? [];
      setClients(list);
      if (selectId) {
        setClientId(selectId);
      } else if (list.length > 0) {
        setClientId((prev) => prev || list[0].id);
      }
    } catch (err) {
      console.error("Failed to load clients:", err);
    }
  }
  useEffect(() => {
    loadClients();
  }, []);

  async function addClient() {
    if (!name.trim()) return;
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/clients", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": DEFAULT_API_KEY,
        },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const d = await res.json();
      if (!res.ok) {
        setStatus({ kind: "err", text: d.error || "Failed to register client." });
        return;
      }
      setName("");
      setEmail("");
      setStatus({ kind: "ok", text: `Client '${d.client?.name || name}' registered successfully.` });
      await loadClients(d.client?.id);
    } catch (e: any) {
      setStatus({ kind: "err", text: e.message || "Failed to communicate with client server." });
    } finally {
      setBusy(false);
    }
  }

  async function upload() {
    if (!file || !clientId) return;
    setBusy(true);
    setStatus(null);
    const body = new FormData();
    body.append("file", file);
    body.append("clientId", clientId);
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "x-api-key": DEFAULT_API_KEY },
        body,
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Upload failed.");
      setStatus({
        kind: "ok",
        text: d.message || `Successfully indexed ${d.years} years of financial figures (${d.firstYear} - ${d.lastYear}) with ${d.chunks} semantic RAG chunks under Auditor ${d.auditor}. The client ledger is updated in chat.`,
      });
      setFile(null);
    } catch (e: any) {
      const msg = e.message || "Upload failed.";
      if (msg.includes("fetch failed") || msg.includes("ENOTFOUND")) {
        setStatus({
          kind: "err",
          text: "Cloud Database Connection Notice: SUPABASE_URL and GEMINI_API_KEY need to be configured in your Vercel Project Settings > Environment Variables.",
        });
      } else {
        setStatus({ kind: "err", text: msg });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <Link className="back" href="/" style={{ margin: 0 }}>
          ← Back to Audit Chat
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <Link
            href="/call-audit"
            style={{
              fontSize: "12.5px",
              fontWeight: 600,
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              gap: "5px",
              padding: "4px 10px",
              borderRadius: "6px",
              background: "#eff6ff",
              border: "1px solid #bfdbfe",
              color: "#1d4ed8",
            }}
          >
            <span>🎙️</span>
            <span>Call Scoring & Audit</span>
          </Link>
          <Link
            href="/docs"
            title="REST API Documentation & Tester"
            aria-label="REST API Documentation & Tester"
            style={{
              fontSize: "14px",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "rgba(22, 163, 74, 0.1)",
              border: "1px solid rgba(22, 163, 74, 0.25)",
              color: "#16a34a",
            }}
          >
            ⚡
          </Link>
        </div>
      </div>
      <h1>Clients and 10-Year Audit Documents</h1>
      <p>
        Lead Auditor: <strong>CA Keerthiga Sri J.M. (FCA-084920)</strong> · J.M. & Associates
      </p>

      {status && (
        <div className={`status ${status.kind}`} style={{ marginBottom: "16px" }}>
          {status.text}
        </div>
      )}

      <section className="card">
        <h2>1. Register New Audit Client</h2>
        <input
          type="text"
          placeholder="Client / Company Name (e.g. Apex Enterprises Pvt Ltd)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Client name"
        />
        <input
          type="email"
          placeholder="Client Email (Receives Google Meet invites & notifications)"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Client email"
        />
        <button
          className="btn"
          onClick={addClient}
          disabled={busy || !name.trim()}
        >
          {busy ? "Registering Client..." : "Add Client"}
        </button>
      </section>

      <section className="card">
        <h2>2. Upload 10-Year Financial Records</h2>
        <label htmlFor="client-select">
          <strong>Select Client:</strong>
        </label>
        <select
          id="client-select"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
          aria-label="Client"
        >
          {clients.length === 0 && <option value="">Add a client first</option>}
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name} {c.email ? `(${c.email})` : ""}
            </option>
          ))}
        </select>

        <label htmlFor="doc-file">
          <strong>Audit Document (PDF, Excel, CSV, or Text):</strong>
        </label>
        <input
          id="doc-file"
          type="file"
          accept=".pdf,.xlsx,.xls,.csv,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          aria-label="Document"
        />
        <button
          className="btn"
          onClick={upload}
          disabled={busy || !file || !clientId}
        >
          {busy ? "Analyzing & Vectorizing 10-Year Document..." : "Upload and Index into RAG"}
        </button>
        <small>
          Must contain 10 years of Profit, Loss, and Income. Sample documents are ready in{" "}
          <code>sample_documents/</code> (Excel, CSV, and Text).
        </small>
      </section>
    </div>
  );
}


