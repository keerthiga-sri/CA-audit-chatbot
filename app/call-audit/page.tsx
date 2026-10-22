"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CallAuditEvaluation,
  CallAuditSummaryStats,
  SAMPLE_CONSULTATION_CALLS,
} from "@/lib/call-audit";
import { startAudioRecording, ActiveAudioRecorder } from "@/lib/voice";

type Client = { id: string; name: string; email: string | null };

export default function CallAuditHub() {
  const [activeTab, setActiveTab] = useState<"new" | "report" | "history">("new");

  // Client Selection
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientName, setSelectedClientName] = useState("Sri");
  const [selectedClientId, setSelectedClientId] = useState<string | undefined>("5f3725aa-4c39-4de4-af19-22ebc2cd227b");

  // Audit Form States
  const [inputMode, setInputMode] = useState<"transcript" | "audio">("transcript");
  const [callTitle, setCallTitle] = useState("FY 2023-24 Statutory Audit Review & Balance Sheet Finalization");
  const [auditorName, setAuditorName] = useState("CA Keerthiga Sri J.M.");
  const [callDate, setCallDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [callDuration, setCallDuration] = useState(25);
  const [transcript, setTranscript] = useState(SAMPLE_CONSULTATION_CALLS[0].transcript);

  // Audio Upload & Recording States
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [audioVolume, setAudioVolume] = useState(0);
  const audioRecorderRef = useRef<ActiveAudioRecorder | null>(null);
  const recordTimerRef = useRef<NodeJS.Timeout | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Evaluation & Processing States
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalStep, setEvalStep] = useState<string>("");
  const [currentEvaluation, setCurrentEvaluation] = useState<CallAuditEvaluation | null>(null);
  const [copiedNotification, setCopiedNotification] = useState(false);

  // History & Stats States
  const [audits, setAudits] = useState<CallAuditEvaluation[]>([]);
  const [stats, setStats] = useState<CallAuditSummaryStats | null>(null);
  const [historySearch, setHistorySearch] = useState("");
  const [historyGradeFilter, setHistoryGradeFilter] = useState("ALL");
  const [historyStatusFilter, setHistoryStatusFilter] = useState("ALL");
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Top Nav Menu State
  const [showNavMenu, setShowNavMenu] = useState(false);
  const navMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (navMenuRef.current && !navMenuRef.current.contains(event.target as Node)) {
        setShowNavMenu(false);
      }
    }
    if (showNavMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showNavMenu]);

  // Initial Data Load
  useEffect(() => {
    loadClients();
    loadAudits();
  }, []);

  async function loadClients() {
    try {
      const res = await fetch("/api/clients");
      const data = await res.json();
      if (data?.clients && data.clients.length > 0) {
        setClients(data.clients);
        const sri = data.clients.find((c: Client) => c.name.toLowerCase() === "sri" || c.name.toLowerCase().includes("sri"));
        if (sri) {
          setSelectedClientName(sri.name);
          setSelectedClientId(sri.id);
        }
      }
    } catch (e) {
      console.warn("Could not load clients list:", e);
    }
  }

  async function loadAudits() {
    setLoadingHistory(true);
    try {
      const res = await fetch("/api/call-audit");
      const data = await res.json();
      if (data?.success) {
        setAudits(data.audits || []);
        setStats(data.stats || null);
        if (data.audits && data.audits.length > 0 && !currentEvaluation) {
          setCurrentEvaluation(data.audits[0]);
        }
      }
    } catch (e) {
      console.warn("Could not load call audits:", e);
    } finally {
      setLoadingHistory(false);
    }
  }

  // Load a curated sample consultation
  function handleSelectSample(sampleId: string) {
    const s = SAMPLE_CONSULTATION_CALLS.find((item) => item.id === sampleId);
    if (!s) return;
    setCallTitle(s.title);
    setSelectedClientName(s.clientName);
    setAuditorName(s.auditorName);
    setCallDuration(s.callDurationMinutes);
    setTranscript(s.transcript);
    setAudioFile(null);
    setAudioUrl(null);
    setInputMode("transcript");
  }

  // Audio File Selection & Drag-and-drop
  function handleFileSelected(file: File) {
    if (!file) return;
    setAudioFile(file);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setInputMode("audio");
    if (!callTitle || callTitle.includes("Statutory Audit Review")) {
      setCallTitle(`Audio Consultation: ${file.name.replace(/\.[^/.]+$/, "")}`);
    }
  }

  // Live Microphone Recording
  async function handleToggleRecording() {
    if (isRecording) {
      // Stop recording
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      if (audioRecorderRef.current) {
        try {
          const { blob, mimeType } = await audioRecorderRef.current.stop();
          const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
          const file = new File([blob], `live_consultation_${Date.now()}.${ext}`, { type: mimeType });
          handleFileSelected(file);
        } catch (err) {
          console.error("Failed to finish recording:", err);
        }
      }
      setIsRecording(false);
      setRecordingSeconds(0);
      setAudioVolume(0);
    } else {
      // Start recording
      try {
        const recorder = await startAudioRecording((vol) => setAudioVolume(vol));
        audioRecorderRef.current = recorder;
        setInputMode("audio");
        setIsRecording(true);
        setRecordingSeconds(0);
        recordTimerRef.current = setInterval(() => {
          setRecordingSeconds((prev) => prev + 1);
        }, 1000);
      } catch (err: any) {
        alert(err?.message || "Microphone access denied. Please grant microphone permissions.");
      }
    }
  }

  // Submit Call for Evaluation
  async function handleRunEvaluation() {
    if (inputMode === "audio" && !audioFile) {
      alert("Please upload a consultation audio file or record live with the microphone.");
      return;
    }
    if (inputMode === "transcript" && !transcript.trim()) {
      alert("Please enter or paste the call dialogue transcript to evaluate.");
      return;
    }

    setIsEvaluating(true);
    setEvalStep(
      inputMode === "audio" && audioFile
        ? "Transcribing consultation audio via Gemini multimodal engine..."
        : "Analyzing dialogue against ICAI statutory audit rubric..."
    );

    try {
      let evaluationResult: CallAuditEvaluation;

      if (inputMode === "audio" && audioFile) {
        const formData = new FormData();
        formData.append("file", audioFile);
        formData.append("clientName", selectedClientName);
        if (selectedClientId) formData.append("clientId", selectedClientId);
        formData.append("auditorName", auditorName);
        formData.append("callTitle", callTitle);
        formData.append("callDate", callDate);
        formData.append("callDurationMinutes", callDuration.toString());
        if (transcript.trim()) formData.append("transcript", transcript.trim());

        setEvalStep("Applying ICAI Code of Ethics, Section 143 & CARO 2020 verification...");
        const res = await fetch("/api/call-audit/evaluate", {
          method: "POST",
          body: formData,
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Evaluation failed");
        }
        evaluationResult = data.evaluation;
      } else {
        setEvalStep("Evaluating compliance disclaimers, figure accuracy, and action items...");
        const res = await fetch("/api/call-audit/evaluate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript,
            clientName: selectedClientName,
            clientId: selectedClientId,
            auditorName,
            callTitle,
            callDate,
            callDurationMinutes: callDuration,
            audioFileName: "consultation_sample.webm",
            hasAudio: true,
          }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || "Evaluation failed");
        }
        evaluationResult = data.evaluation;
      }

      setEvalStep("Compiling audit scorecard & partner sign-off certificate...");
      setCurrentEvaluation(evaluationResult);
      setActiveTab("report");
      await loadAudits();
    } catch (err: any) {
      console.error("Evaluation error:", err);
      alert(`Evaluation failed: ${err.message || "Unknown error"}`);
    } finally {
      setIsEvaluating(false);
      setEvalStep("");
    }
  }

  // Delete an audit
  async function handleDeleteAudit(id: string) {
    if (!confirm("Are you sure you want to delete this call audit report?")) return;
    try {
      const res = await fetch(`/api/call-audit/${id}`, { method: "DELETE" });
      if (res.ok) {
        setAudits((prev) => prev.filter((a) => a.id !== id));
        if (currentEvaluation?.id === id) {
          setCurrentEvaluation(audits.find((a) => a.id !== id) || null);
        }
        loadAudits();
      }
    } catch (e) {
      console.error("Failed to delete audit:", e);
    }
  }

  // Filtered History
  const filteredAudits = audits.filter((a) => {
    if (historyGradeFilter !== "ALL" && a.grade !== historyGradeFilter) return false;
    if (historyStatusFilter !== "ALL" && a.complianceStatus !== historyStatusFilter) return false;
    if (historySearch.trim()) {
      const q = historySearch.toLowerCase();
      return (
        a.callTitle.toLowerCase().includes(q) ||
        a.clientName.toLowerCase().includes(q) ||
        a.auditorName.toLowerCase().includes(q) ||
        a.executiveSummary.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="call-audit-shell">
      {/* ---------- TOP NAVIGATION ---------- */}
      <header className="call-audit-top-nav">
        <div className="call-audit-brand">
          <div>
            <div className="call-audit-brand-title">Call Scoring & Audit Hub</div>
            <div className="call-audit-brand-sub">
              <span>Auditor: <strong>CA Keerthiga Sri J.M.</strong> (FCA-084920)</span>
              <span>·</span>
              <span>J.M. & Associates</span>
            </div>
          </div>
        </div>

        <nav className="call-audit-nav-links">
          <Link href="/" className="call-audit-nav-btn">
            Chat Desk
          </Link>

          <div className="three-dot-menu-wrapper" ref={navMenuRef}>
            <button
              type="button"
              className={`three-dot-trigger-btn ${showNavMenu ? "active" : ""}`}
              onClick={() => setShowNavMenu(!showNavMenu)}
              title="More Actions & Navigation"
              aria-label="More Actions & Navigation"
              aria-expanded={showNavMenu}
              style={{
                width: "36px",
                height: "35px",
                borderRadius: "8px",
                borderColor: "#cbd5e1",
              }}
            >
              <span className="three-dot-icon">⋮</span>
            </button>

            {showNavMenu && (
              <div
                className="three-dot-dropdown-menu"
                role="menu"
                style={{ width: "260px", right: 0 }}
              >
                <button
                  type="button"
                  className="three-dot-menu-item"
                  role="menuitem"
                  onClick={() => {
                    setActiveTab("new");
                    setShowNavMenu(false);
                  }}
                >
                  <div className="menu-item-text">
                    <div className="menu-item-title" style={{ fontWeight: 700, color: "#0f172a" }}>
                      + New Call Audit
                    </div>
                    <div className="menu-item-desc">Audio scoring or transcript audit</div>
                  </div>
                </button>

                <div className="three-dot-menu-divider" />

                <Link
                  href="/upload"
                  className="three-dot-menu-item"
                  role="menuitem"
                  onClick={() => setShowNavMenu(false)}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="menu-item-text">
                    <div className="menu-item-title" style={{ fontWeight: 600, color: "#1e293b" }}>
                      10-Yr Ledgers
                    </div>
                    <div className="menu-item-desc">Ledgers, trial balance & vouchers</div>
                  </div>
                </Link>

                <Link
                  href="/docs"
                  className="three-dot-menu-item"
                  role="menuitem"
                  onClick={() => setShowNavMenu(false)}
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="menu-item-text">
                    <div className="menu-item-title" style={{ fontWeight: 600, color: "#1e293b" }}>
                      REST APIs
                    </div>
                    <div className="menu-item-desc">API endpoints & documentation</div>
                  </div>
                </Link>
              </div>
            )}
          </div>
        </nav>
      </header>

      {/* ---------- MAIN WORKSPACE CONTAINER ---------- */}
      <main className="call-audit-content">
        {/* ---------- STATS / KPI RIBBON ---------- */}
        <section className="call-audit-stats-grid" aria-label="Call Audit Metrics">
          <div className="call-audit-stat-card">
            <div className="call-audit-stat-info">
              <div className="call-audit-stat-label">Calls Audited</div>
              <div className="call-audit-stat-value">{stats?.totalAudited ?? audits.length}</div>
              <div className="call-audit-stat-sub">Statutory consultations logged</div>
            </div>
          </div>

          <div className="call-audit-stat-card">
            <div className="call-audit-stat-info">
              <div className="call-audit-stat-label">Risk Alerts & Flags</div>
              <div className="call-audit-stat-value">{stats?.flaggedCount ?? 0}</div>
              <div className="call-audit-stat-sub">
                {stats?.flaggedCount ? "Actionable issues flagged" : "Zero critical infractions"}
              </div>
            </div>
          </div>
        </section>

        {/* ---------- TABS BAR ---------- */}
        <nav className="call-audit-tabs-bar" aria-label="Call Audit Navigation Tabs">
          <button
            type="button"
            className={`call-audit-tab-btn ${activeTab === "new" ? "active" : ""}`}
            onClick={() => setActiveTab("new")}
          >
            <span>🎙️</span>
            <span>1. New Call Audit</span>
          </button>

          <button
            type="button"
            className={`call-audit-tab-btn ${activeTab === "report" ? "active" : ""}`}
            onClick={() => setActiveTab("report")}
          >
            <span>2. Audit Report & Scorecard</span>
            {currentEvaluation && (
              <span className={`call-audit-tab-badge`}>{currentEvaluation.grade}</span>
            )}
          </button>

          <button
            type="button"
            className={`call-audit-tab-btn ${activeTab === "history" ? "active" : ""}`}
            onClick={() => setActiveTab("history")}
          >
            <span>3. Audit History & QA Log</span>
            <span className="call-audit-tab-badge">{audits.length}</span>
          </button>
        </nav>

        {/* ========================================================================= */}
        {/* TAB 1: NEW CALL EVALUATION                                                */}
        {/* ========================================================================= */}
        {activeTab === "new" && (
          <div className="call-audit-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px", flexWrap: "wrap", gap: "10px" }}>
              <div>
                <h3 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  Evaluate Consultation Call
                </h3>
                <p style={{ fontSize: "13.5px", color: "#64748b", margin: "4px 0 0 0" }}>
                  Upload a recorded audio call or paste a transcript to score against ICAI Code of Ethics, Section 143, and CARO 2020.
                </p>
              </div>

              {/* Input Mode Selector */}
              <div style={{ display: "inline-flex", background: "#f1f5f9", padding: "3px", borderRadius: "8px" }}>
                <button
                  type="button"
                  onClick={() => setInputMode("transcript")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: inputMode === "transcript" ? "#ffffff" : "transparent",
                    color: inputMode === "transcript" ? "#0f172a" : "#64748b",
                    boxShadow: inputMode === "transcript" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                  }}
                >
                  Transcript Mode
                </button>
                <button
                  type="button"
                  onClick={() => setInputMode("audio")}
                  style={{
                    padding: "6px 14px",
                    borderRadius: "6px",
                    border: "none",
                    fontSize: "13px",
                    fontWeight: 600,
                    cursor: "pointer",
                    background: inputMode === "audio" ? "#ffffff" : "transparent",
                    color: inputMode === "audio" ? "#0f172a" : "#64748b",
                    boxShadow: inputMode === "audio" ? "0 1px 3px rgba(0,0,0,0.1)" : "none",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <span>🎙️</span>
                  <span>Audio Upload / Record</span>
                </button>
              </div>
            </div>

            {/* Quick-Pick 1-Click Samples */}
            <div className="call-audit-samples-wrap">
              <div className="call-audit-samples-title">
                <span>1-Click Quick Samples (Click any to test instant scoring & evaluation):</span>
              </div>
              <div className="call-audit-samples-grid">
                {SAMPLE_CONSULTATION_CALLS.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className="call-audit-sample-chip"
                    onClick={() => handleSelectSample(sample.id)}
                    title={sample.description}
                  >
                    <div>
                      <div>{sample.title}</div>
                      <div style={{ fontSize: "11px", opacity: 0.8, fontWeight: 500 }}>
                        {sample.clientName} · Expected Grade: {sample.expectedGrade} ({sample.expectedScore}/100)
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Call Metadata Form */}
            <div className="call-audit-form-grid">
              <div className="call-audit-field-group">
                <label className="call-audit-field-label">Client Under Audit</label>
                <select
                  className="call-audit-field-select"
                  value={selectedClientName}
                  onChange={(e) => {
                    const cName = e.target.value;
                    setSelectedClientName(cName);
                    const match = clients.find((c) => c.name === cName);
                    setSelectedClientId(match ? match.id : undefined);
                  }}
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} {c.email ? `(${c.email})` : ""}
                    </option>
                  ))}
                  {!clients.some((c) => c.name === "Sri") && (
                    <option value="Sri">Sri (sri@clientaudit.com)</option>
                  )}
                  {!clients.some((c) => c.name === "KS") && (
                    <option value="KS">KS (audit@ks.in)</option>
                  )}
                  <option value="Highland Retailers LLP">Highland Retailers LLP</option>
                </select>
              </div>

              <div className="call-audit-field-group">
                <label className="call-audit-field-label">Lead Statutory Auditor</label>
                <input
                  type="text"
                  className="call-audit-field-input"
                  value={auditorName}
                  onChange={(e) => setAuditorName(e.target.value)}
                  placeholder="e.g. CA Keerthiga Sri J.M."
                />
              </div>

              <div className="call-audit-field-group">
                <label className="call-audit-field-label">Consultation Call Title / Topic</label>
                <input
                  type="text"
                  className="call-audit-field-input"
                  value={callTitle}
                  onChange={(e) => setCallTitle(e.target.value)}
                  placeholder="e.g. FY 2023-24 Statutory Audit Review & Balance Sheet Finalization"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                <div className="call-audit-field-group">
                  <label className="call-audit-field-label">Consultation Date</label>
                  <input
                    type="date"
                    className="call-audit-field-input"
                    value={callDate}
                    onChange={(e) => setCallDate(e.target.value)}
                  />
                </div>
                <div className="call-audit-field-group">
                  <label className="call-audit-field-label">Duration (Mins)</label>
                  <input
                    type="number"
                    min="5"
                    max="180"
                    className="call-audit-field-input"
                    value={callDuration}
                    onChange={(e) => setCallDuration(parseInt(e.target.value, 10) || 25)}
                  />
                </div>
              </div>
            </div>

            {/* Input Mode Content */}
            {inputMode === "audio" ? (
              <div style={{ marginBottom: "20px" }}>
                <div
                  className="call-audit-dropzone"
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.add("dragover");
                  }}
                  onDragLeave={(e) => {
                    e.currentTarget.classList.remove("dragover");
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.classList.remove("dragover");
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      handleFileSelected(e.dataTransfer.files[0]);
                    }
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="audio/*,.mp3,.wav,.webm,.m4a,.ogg"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      if (e.target.files && e.target.files[0]) {
                        handleFileSelected(e.target.files[0]);
                      }
                    }}
                  />
                  <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎙️</div>
                  <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>
                    {audioFile ? audioFile.name : "Drop Consultation Audio File or Click to Browse"}
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#64748b", marginTop: "4px" }}>
                    Supports MP3, WAV, WebM, M4A, OGG up to 25 MB. Automatic Gemini Speech-to-Text transcription.
                  </div>
                  {audioFile && (
                    <div style={{ marginTop: "10px", display: "inline-block", background: "#ecfdf5", border: "1px solid #a7f3d0", padding: "4px 10px", borderRadius: "6px", fontSize: "12px", color: "#065f46", fontWeight: 600 }}>
                      🎙️ {(audioFile.size / (1024 * 1024)).toFixed(2)} MB Audio File Loaded
                    </div>
                  )}
                </div>

                {/* Audio Player and Microphone Recorder Controls */}
                <div style={{ marginTop: "14px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "12px", background: "#f8fafc", border: "1px solid #e2e8f0", padding: "12px 16px", borderRadius: "10px" }}>
                  <div>
                    {audioUrl ? (
                      <audio controls src={audioUrl} style={{ height: "36px" }} />
                    ) : (
                      <span style={{ fontSize: "13px", color: "#64748b", display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        <span>🎙️</span>
                        <span>No audio file selected yet. Or record live with microphone:</span>
                      </span>
                    )}
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    {isRecording && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>
                        <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: "#dc2626", animation: "pulse 1s infinite" }} />
                        <span>🎙️ Recording: {Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")}</span>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>Vol: {audioVolume}%</span>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handleToggleRecording}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "8px",
                        border: "1px solid",
                        borderColor: isRecording ? "#dc2626" : "#cbd5e1",
                        background: isRecording ? "#fef2f2" : "#ffffff",
                        color: isRecording ? "#dc2626" : "#0f172a",
                        fontWeight: 700,
                        fontSize: "13px",
                        cursor: "pointer",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <span>🎙️</span>
                      <span>{isRecording ? "Stop & Keep Recording" : "Record Live Consultation"}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="call-audit-field-group" style={{ marginBottom: "20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <label className="call-audit-field-label">Consultation Call Dialogue Transcript</label>
                  <span style={{ fontSize: "12px", color: "#64748b" }}>
                    {transcript.length} characters · {transcript.split(/\s+/).filter(Boolean).length} words
                  </span>
                </div>
                <textarea
                  className="call-audit-field-textarea"
                  rows={14}
                  style={{ fontFamily: "monospace", fontSize: "13px", lineHeight: "1.5" }}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="Paste call transcript here with speaker tags e.g.:
[00:00] Auditor (CA Keerthiga Sri): Good morning...
[00:30] Client: We reviewed our 10-year financials..."
                />
              </div>
            )}

            {/* Run Button and Evaluation Progress */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "14px", paddingTop: "14px", borderTop: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: "13px", color: "#64748b" }}>
                Evaluated against: ICAI Code of Ethics · Companies Act Sec 143 · CARO 2020 · Income Tax Act Sec 32/40A
              </div>

              <button
                type="button"
                className="call-audit-nav-btn primary"
                style={{ padding: "11px 24px", fontSize: "14.5px" }}
                disabled={isEvaluating}
                onClick={handleRunEvaluation}
              >
                {isEvaluating ? "Running AI Audit Evaluation..." : "Run AI Call Audit & Scoring"}
              </button>
            </div>

            {/* Animated Loading Status */}
            {isEvaluating && (
              <div style={{ marginTop: "18px", padding: "16px 20px", background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "10px", display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "20px", height: "20px", border: "3px solid #86efac", borderTopColor: "#15803d", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
                <div>
                  <div style={{ fontSize: "14px", fontWeight: 700, color: "#166534" }}>
                    Quality Assurance Audit In Progress
                  </div>
                  <div style={{ fontSize: "12.5px", color: "#15803d", marginTop: "2px" }}>
                    {evalStep || "Processing consultation..."}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 2: AUDIT REPORT & SCORECARD                                           */}
        {/* ========================================================================= */}
        {activeTab === "report" && currentEvaluation && (
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            {/* Top Scorecard Banner */}
            <section className="call-audit-scorecard-header">
              <div className="call-audit-scorecard-meta">
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                  <span className={`call-audit-badge ${
                    currentEvaluation.complianceStatus === "PASSED"
                      ? "passed"
                      : currentEvaluation.complianceStatus === "FLAGGED_WITH_WARNINGS"
                      ? "flagged"
                      : "non-compliant"
                  }`}>
                    {currentEvaluation.complianceStatus.replace(/_/g, " ")}
                  </span>
                  <span style={{ fontSize: "12px", color: "#94a3b8" }}>·</span>
                  <span style={{ fontSize: "13px", color: "#e2e8f0" }}>
                    Client: <strong>{currentEvaluation.clientName}</strong>
                  </span>
                </div>
                <h2>{currentEvaluation.callTitle}</h2>
                <p>
                  Lead Auditor: <strong>{currentEvaluation.auditorName}</strong> · Date: {currentEvaluation.callDate} · Duration: {currentEvaluation.callDurationMinutes} Mins
                </p>
              </div>

              <div className="call-audit-score-gauge-wrap">
                <div className={`call-audit-grade-pill ${currentEvaluation.grade.replace("+", "-plus")}`}>
                  {currentEvaluation.grade}
                </div>
                <div>
                  <div className="call-audit-score-num">
                    {currentEvaluation.overallScore}
                    <span className="call-audit-score-den">/ 100</span>
                  </div>
                  <div style={{ fontSize: "12px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700 }}>
                    Overall QA Score
                  </div>
                </div>
              </div>
            </section>

            {/* Quick Actions (Print, Export, Copy) */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
              <div style={{ display: "flex", gap: "8px" }}>
                <button
                  type="button"
                  className="call-audit-nav-btn"
                  onClick={() => window.print()}
                >
                  Print / Save PDF
                </button>
                <button
                  type="button"
                  className="call-audit-nav-btn"
                  onClick={() => {
                    const text = `CA CONSULTATION QUALITY AUDIT REPORT\nClient: ${currentEvaluation.clientName}\nAuditor: ${currentEvaluation.auditorName}\nScore: ${currentEvaluation.overallScore}/100 (Grade ${currentEvaluation.grade})\nCompliance Status: ${currentEvaluation.complianceStatus}\nExecutive Summary: ${currentEvaluation.executiveSummary}`;
                    navigator.clipboard.writeText(text);
                    setCopiedNotification(true);
                    setTimeout(() => setCopiedNotification(false), 3000);
                  }}
                >
                  {copiedNotification ? "Copied to Clipboard!" : "Copy Executive Summary"}
                </button>
                <button
                  type="button"
                  className="call-audit-nav-btn"
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(currentEvaluation, null, 2)], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `call_audit_${currentEvaluation.id}.json`;
                    a.click();
                  }}
                >
                  Export JSON
                </button>
              </div>

              <button
                type="button"
                className="call-audit-nav-btn primary"
                onClick={() => setActiveTab("new")}
              >
                + Audit Another Call
              </button>
            </div>

            {/* Executive Summary Box */}
            <div className="call-audit-card" style={{ borderLeft: "4px solid #1e3a8a" }}>
              <h4 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 8px 0" }}>
                Executive Partner Summary
              </h4>
              <p style={{ fontSize: "14px", color: "#334155", lineHeight: "1.6", margin: 0 }}>
                {currentEvaluation.executiveSummary}
              </p>
            </div>

            {/* Critical Risks Alert (if any) */}
            {currentEvaluation.criticalRisks && currentEvaluation.criticalRisks.length > 0 && (
              <div className="call-audit-card" style={{ background: "#fef2f2", borderColor: "#fecaca", borderLeft: "4px solid #dc2626" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
                  <h4 style={{ fontSize: "16px", fontWeight: 700, color: "#991b1b", margin: 0 }}>
                    Critical Regulatory Risk & Compliance Alerts
                  </h4>
                </div>
                <ul style={{ margin: "6px 0 0 20px", padding: 0, color: "#7f1d1d", fontSize: "13.5px", lineHeight: "1.5" }}>
                  {currentEvaluation.criticalRisks.map((risk, idx) => (
                    <li key={idx} style={{ marginBottom: "4px" }}>{risk}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Core Audit Score Dimensions (3 Key Dimensions) */}
            <div className="call-audit-card">
              <h3 style={{ fontSize: "18px", fontWeight: 700, margin: "0 0 16px 0", color: "#0f172a" }}>
                Core Audit Score Breakdown (Key Evaluation Dimensions)
              </h3>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {currentEvaluation.dimensions
                  .filter((dim) => dim.id !== "professionalEtiquette" && dim.id !== "actionableResolution")
                  .map((dim) => (
                  <div key={dim.id} className="call-audit-dimension-card">
                    <div className="call-audit-dim-header">
                      <div className="call-audit-dim-title">
                        <span className="call-audit-tab-badge" style={{ marginRight: "6px" }}>{dim.status}</span>
                        <span>{dim.name}</span>
                        <span className="call-audit-dim-weight">{dim.weight}% Weight</span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        <span className="call-audit-dim-score">{dim.score} / 100</span>
                      </div>
                    </div>

                    {/* Progress Bar */}
                    <div className="call-audit-dim-progress-track">
                      <div
                        className={`call-audit-dim-progress-fill ${
                          dim.score >= 75 ? "pass" : dim.score >= 60 ? "warn" : "fail"
                        }`}
                        style={{ width: `${dim.score}%` }}
                      />
                    </div>

                    <div style={{ fontSize: "13.5px", color: "#334155", lineHeight: "1.5" }}>
                      {dim.feedback}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Strengths & Action Items Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              {/* Strengths */}
              <div className="call-audit-card" style={{ borderLeft: "4px solid #16a34a" }}>
                <h4 style={{ fontSize: "16px", fontWeight: 700, color: "#166534", margin: "0 0 10px 0" }}>
                  Key Strengths & Commendations
                </h4>
                <ul style={{ margin: 0, paddingLeft: "18px", color: "#1e293b", fontSize: "13.5px", lineHeight: "1.6" }}>
                  {currentEvaluation.strengths.map((str, idx) => (
                    <li key={idx} style={{ marginBottom: "6px" }}>{str}</li>
                  ))}
                </ul>
              </div>

              {/* Action Items */}
              <div className="call-audit-card" style={{ borderLeft: "4px solid #c98818" }}>
                <h4 style={{ fontSize: "16px", fontWeight: 700, color: "#855306", margin: "0 0 10px 0" }}>
                  Agreed Action Items & Next Steps
                </h4>
                <ul style={{ margin: 0, paddingLeft: "18px", color: "#1e293b", fontSize: "13.5px", lineHeight: "1.6" }}>
                  {currentEvaluation.actionItems.map((item, idx) => (
                    <li key={idx} style={{ marginBottom: "6px" }}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Moment-by-Moment Transcript Audit */}
            {currentEvaluation.moments && currentEvaluation.moments.length > 0 && (
              <div className="call-audit-card">
                <h4 style={{ fontSize: "16px", fontWeight: 700, color: "#0f172a", margin: "0 0 14px 0" }}>
                  Moment-by-Moment Transcript Audit Highlights
                </h4>
                <div>
                  {currentEvaluation.moments.map((m, idx) => (
                    <div key={idx} className={`call-audit-moment-item ${m.type}`}>
                      <div className="call-audit-moment-meta">
                        <strong>[{m.timestamp || "00:00"}] {m.speaker}</strong>
                        <span>·</span>
                        <span style={{
                          fontWeight: 700,
                          fontSize: "11px",
                          color: m.type === "STRENGTH" ? "#16a34a" : m.type === "RISK_ALERT" ? "#dc2626" : "#2563eb",
                        }}>
                          {m.type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <div className="call-audit-moment-quote">
                        &ldquo;{m.quote}&rdquo;
                      </div>
                      <div className="call-audit-moment-comment">
                        {m.comment}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* CA Partner Sign-Off Certificate */}
            <div className="call-audit-cert-box">
              <div className="call-audit-cert-seal">
                ICAI QA<br />VERIFIED<br />FCA-084920
              </div>
              <h4 style={{ fontFamily: "Source Serif 4", fontSize: "18px", fontWeight: 700, color: "#78350f", margin: "0 0 6px 0" }}>
                Chartered Accountant Partner Consultation Sign-Off
              </h4>
              <p style={{ fontSize: "13.5px", color: "#451a03", lineHeight: "1.5", margin: "0 0 14px 0", maxWidth: "80%" }}>
                {currentEvaluation.caPartnerSignOff?.recommendation || "Evaluated in accordance with ICAI standards."}
              </p>
              <div style={{ display: "flex", gap: "24px", fontSize: "12.5px", color: "#78350f", flexWrap: "wrap" }}>
                <div><strong>Auditor:</strong> {currentEvaluation.caPartnerSignOff?.auditor || "CA Keerthiga Sri J.M."}</div>
                <div><strong>Membership:</strong> FCA-084920</div>
                <div><strong>Firm:</strong> J.M. & Associates</div>
                <div><strong>Audit Date:</strong> {new Date(currentEvaluation.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</div>
              </div>
            </div>
          </div>
        )}

        {/* Fallback if no report loaded on Report tab */}
        {activeTab === "report" && !currentEvaluation && (
          <div className="call-audit-card" style={{ textAlign: "center", padding: "60px 20px" }}>
            <h3 style={{ fontSize: "18px", fontWeight: 700, color: "#0f172a", margin: "0 0 6px 0" }}>
              No Evaluation Report Selected
            </h3>
            <p style={{ fontSize: "13.5px", color: "#64748b", margin: "0 0 18px 0" }}>
              Run a new evaluation or select an existing consultation from the Audit History log.
            </p>
            <button
              type="button"
              className="call-audit-nav-btn primary"
              onClick={() => setActiveTab("new")}
            >
              Start New Evaluation
            </button>
          </div>
        )}

        {/* ========================================================================= */}
        {/* TAB 3: AUDIT HISTORY & QA LOG                                             */}
        {/* ========================================================================= */}
        {activeTab === "history" && (
          <div className="call-audit-card">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", flexWrap: "wrap", gap: "12px" }}>
              <div>
                <h3 style={{ fontSize: "20px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  Consultation Audit History & QA Log
                </h3>
                <p style={{ fontSize: "13.5px", color: "#64748b", margin: "4px 0 0 0" }}>
                  Archived evaluations, compliance certificates, and scores.
                </p>
              </div>

              {/* Filters */}
              <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
                <input
                  type="text"
                  placeholder="Search client, topic..."
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  style={{
                    padding: "7px 12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                />

                <select
                  value={historyGradeFilter}
                  onChange={(e) => setHistoryGradeFilter(e.target.value)}
                  style={{
                    padding: "7px 12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                >
                  <option value="ALL">All Grades</option>
                  <option value="A+">Grade A+</option>
                  <option value="A">Grade A</option>
                  <option value="B">Grade B</option>
                  <option value="C">Grade C</option>
                  <option value="D">Grade D</option>
                </select>

                <select
                  value={historyStatusFilter}
                  onChange={(e) => setHistoryStatusFilter(e.target.value)}
                  style={{
                    padding: "7px 12px",
                    border: "1px solid #cbd5e1",
                    borderRadius: "8px",
                    fontSize: "13px",
                  }}
                >
                  <option value="ALL">All Statuses</option>
                  <option value="PASSED">Passed</option>
                  <option value="FLAGGED_WITH_WARNINGS">Flagged</option>
                  <option value="NON_COMPLIANT">Non-Compliant</option>
                </select>
              </div>
            </div>

            {loadingHistory ? (
              <div style={{ textAlign: "center", padding: "40px", color: "#64748b" }}>
                Loading audit history...
              </div>
            ) : filteredAudits.length === 0 ? (
              <div style={{ textAlign: "center", padding: "40px 20px", color: "#64748b" }}>
                No audits matched your search criteria.
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "13.5px" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #e2e8f0", textAlign: "left", color: "#64748b", fontSize: "12px", textTransform: "uppercase" }}>
                      <th style={{ padding: "10px 12px" }}>Client & Topic</th>
                      <th style={{ padding: "10px 12px" }}>Auditor</th>
                      <th style={{ padding: "10px 12px" }}>Date</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>Score</th>
                      <th style={{ padding: "10px 12px", textAlign: "center" }}>Grade</th>
                      <th style={{ padding: "10px 12px" }}>Status</th>
                      <th style={{ padding: "10px 12px", textAlign: "right" }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudits.map((a) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid #f1f5f9" }}>
                        <td style={{ padding: "12px" }}>
                          <div style={{ fontWeight: 700, color: "#0f172a" }}>{a.clientName}</div>
                          <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>{a.callTitle}</div>
                        </td>
                        <td style={{ padding: "12px", color: "#334155" }}>{a.auditorName}</td>
                        <td style={{ padding: "12px", color: "#64748b" }}>{a.callDate}</td>
                        <td style={{ padding: "12px", textAlign: "center", fontWeight: 800, fontSize: "15px" }}>
                          {a.overallScore}
                        </td>
                        <td style={{ padding: "12px", textAlign: "center" }}>
                          <span className={`call-audit-badge ${
                            a.grade === "A+" || a.grade === "A"
                              ? "passed"
                              : a.grade === "B" || a.grade === "C"
                              ? "flagged"
                              : "non-compliant"
                          }`}>
                            {a.grade}
                          </span>
                        </td>
                        <td style={{ padding: "12px" }}>
                          <span className={`call-audit-badge ${
                            a.complianceStatus === "PASSED"
                              ? "passed"
                              : a.complianceStatus === "FLAGGED_WITH_WARNINGS"
                              ? "flagged"
                              : "non-compliant"
                          }`}>
                            {a.complianceStatus.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td style={{ padding: "12px", textAlign: "right" }}>
                          <div style={{ display: "inline-flex", gap: "6px" }}>
                            <button
                              type="button"
                              className="call-audit-nav-btn primary"
                              style={{ padding: "5px 10px", fontSize: "12px" }}
                              onClick={() => {
                                setCurrentEvaluation(a);
                                setActiveTab("report");
                              }}
                            >
                              View Report
                            </button>
                            <button
                              type="button"
                              className="call-audit-nav-btn"
                              style={{ padding: "5px 10px", fontSize: "12px", color: "#dc2626" }}
                              onClick={() => handleDeleteAudit(a.id)}
                            >
                              ✕
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
        )}
      </main>
    </div>
  );
}
