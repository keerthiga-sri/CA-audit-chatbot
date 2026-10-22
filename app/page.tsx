"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  isSpeechRecognitionSupported,
  isSpeechSynthesisSupported,
  cleanTextForSpeech,
  getPreferredAuditorVoice,
  startAudioRecording,
  transcribeAudioWithGemini,
  ActiveAudioRecorder,
} from "@/lib/voice";

type Client = { id: string; name: string; email: string | null };
type Row = { year: number; income: number | null; profit: number | null; loss: number | null };
type Msg = { role: "user" | "assistant"; content: string; error?: boolean };

export type NotificationItem = {
  id: string;
  type: "meeting" | "audit" | "system" | "success";
  title: string;
  message: string;
  link?: string;
  linkText?: string;
  timestamp: string;
  read: boolean;
};

const DEFAULT_API_KEY = "ca_live_541c806cb70ae18dab3721e1e6740c5b";

const fmt = (n: number | null) =>
  n === null || n === undefined ? "–" : Number(n).toLocaleString();

/** Extracts any Google Meet URL in the text, prioritizing valid dedicated meeting room endpoints */
function extractMeetUrl(text: string): string | null {
  // First check for 3-4-3 pattern (standard Google Meet room)
  const roomMatch = text.match(/https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i);
  if (roomMatch) return roomMatch[0];

  const match = text.match(/https:\/\/meet\.google\.com\/[a-z0-9-]+/i);
  if (!match) return null;
  const url = match[0];
  if (url.includes("ca-audit-consultation")) {
    return null;
  }
  return url;
}

function extractCalendarUrl(text: string): string | null {
  const match = text.match(/https:\/\/(?:calendar\.google\.com|www\.google\.com\/calendar)[^\s)\]]+/i);
  return match ? match[0] : null;
}

function extractMeetingDurationMinutes(text: string): number {
  const durationMatch = text.match(/(?:duration|scheduled for)[*:\s]+([0-9]+(?:\.[0-9]+)?)\s*(minute|min|hour|hr)s?/i);
  if (durationMatch) {
    const val = parseFloat(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    if (unit.startsWith("hour") || unit.startsWith("hr")) {
      return Math.round(val * 60);
    }
    return Math.round(val);
  }
  const calDatesMatch = text.match(/dates=([0-9]{8}T[0-9]{6}Z?)\/([0-9]{8}T[0-9]{6}Z?)/);
  if (calDatesMatch) {
    try {
      const parseIso = (s: string) => {
        const m = s.match(/([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})?(Z)?/);
        if (!m) return null;
        const [_, y, mo, d, h, mi, sc = "00", isZ] = m;
        return isZ
          ? new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sc)))
          : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sc));
      };
      const d1 = parseIso(calDatesMatch[1]);
      const d2 = parseIso(calDatesMatch[2]);
      if (d1 && d2) {
        const diffMins = Math.round((d2.getTime() - d1.getTime()) / (60 * 1000));
        if (diffMins > 0) return diffMins;
      }
    } catch { }
  }
  return 30;
}

function parseScheduledDate(text: string): Date | null {
  // 1. Try extracting from calendar URL dates param (most accurate UTC)
  const calDatesMatch = text.match(/dates=([0-9]{4})([0-9]{2})([0-9]{2})T([0-9]{2})([0-9]{2})([0-9]{2})?(Z)?/);
  if (calDatesMatch) {
    const [_, y, m, d, hh, mm, ss = "00", isUtc] = calDatesMatch;
    if (isUtc) {
      return new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss)));
    }
  }

  // 2. Try markdown / text patterns: e.g. "**Scheduled Date & Time:** 5 October 2026 at 13:00 (Asia/Kolkata)"
  const textPattern = /(?:Scheduled Date & Time|Scheduled Time|Date & Time|Scheduled for)[*:\s]+([0-9]{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+[0-9]{4}[^\n\r*]+|[0-9]{4}-[0-9]{2}-[0-9]{2}[^\n\r*]+)/i;
  const match = text.match(textPattern);
  if (match && match[1]) {
    const raw = match[1].trim();
    const cleaned = raw
      .replace(/\s*\([^)]*\)/g, "")
      .replace(/\bat\b/gi, "")
      .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1")
      .trim();
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  // 3. Fallback date pattern
  const dateFallback = text.match(/([0-9]{1,2}(?:st|nd|rd|th)?\s+(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+[0-9]{4}(?:\s+at\s+[0-9]{1,2}:[0-9]{2}(?:\s*[ap]m)?)?)/i);
  if (dateFallback && dateFallback[1]) {
    const cleaned = dateFallback[1]
      .replace(/\bat\b/gi, "")
      .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, "$1")
      .trim();
    const parsed = new Date(cleaned);
    if (!isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

function parseScheduledTime(text: string): string | null {
  const d = parseScheduledDate(text);
  if (d) {
    try {
      return d.toLocaleString("en-IN", {
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch { }
  }

  // Fallback to text match
  const textPattern = /(?:Scheduled Date & Time|Scheduled Time|Date & Time|Scheduled for)[*:\s]+([^\n\r*]+)/i;
  const match = text.match(textPattern);
  if (match && match[1]) {
    return match[1].trim();
  }

  return null;
}

function formatTimeOnly(d: Date): string {
  try {
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    const hh = d.getHours();
    const mm = d.getMinutes().toString().padStart(2, "0");
    const ampm = hh >= 12 ? "PM" : "AM";
    const h12 = hh % 12 || 12;
    return `${h12}:${mm} ${ampm}`;
  }
}

/** Formats chat message text, linkifying URLs and embedding a Google Meet & Calendar card with lifecycle management (Waiting Room for future, Expired Lock for past) */
function ChatMessageContent({
  text,
  onNotify,
  onOpenEmailSetup,
}: {
  text: string;
  onNotify?: (notif: { type: "meeting" | "audit" | "system" | "success"; title: string; message: string; link?: string; linkText?: string }) => void;
  onOpenEmailSetup?: () => void;
}) {
  const meetUrl = extractMeetUrl(text);
  const scheduledTime = parseScheduledTime(text);
  const scheduledDate = parseScheduledDate(text);
  const durationMinutes = extractMeetingDurationMinutes(text);

  const emails = Array.from(
    new Set(text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [])
  );

  const templateMatch = text.match(/https:\/\/calendar\.google\.com\/calendar\/render\?action=TEMPLATE[^\s)\]]+/i);
  const directMatch = text.match(/https:\/\/(?:calendar\.google\.com|www\.google\.com\/calendar)\/event\?eid=[^\s)\]]+/i);

  let universalCalendarUrl = templateMatch ? templateMatch[0] : null;
  const organizerCalendarUrl = directMatch ? directMatch[0] : null;

  if (!universalCalendarUrl) {
    if (scheduledDate) {
      const tz = "Asia/Kolkata";
      const startUtc = scheduledDate;
      const endUtc = new Date(startUtc.getTime() + durationMinutes * 60_000);
      const cleanIso = (d: Date) => d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
      const dtStart = cleanIso(startUtc);
      const dtEnd = cleanIso(endUtc);

      const title = encodeURIComponent("CA Audit Consultation");
      const safeMeetUrl = meetUrl || "";
      const loc = encodeURIComponent(safeMeetUrl);
      const allGuests = Array.from(new Set([...emails, "keerthigasri04@gmail.com"])).join(",");
      const details = encodeURIComponent(
        `CA Audit Consultation\nScheduled: ${scheduledTime || ""}\nDuration: ${durationMinutes} minutes\nGoogle Meet: ${safeMeetUrl}\nHost: CA Keerthiga Sri J.M. (keerthigasri04@gmail.com)\nAttendees: ${allGuests}`
      );

      universalCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${dtStart}/${dtEnd}&ctz=${encodeURIComponent(tz)}&location=${loc}&details=${details}&add=${encodeURIComponent(allGuests)}`;
    } else {
      universalCalendarUrl = "https://calendar.google.com/calendar/u/0/r";
    }
  }

  const calendarUrl = universalCalendarUrl;

  const [now, setNow] = useState<Date>(new Date());
  const [showWaitingModal, setShowWaitingModal] = useState<boolean>(false);
  const [showExpiredModal, setShowExpiredModal] = useState<boolean>(false);
  const [calendarSyncSuccess, setCalendarSyncSuccess] = useState<boolean>(false);

  // Automatically update and synchronize Google Calendar for all participants
  const autoSyncedRef = useRef<boolean>(false);
  useEffect(() => {
    if (meetUrl && !autoSyncedRef.current) {
      autoSyncedRef.current = true;
      fetch("/api/calendar/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update",
          topic: "CA Audit Consultation",
          start: scheduledDate ? scheduledDate.toISOString().slice(0, 19) : undefined,
          durationMinutes,
          meetLink: meetUrl,
          attendees: emails,
          addAttendees: emails,
        }),
      })
        .then((res) => res.json())
        .then((data) => {
          if (data?.success) {
            setCalendarSyncSuccess(true);
            onNotify?.({
              type: "success",
              title: "Google Calendar Synchronized",
              message: `Calendar automatically updated for all ${data.attendees?.length || emails.length} participants with official invites.`,
              link: organizerCalendarUrl || universalCalendarUrl || data.calendarWebUrl,
              linkText: "View in Google Calendar",
            });
          }
        })
        .catch((err) => {
          console.warn("Auto-sync calendar for all participants:", err);
        });
    }
  }, [meetUrl, scheduledDate, durationMinutes, emails, organizerCalendarUrl, universalCalendarUrl, onNotify]);

  useEffect(() => {
    if (!scheduledDate) return;
    const interval = setInterval(() => {
      setNow(new Date());
    }, 1000);
    return () => clearInterval(interval);
  }, [scheduledDate]);

  const startTimeMs = scheduledDate ? scheduledDate.getTime() : null;
  const durationMs = durationMinutes * 60 * 1000;
  const endTimeMs = startTimeMs ? startTimeMs + durationMs : null;
  const endDate = endTimeMs ? new Date(endTimeMs) : null;

  // Lifecycle calculations:
  // 1. Over: now has passed the scheduled end time (startTime + duration)
  const isMeetingOver = endTimeMs !== null && now.getTime() >= endTimeMs;

  // 2. Future: more than 5 minutes before scheduled start time
  const diffStartMs = startTimeMs ? startTimeMs - now.getTime() : null;
  const isFutureMeeting = !isMeetingOver && diffStartMs !== null && diffStartMs > 5 * 60 * 1000;

  // 3. Live / Active: within 5 minutes before start until scheduled end time
  const isMeetingLive = !isMeetingOver && !isFutureMeeting && startTimeMs !== null;

  // Remaining time to start
  const remainingToStart = Math.max(0, diffStartMs ?? 0);
  const days = Math.floor(remainingToStart / (1000 * 60 * 60 * 24));
  const hours = Math.floor((remainingToStart / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((remainingToStart / (1000 * 60)) % 60);
  const seconds = Math.floor((remainingToStart / 1000) % 60);

  // Time elapsed since end
  const msSinceEnd = endTimeMs ? Math.max(0, now.getTime() - endTimeMs) : 0;
  const minutesSinceEnd = Math.floor(msSinceEnd / (60 * 1000));

  const formattedStartTime = scheduledDate ? formatTimeOnly(scheduledDate) : null;
  const formattedEndTime = endDate ? formatTimeOnly(endDate) : null;
  const formattedFullDate = scheduledDate
    ? scheduledDate.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    })
    : null;

  // Tokenize text to handle markdown links [label](url), bare URLs, and text
  const tokenRegex = /(\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)]+)/g;
  const tokens = text.split(tokenRegex);

  return (
    <div>
      <div>
        {tokens.map((tok, i) => {
          if (!tok) return null;

          // Check if token is a markdown link: [label](url)
          if (tok.startsWith("[") && tok.includes("](")) {
            const mdMatch = tok.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
            if (mdMatch) {
              const label = mdMatch[1];
              const rawUrl = mdMatch[2];
              const url = rawUrl.includes("ca-audit-consultation")
                ? "https://meet.google.com/new"
                : rawUrl;
              const isMeetLink =
                (url.startsWith("https://meet.google.com/") ||
                 url.startsWith("http://meet.google.com/")) &&
                !url.includes("calendar.google.com");

              if (isMeetLink) {
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="chat-inline-link"
                    title={`Open Google Meet: ${url}`}
                  >
                    {url}
                  </a>
                );
              }

              const isCalLink =
                url.includes("calendar.google.com") ||
                url.includes("google.com/calendar");

              if (isCalLink) {
                const calLabel =
                  label.toLowerCase().includes("add") || label.toLowerCase().includes("update")
                    ? "View in Google Calendar"
                    : label;
                return (
                  <a
                    key={i}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="chat-inline-link"
                    title="Open Google Calendar"
                  >
                    {calLabel}
                  </a>
                );
              }

              return (
                <a
                  key={i}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="chat-inline-link"
                >
                  {label}
                </a>
              );
            }
          }

          // Check if token is a bare URL: https://...
          if (/^https?:\/\//.test(tok)) {
            const p = tok.includes("ca-audit-consultation")
              ? "https://meet.google.com/new"
              : tok;

            return (
              <a
                key={i}
                href={p}
                target="_blank"
                rel="noreferrer"
                className="chat-inline-link"
              >
                {p}
              </a>
            );
          }

          // Plain text token
          return <span key={i}>{tok}</span>;
        })}
      </div>

      {meetUrl && (
        <div className="meet-callout-card">
          <div className="meet-callout-info">
            <div className="meet-callout-badge-wrap">
              <span className="meet-callout-badge">Google Meet & Calendar</span>
              {isMeetingOver ? (
                <span className="meet-callout-expired-pill">
                  🔴 Consultation Over · Concluded
                </span>
              ) : isFutureMeeting ? (
                <span className="meet-callout-waiting-pill">
                  ⏳ Scheduled · Waiting Room Active (Outside Call)
                </span>
              ) : (
                <span className="meet-callout-live-pill">🟢 Meeting Ready · Join Now</span>
              )}
            </div>

            {scheduledTime && (
              <div className={`meet-callout-time-row ${isMeetingOver ? "expired" : ""}`}>
                <span className="meet-time-icon">{isMeetingOver ? "🛑" : "⏰"}</span>
                <span className="meet-time-text">
                  <strong>Scheduled Slot:</strong>{" "}
                  {formattedStartTime && formattedEndTime
                    ? `${formattedStartTime} – ${formattedEndTime} (${durationMinutes} Mins)`
                    : scheduledTime}
                  {isMeetingOver && (
                    <span className="meet-ended-tag">
                      · Concluded {minutesSinceEnd > 0 ? `${minutesSinceEnd}m ago` : "just now"}
                    </span>
                  )}
                </span>
              </div>
            )}

            {/* MEETING OVER NOTICE BOX (Visible when scheduled time + duration has passed) */}
            {isMeetingOver && (
              <div className="meet-expired-box">
                <div className="meet-expired-header">
                  <span className="meet-expired-icon">🛑</span>
                  <div>
                    <div className="meet-expired-title">Scheduled Consultation Is Over</div>
                    <div className="meet-expired-desc">
                      This statutory audit consultation was scheduled from{" "}
                      <strong>{formattedStartTime || "start"}</strong> to{" "}
                      <strong>{formattedEndTime || "end"}</strong> ({durationMinutes} minutes).
                      The consultation window has ended and the meeting room is closed.
                    </div>
                  </div>
                </div>
                <div className="meet-expired-footer-note">
                  ⏱ Concluded {minutesSinceEnd > 0 ? `${minutesSinceEnd} minute${minutesSinceEnd === 1 ? "" : "s"} ago` : "just now"}.
                </div>
              </div>
            )}

            {/* WAITING ROOM COUNTDOWN BOX (Visible when meeting is scheduled for future) */}
            {isFutureMeeting && (
              <div className="meet-waiting-box">
                <div className="meet-waiting-header">
                  <span className="meet-waiting-icon">⏳</span>
                  <div>
                    <div className="meet-waiting-title">Meeting Has Not Started Yet</div>
                    <div className="meet-waiting-desc">
                      Scheduled for {scheduledTime}. Participants must stay outside until the meeting time arrives.
                    </div>
                  </div>
                </div>

                <div className="meet-countdown-bar">
                  <div className="countdown-unit">
                    <span className="unit-val">{days}</span>
                    <span className="unit-label">Days</span>
                  </div>
                  <span className="countdown-sep">:</span>
                  <div className="countdown-unit">
                    <span className="unit-val">{hours.toString().padStart(2, "0")}</span>
                    <span className="unit-label">Hours</span>
                  </div>
                  <span className="countdown-sep">:</span>
                  <div className="countdown-unit">
                    <span className="unit-val">{minutes.toString().padStart(2, "0")}</span>
                    <span className="unit-label">Mins</span>
                  </div>
                  <span className="countdown-sep">:</span>
                  <div className="countdown-unit">
                    <span className="unit-val">{seconds.toString().padStart(2, "0")}</span>
                    <span className="unit-label">Secs</span>
                  </div>
                </div>
              </div>
            )}

            <div className="meet-callout-link-row">
              <span className="meet-link-label">Meet Link:</span>
              <a
                href={meetUrl || "#"}
                target="_blank"
                rel="noreferrer"
                className="meet-callout-link"
                style={{ textDecoration: "underline", color: "#166534", fontWeight: 700, wordBreak: "break-all" }}
                title="Click to open Google Meet"
              >
                {meetUrl} ↗
              </a>
            </div>

            {emails.length > 0 && (
              <div className="meet-callout-attendees">
                ✉️ Invitation Emailed Automatically to: <strong>{emails.join(", ")}</strong>
              </div>
            )}

            <div className="meet-cal-synced-note">
              📅 Synchronized in Google Calendar for all participants ✓
            </div>
          </div>

          <div className="meet-callout-actions">
            <a
              href={meetUrl || "#"}
              target="_blank"
              rel="noreferrer"
              className="meet-join-btn"
              title="Open Google Meet consultation directly"
            >
              <span>📹</span> Join Google Meet Now
            </a>

            {(organizerCalendarUrl || universalCalendarUrl) && (
              <a
                href={organizerCalendarUrl || universalCalendarUrl}
                target="_blank"
                rel="noreferrer"
                className="meet-cal-btn"
                title="View event in Google Calendar"
              >
                <span>📅</span> View in Google Calendar
              </a>
            )}
          </div>
        </div>
      )}

      {/* ---------- MEETING OVER / EXPIRED MODAL ---------- */}
      {showExpiredModal && (
        <div className="email-modal-overlay" onClick={() => setShowExpiredModal(false)}>
          <div className="email-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="email-modal-header" style={{ background: "#7f1d1d" }}>
              <h3>🛑 Scheduled Meeting Over · Closed</h3>
              <button
                type="button"
                className="email-modal-close"
                onClick={() => setShowExpiredModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="email-modal-body">
              <div style={{ textAlign: "center", padding: "10px 0 4px 0" }}>
                <div style={{ fontSize: "38px", marginBottom: "8px" }}>🛑</div>
                <h4 style={{ fontSize: "17px", fontWeight: 700, color: "#111e30", margin: "0 0 6px 0" }}>
                  This Scheduled Meeting Is Over
                </h4>
                <p style={{ fontSize: "13.5px", color: "#64748b", margin: 0, lineHeight: "1.5" }}>
                  The allocated consultation window for this statutory audit review has ended.
                  Participants can no longer access this meeting room.
                </p>
              </div>

              <div className="meet-expired-box" style={{ margin: "10px 0" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#991b1b", textAlign: "center", letterSpacing: "0.05em" }}>
                  Consultation Concluded
                </div>
                <div style={{ textAlign: "center", fontSize: "14px", fontWeight: 700, color: "#7f1d1d", marginTop: "4px" }}>
                  Ended {minutesSinceEnd > 0 ? `${minutesSinceEnd} minute${minutesSinceEnd === 1 ? "" : "s"} ago` : "just now"}
                </div>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Scheduled Slot:</span>
                  <span style={{ color: "#0f172a", fontWeight: 700 }}>
                    {formattedStartTime && formattedEndTime
                      ? `${formattedStartTime} – ${formattedEndTime} (${durationMinutes} Mins)`
                      : scheduledTime}
                  </span>
                </div>
                {formattedFullDate && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Date:</span>
                    <span style={{ color: "#0f172a", fontWeight: 600 }}>{formattedFullDate}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Meeting Status:</span>
                  <span style={{ color: "#b91c1c", fontWeight: 700 }}>🔴 Over / Closed</span>
                </div>
                {emails.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Invited Attendees:</span>
                    <span style={{ color: "#0f172a", fontWeight: 500, textAlign: "right" }}>{emails.join(", ")}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Lead Auditor:</span>
                  <span style={{ color: "#166534", fontWeight: 600 }}>CA Keerthiga Sri J.M.</span>
                </div>
              </div>

              <div className="email-modal-actions" style={{ justifyContent: "space-between", marginTop: "14px" }}>
                {calendarUrl ? (
                  <a
                    href={calendarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="meet-cal-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 14px" }}
                  >
                    <span>📅</span> View Past Calendar Event
                  </a>
                ) : <div />}

                <button
                  type="button"
                  className="email-cancel-btn"
                  onClick={() => setShowExpiredModal(false)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- PRE-MEETING WAITING ROOM MODAL ---------- */}
      {showWaitingModal && (
        <div className="email-modal-overlay" onClick={() => setShowWaitingModal(false)}>
          <div className="email-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="email-modal-header" style={{ background: "#78350f" }}>
              <h3>⏳ Meeting Scheduled · Waiting Room</h3>
              <button
                type="button"
                className="email-modal-close"
                onClick={() => setShowWaitingModal(false)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="email-modal-body">
              <div style={{ textAlign: "center", padding: "10px 0 4px 0" }}>
                <div style={{ fontSize: "38px", marginBottom: "8px" }}>🛑</div>
                <h4 style={{ fontSize: "17px", fontWeight: 700, color: "#111e30", margin: "0 0 6px 0" }}>
                  You Are Outside The Meeting Room
                </h4>
                <p style={{ fontSize: "13.5px", color: "#64748b", margin: 0, lineHeight: "1.5" }}>
                  This statutory audit consultation is scheduled for a future date and time.
                  Participants must stay outside the meeting until the scheduled start time arrives.
                </p>
              </div>

              <div className="meet-waiting-box" style={{ margin: "4px 0" }}>
                <div style={{ fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#92400e", textAlign: "center", letterSpacing: "0.05em" }}>
                  Time Remaining To Start
                </div>
                <div className="meet-countdown-bar">
                  <div className="countdown-unit">
                    <span className="unit-val">{days}</span>
                    <span className="unit-label">Days</span>
                  </div>
                  <span className="countdown-sep">:</span>
                  <div className="countdown-unit">
                    <span className="unit-val">{hours.toString().padStart(2, "0")}</span>
                    <span className="unit-label">Hours</span>
                  </div>
                  <span className="countdown-sep">:</span>
                  <div className="countdown-unit">
                    <span className="unit-val">{minutes.toString().padStart(2, "0")}</span>
                    <span className="unit-label">Mins</span>
                  </div>
                  <span className="countdown-sep">:</span>
                  <div className="countdown-unit">
                    <span className="unit-val">{seconds.toString().padStart(2, "0")}</span>
                    <span className="unit-label">Secs</span>
                  </div>
                </div>
              </div>

              <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: "8px", padding: "12px 14px", fontSize: "13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Scheduled Time:</span>
                  <span style={{ color: "#0f172a", fontWeight: 700 }}>{scheduledTime}</span>
                </div>
                {emails.length > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                    <span style={{ color: "#64748b", fontWeight: 600 }}>Invited Attendees:</span>
                    <span style={{ color: "#0f172a", fontWeight: 500, textAlign: "right" }}>{emails.join(", ")}</span>
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#64748b", fontWeight: 600 }}>Google Calendar:</span>
                  <span style={{ color: "#166534", fontWeight: 600 }}>✓ Event Synced & Confirmed</span>
                </div>
              </div>

              <div className="email-modal-actions" style={{ justifyContent: "space-between", marginTop: "12px" }}>
                {calendarUrl ? (
                  <a
                    href={calendarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="meet-cal-btn"
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "9px 14px" }}
                  >
                    <span>📅</span> View in Google Calendar
                  </a>
                ) : <div />}

                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <a
                    href={meetUrl || "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="meet-join-btn"
                    style={{ padding: "8px 16px", textDecoration: "none" }}
                    title="Open Google Meet room directly"
                  >
                    📹 Join Google Meet Now
                  </a>
                  <button
                    type="button"
                    className="email-cancel-btn"
                    onClick={() => setShowWaitingModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Home() {
  const [clients, setClients] = useState<Client[]>([]);
  const [clientId, setClientId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [showRecords, setShowRecords] = useState(false);

  // Unified Calendar & Email Integration Modal State
  const [showIntegrationModal, setShowIntegrationModal] = useState(false);
  const [integrationTab, setIntegrationTab] = useState<"calendar" | "email" | "voice">("calendar");
  const [showApiKeyModal, setShowApiKeyModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);

  const setShowEmailModal = (show: boolean) => {
    if (show) setIntegrationTab("email");
    setShowIntegrationModal(show);
  };
  const setShowCalendarModal = (show: boolean) => {
    if (show) setIntegrationTab("calendar");
    setShowIntegrationModal(show);
  };

  // Automated Email Configuration State
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [smtpPasswordInput, setSmtpPasswordInput] = useState("");
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [smtpFeedback, setSmtpFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Google Calendar Integration State
  const [calendarConfigured, setCalendarConfigured] = useState(false);
  const [calendarRefreshToken, setCalendarRefreshToken] = useState("");
  const [savingCalendar, setSavingCalendar] = useState(false);
  const [calendarFeedback, setCalendarFeedback] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [calendarData, setCalendarData] = useState<{
    configured?: boolean;
    hasClientId?: boolean;
    hasClientSecret?: boolean;
    hasRefreshToken?: boolean;
    hasCredentialsFile?: boolean;
    emailAccount?: string;
  } | null>(null);
  const [auditorMeetLinkInput, setAuditorMeetLinkInput] = useState("https://meet.google.com/new");
  const [connectingCalendar, setConnectingCalendar] = useState(false);
  const connectPollRef = useRef<NodeJS.Timeout | null>(null);

  const handleConnectCalendar = async () => {
    setConnectingCalendar(true);
    setCalendarFeedback({
      type: "success",
      text: "Starting Google OAuth... Please sign in with your Google account in the browser window and click 'Allow' to connect Google Calendar.",
    });

    try {
      await fetch("/api/calendar/connect", { method: "POST" });
    } catch (e) {
      console.error("Failed to trigger connect:", e);
    }

    if (connectPollRef.current) clearInterval(connectPollRef.current);
    let attempts = 0;
    connectPollRef.current = setInterval(async () => {
      attempts++;
      try {
        const res = await fetch("/api/calendar/config");
        const data = await res.json();
        if (data.configured) {
          if (connectPollRef.current) clearInterval(connectPollRef.current);
          setCalendarConfigured(true);
          setCalendarData(data);
          setConnectingCalendar(false);
          setCalendarFeedback({
            type: "success",
            text: "✓ Google Calendar successfully connected! Scheduled meetings will now automatically update in your Google Calendar.",
          });
          triggerNotification({
            type: "success",
            title: "Google Calendar Connected",
            message: "Automatic direct Google Calendar synchronization is now active.",
          });
          setTimeout(() => setShowCalendarModal(false), 2000);
        }
      } catch { }

      if (attempts > 80) {
        if (connectPollRef.current) clearInterval(connectPollRef.current);
        setConnectingCalendar(false);
      }
    }, 1500);
  };

  // Notification State
  const [notifications, setNotifications] = useState<NotificationItem[]>([
    {
      id: "notif-init-1",
      type: "audit",
      title: "Auditor Verification Ready",
      message: "Lead Auditor CA Keerthiga Sri J.M. (FCA-084920) has verified the client registries.",
      timestamp: "Today",
      read: false,
    },
    {
      id: "notif-init-2",
      type: "system",
      title: "LangChain RAG Active",
      message: "Strict single-answer precision and MCP Google Meet scheduler initialized.",
      timestamp: "Active",
      read: true,
    },
  ]);
  const [activeToast, setActiveToast] = useState<NotificationItem | null>(null);
  const [showNotifCenter, setShowNotifCenter] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const menuContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuContainerRef.current && !menuContainerRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    if (showMenu) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showMenu]);


  const endRef = useRef<HTMLDivElement>(null);
  const toastTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Helper to trigger a popup toast + add to notification center
  const triggerNotification = (item: Omit<NotificationItem, "id" | "timestamp" | "read">) => {
    const fullItem: NotificationItem = {
      ...item,
      id: `notif-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
      read: false,
    };

    setNotifications((prev) => [fullItem, ...prev]);
    setActiveToast(fullItem);

    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    toastTimeoutRef.current = setTimeout(() => {
      setActiveToast(null);
    }, 6500);
  };

  // Voice Assistant State & Controllers
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [autoSpeak, setAutoSpeak] = useState<boolean>(false);
  const [audioVolume, setAudioVolume] = useState<number>(0);
  const [currentlySpeakingMsgIndex, setCurrentlySpeakingMsgIndex] = useState<number | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceName] = useState<string>("");
  const [speechRate, setSpeechRate] = useState<number>(1.0);
  const [speechLang, setSpeechLang] = useState<string>("en-IN");
  const [micStatusText, setMicStatusText] = useState<string>("");

  const recognitionRef = useRef<any>(null);
  const audioRecorderRef = useRef<ActiveAudioRecorder | null>(null);
  const recognizedTranscriptRef = useRef<string>("");
  const isListeningRef = useRef<boolean>(false);

  // Initialize available browser voices
  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const updateVoices = () => {
      const vList = window.speechSynthesis.getVoices();
      if (vList.length > 0) {
        setVoices(vList);
        if (!selectedVoiceName) {
          const pref = getPreferredAuditorVoice();
          if (pref) setSelectedVoiceName(pref.name);
        }
      }
    };
    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [selectedVoiceName]);

  const startListening = async () => {
    if (isSpeaking) stopSpeaking();
    recognizedTranscriptRef.current = "";
    setMicStatusText("Starting microphone...");
    isListeningRef.current = true;
    setIsListening(true);

    // 1. Capture microphone via MediaRecorder with real-time volume level meter
    try {
      const rec = await startAudioRecording((vol) => {
        setAudioVolume(vol);
        if (vol > 15) {
          setMicStatusText("Sound detected! Listening to your question...");
        }
      });
      audioRecorderRef.current = rec;
      setMicStatusText("Microphone active! Speak your audit question now...");
    } catch (err: any) {
      console.warn("MediaRecorder start error:", err);
      isListeningRef.current = false;
      setIsListening(false);
      triggerNotification({
        type: "system",
        title: "Microphone Access Required",
        message: err?.message || "Please allow microphone access in your browser to speak.",
      });
      setMicStatusText("");
      return;
    }

    // 2. Parallel client-side SpeechRecognition for instant preview
    if (isSpeechRecognitionSupported()) {
      try {
        const SpeechRecognitionClass =
          (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        const rec = new SpeechRecognitionClass();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = speechLang || "en-IN";

        rec.onresult = (event: any) => {
          let accumulated = "";
          for (let i = 0; i < event.results.length; i++) {
            accumulated += event.results[i][0].transcript;
          }
          if (accumulated.trim()) {
            recognizedTranscriptRef.current = accumulated.trim();
            setInput(accumulated.trim());
            setMicStatusText(`Detected: "${accumulated.trim()}"`);
          }
        };

        rec.onerror = (e: any) => {
          console.warn("Client speech recognition note:", e?.error);
        };

        recognitionRef.current = rec;
        rec.start();
      } catch (e) {
        console.warn("SpeechRecognition init error:", e);
      }
    }
  };

  const stopListening = async () => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    setIsListening(false);
    setAudioVolume(0);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch { }
      recognitionRef.current = null;
    }

    let finalQuery = (recognizedTranscriptRef.current || input).trim();

    // Get the recorded audio blob
    let recordedBlob: Blob | null = null;
    if (audioRecorderRef.current) {
      try {
        const result = await audioRecorderRef.current.stop();
        recordedBlob = result.blob;
      } catch (err) {
        console.warn("Audio recorder stop error:", err);
      }
      audioRecorderRef.current = null;
    }

    // If client recognition did not transcribe, send audio to server transcription
    if (!finalQuery && recordedBlob && recordedBlob.size > 1000) {
      setIsTranscribing(true);
      setMicStatusText("Transcribing speech with AI & NLP...");
      try {
        const audioText = await transcribeAudioWithGemini(recordedBlob);
        if (audioText && !audioText.includes("NO_SPEECH")) {
          finalQuery = audioText.trim();
          setInput(finalQuery);
        }
      } catch (err: any) {
        console.warn("Audio transcription failed:", err);
      } finally {
        setIsTranscribing(false);
      }
    }

    setMicStatusText("");

    // Automatically trigger NLP processing!
    if (finalQuery) {
      triggerNotification({
        type: "system",
        title: "Voice Query Transcribed",
        message: `Processing query: "${finalQuery}"`,
      });
      send(finalQuery);
    } else {
      triggerNotification({
        type: "system",
        title: "No Speech Detected",
        message: "No clear speech detected. Please speak clearly into your microphone.",
      });
    }
  };

  const speakText = (text: string, msgIndex?: number) => {
    if (!isSpeechSynthesisSupported()) return;

    try {
      window.speechSynthesis.cancel();

      const cleaned = cleanTextForSpeech(text);
      if (!cleaned) return;

      const utterance = new SpeechSynthesisUtterance(cleaned);
      utterance.rate = speechRate;
      utterance.pitch = 1.0;

      const allVoices = window.speechSynthesis.getVoices();
      let chosenVoice = allVoices.find((v) => v.name === selectedVoiceName) || null;
      if (!chosenVoice) {
        chosenVoice = getPreferredAuditorVoice();
      }
      if (chosenVoice) {
        utterance.voice = chosenVoice;
      }

      utterance.onstart = () => {
        setIsSpeaking(true);
        setCurrentlySpeakingMsgIndex(msgIndex ?? -1);
      };

      utterance.onend = () => {
        setIsSpeaking(false);
        setCurrentlySpeakingMsgIndex(null);
      };

      utterance.onerror = (e) => {
        console.warn("Speech synthesis error:", e);
        setIsSpeaking(false);
        setCurrentlySpeakingMsgIndex(null);
      };

      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.error("Speech synthesis failed:", e);
      setIsSpeaking(false);
      setCurrentlySpeakingMsgIndex(null);
    }
  };

  const stopSpeaking = () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
    setCurrentlySpeakingMsgIndex(null);
  };

  useEffect(() => {
    fetch("/api/clients", {
      headers: { "x-api-key": DEFAULT_API_KEY },
    })
      .then((r) => r.json())
      .then((d) => {
        const clientList = d.clients ?? [];
        setClients(clientList);
        if (clientList.length > 0) {
          setClientId(clientList[0].id);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch clients:", err);
      });

    fetch("/api/email/config")
      .then((r) => r.json())
      .then((d) => setSmtpConfigured(Boolean(d.configured)))
      .catch(() => { });

    fetch("/api/calendar/config")
      .then((r) => r.json())
      .then((d) => {
        setCalendarConfigured(Boolean(d.configured));
        setCalendarData(d);
        if (d.meetLink) setAuditorMeetLinkInput(d.meetLink);
      })
      .catch(() => { });
  }, []);

  useEffect(() => {
    setMessages([]);
    setRows([]);
    if (!clientId) return;

    fetch(`/api/financials?clientId=${clientId}`, {
      headers: { "x-api-key": DEFAULT_API_KEY },
    })
      .then((r) => r.json())
      .then((d) => {
        const finRows = d.financials ?? [];
        setRows(finRows);

        const currentClient = clients.find((c) => c.id === clientId);
        if (currentClient && finRows.length > 0) {
          triggerNotification({
            type: "audit",
            title: `Client Ledger: ${currentClient.name}`,
            message: `Loaded ${finRows.length} years of financial figures (Income, Profit, Loss). Ready for audit questions.`,
          });
        }
      })
      .catch((err) => {
        console.error("Failed to fetch financials:", err);
      });
  }, [clientId, clients]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  const client = clients.find((c) => c.id === clientId);
  const unreadCount = notifications.filter((n) => !n.read).length;

  const totalProfit = rows.reduce((acc, r) => acc + (Number(r.profit) || 0), 0);
  const totalLoss = rows.reduce((acc, r) => acc + (Number(r.loss) || 0), 0);
  const netProfit = totalProfit - totalLoss;
  const profitableYears = rows.filter((r) => Number(r.profit) > 0).length;
  const lossRows = rows.filter((r) => Number(r.loss) > 0);
  const highestProfitRow = rows.reduce<Row | null>((max, r) => {
    if (!max || (r.profit ?? 0) > (max.profit ?? 0)) return r;
    return max;
  }, null);

  const markAllRead = () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  const clearAllNotifications = () => {
    setNotifications([]);
    setActiveToast(null);
  };

  async function send(queryText?: string) {
    const text = (queryText ?? input).trim();
    if (!text || busy || !clientId) return;

    if (isListeningRef.current) {
      isListeningRef.current = false;
      setIsListening(false);
      setAudioVolume(0);
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch { }
        recognitionRef.current = null;
      }
      if (audioRecorderRef.current) {
        audioRecorderRef.current.stop().catch(() => { });
        audioRecorderRef.current = null;
      }
    }
    if (isSpeaking) stopSpeaking();

    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    if (!queryText) setInput("");
    setBusy(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": DEFAULT_API_KEY,
        },
        body: JSON.stringify({
          clientId,
          messages: next
            .filter((m) => !m.error)
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");

      const reply = data.reply;
      setMessages([...next, { role: "assistant", content: reply }]);

      // Auto-read response aloud if voice readout is enabled
      if (autoSpeak && isSpeechSynthesisSupported()) {
        speakText(reply, next.length);
      }

      // Check if a Google Meet was scheduled in the response
      const meetUrl = extractMeetUrl(reply);
      if (meetUrl) {
        triggerNotification({
          type: "meeting",
          title: "Google Meet Scheduled",
          message: `Consultation booked with ${client?.name || "Client"}. Attendees invited.`,
          link: meetUrl,
          linkText: "Join Google Meet",
        });
      }
    } catch (e: any) {
      setMessages([...next, { role: "assistant", content: e.message, error: true }]);
      triggerNotification({
        type: "system",
        title: "Audit Assistant Error",
        message: e.message || "Failed to process question",
      });
    } finally {
      setBusy(false);
    }
  }

  const promptSuggestions = [
    "What was the profit in 2021?",
    "Which year had the highest income?",
    "Did the client incur any loss in the 10 years?",
    "Audit and score our statutory consultation call with Sri",
    "Schedule a Google Meet about the 2020 loss review tomorrow at 3 PM",
    "Update the Google meeting in Google Calendar for all participants",
    "Add participant to the scheduled Google meeting",
  ];

  return (
    <div className="shell">
      {/* ---------- TOAST POPUP (TOP-RIGHT CORNER) ---------- */}
      <div className="toast-container">
        {activeToast && (
          <div className={`toast-popup ${activeToast.type}`} role="alert">
            <span className="toast-icon">
              {activeToast.type === "meeting"
                ? "📅"
                : activeToast.type === "audit"
                  ? "📑"
                  : "🔔"}
            </span>
            <div className="toast-content">
              <div className="toast-title">{activeToast.title}</div>
              <div className="toast-msg">{activeToast.message}</div>
              {activeToast.link && (
                <div className="toast-actions">
                  <a
                    href={activeToast.link}
                    target="_blank"
                    rel="noreferrer"
                    className="toast-btn"
                  >
                    📹 {activeToast.linkText || "Join Meeting"}
                  </a>
                </div>
              )}
            </div>
            <button
              className="toast-close"
              onClick={() => setActiveToast(null)}
              aria-label="Close notification"
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* ---------- SIDEBAR: AUDITOR & 10-YEAR LEDGER ---------- */}
      <aside className="ledger">
        {/* Auditor Profile Header */}
        <div className="auditor-badge-card">
          <div className="auditor-icon">CA</div>
          <div className="auditor-meta">
            <div className="auditor-title">CA Keerthiga Sri J.M.</div>
            <div className="auditor-sub">FCA-084920 · J.M. & Associates</div>
          </div>
        </div>

        <div className="brand">
          <div className="brand-title-row">
            <h1>Audit Desk</h1>
            <span className="brand-tag">RAG</span>
          </div>
          <p>Verified 10-year financial records & MCP Meet</p>
        </div>

        <div className="picker">
          <label htmlFor="client">Select Client Under Audit</label>
          <select
            id="client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          >
            {clients.length === 0 && <option value="">No clients available</option>}
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.email ? `(${c.email})` : ""}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "6px" }}>
            <Link
              href="/upload"
              style={{
                fontSize: "12px",
                color: "var(--accent, #b45309)",
                textDecoration: "none",
                fontWeight: 500,
              }}
            >
              ＋ Add a client or upload 10-year document
            </Link>
            <Link
              href="/docs"
              title="REST API Documentation & Portal"
              aria-label="REST API Documentation & Portal"
              style={{
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "22px",
                height: "22px",
                borderRadius: "50%",
                background: "rgba(22, 163, 74, 0.1)",
                border: "1px solid rgba(22, 163, 74, 0.25)",
                color: "#16a34a",
                fontSize: "12px",
                textDecoration: "none",
                lineHeight: 1,
                flexShrink: 0,
              }}
            >
              ⚡
            </Link>
          </div>
        </div>

        <div className="book">
          {rows.length === 0 ? (
            <div className="book-empty">
              {clientId
                ? "No financial figures found. Upload this client's 10-year document to populate the ledger."
                : "Select or add a client to view the 10-year audit ledger."}
            </div>
          ) : (
            <div className="finance-boxes-container">
              {/* TOP BOX: TOTAL PROFIT */}
              <div className="finance-box profit-box">
                <div className="finance-box-header">
                  <div className="finance-box-title-wrap">
                    <span className="finance-box-icon">📈</span>
                    <h3 className="finance-box-title">Total Profit</h3>
                  </div>
                  <span className="finance-box-tag">10-Year Gain</span>
                </div>

                <div className="finance-box-value">
                  +{Number(totalProfit.toFixed(2)).toLocaleString()}
                </div>

                <div className="finance-box-meta">
                  <div className="finance-meta-row">
                    <span>Profitable Years:</span>
                    <span className="strong">{profitableYears} of {rows.length} Years</span>
                  </div>
                  {highestProfitRow && (
                    <div className="finance-meta-row">
                      <span>Highest ({highestProfitRow.year}):</span>
                      <span className="strong">+{fmt(highestProfitRow.profit)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* 10-YR NET POSITION BANNER */}
              <div className="finance-net-banner">
                <span className="label">10-Yr Net Position</span>
                <span className="value">
                  {netProfit >= 0 ? `+${Number(netProfit.toFixed(2)).toLocaleString()}` : Number(netProfit.toFixed(2)).toLocaleString()}
                </span>
              </div>

              {/* BOTTOM BOX: TOTAL LOSS */}
              <div className="finance-box loss-box">
                <div className="finance-box-header">
                  <div className="finance-box-title-wrap">
                    <span className="finance-box-icon">📉</span>
                    <h3 className="finance-box-title">Total Loss</h3>
                  </div>
                  <span className="finance-box-tag">Risk & Deficit</span>
                </div>

                <div className="finance-box-value">
                  {Number(totalLoss.toFixed(2)).toLocaleString()}
                </div>

                <div className="finance-box-meta">
                  <div className="finance-meta-row">
                    <span>Loss Incurred:</span>
                    <span className="strong">
                      {lossRows.length > 0
                        ? `${lossRows.length} Year (${lossRows.map((l) => `${l.year}: ${fmt(l.loss)}`).join(", ")})`
                        : "0 Years (Nil Loss)"}
                    </span>
                  </div>
                  <div className="finance-meta-row">
                    <span>Audit Status:</span>
                    <span className="strong">
                      {totalLoss === 0 ? "100% Clean Records" : "Loss Accounted"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Collapsible Annual Ledger Records */}
              <div className="records-toggle-wrap">
                <button
                  type="button"
                  className="records-toggle-btn"
                  onClick={() => setShowRecords(!showRecords)}
                  aria-expanded={showRecords}
                >
                  {showRecords ? "▲ Hide Detailed Records" : "▼ View Detailed Records"}
                </button>

                {showRecords && (
                  <table className="book-table" style={{ marginTop: "10px" }}>
                    <thead>
                      <tr>
                        <th>Year</th>
                        <th>Income</th>
                        <th>Profit</th>
                        <th>Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.year}>
                          <td>{r.year}</td>
                          <td>{fmt(r.income)}</td>
                          <td className="profit">{fmt(r.profit)}</td>
                          <td className="loss">{fmt(r.loss)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <div className="book-note">
                10-year consecutive records audited by CA Keerthiga Sri J.M.
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* ---------- MAIN CHAT AREA ---------- */}
      <main className="chat">
        {/* Top Header with Notification Bell in the Right Corner */}
        <div className="chat-head">
          <div className="chat-head-info">
            <h2>
              {client ? client.name : "Select a Client"}
              {rows.length > 0 && (
                <span className="client-status-badge">
                  {rows.length} Years Audited
                </span>
              )}
            </h2>
            <p>Auditor: CA Keerthiga Sri J.M. · J.M. & Associates</p>
          </div>

          <div className="chat-head-actions">
            <Link
              href="/call-audit"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
                padding: "6px 13px",
                background: "linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
                color: "#ffffff",
                borderRadius: "8px",
                fontSize: "12.5px",
                fontWeight: 700,
                textDecoration: "none",
                boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                transition: "all 0.15s ease",
              }}
              title="Open Call Scoring and Quality Assurance Hub"
            >
              <span>🎙️</span>
              <span>Call Scoring & Audit</span>
            </Link>

            <div className="three-dot-menu-wrapper" ref={menuContainerRef}>
              <button
                type="button"
                className={`three-dot-trigger-btn ${showMenu ? "active" : ""}`}
                onClick={() => setShowMenu(!showMenu)}
                title="Options, Integrations & Notifications"
                aria-label="Options, Integrations & Notifications"
                aria-expanded={showMenu}
              >
                <span className="three-dot-icon">⋮</span>
                {unreadCount > 0 && (
                  <span className="three-dot-badge-pill">{unreadCount}</span>
                )}
              </button>

              {showMenu && (
                <div className="three-dot-dropdown-menu" role="menu">
                  {/* Call Scoring & QA Hub Option */}
                  <Link
                    href="/call-audit"
                    className="three-dot-menu-item"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="menu-item-icon" style={{ color: "#2563eb" }}>🎙️</div>
                    <div className="menu-item-text">
                      <div className="menu-item-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>Call Scoring & Audit Hub</span>
                        <span style={{ fontSize: "10px", background: "#dbeafe", color: "#1e40af", padding: "1px 6px", borderRadius: "4px", fontWeight: 700 }}>NEW</span>
                      </div>
                      <div className="menu-item-desc">ICAI compliance, audio scoring & QA certificates</div>
                    </div>
                  </Link>

                  <div className="three-dot-menu-divider" />

                  {/* Notifications Option */}
                  <button
                    type="button"
                    className="three-dot-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setShowNotifCenter(!showNotifCenter);
                      setShowMenu(false);
                      if (!showNotifCenter && unreadCount > 0) markAllRead();
                    }}
                  >
                    <div className="menu-item-icon">🔔</div>
                    <div className="menu-item-text">
                      <div className="menu-item-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>Notifications</span>
                        {unreadCount > 0 && (
                          <span className="menu-item-badge">{unreadCount} new</span>
                        )}
                      </div>
                      <div className="menu-item-desc">
                        {unreadCount > 0
                          ? `${unreadCount} unread update${unreadCount > 1 ? "s" : ""}`
                          : `${notifications.length} notification${notifications.length === 1 ? "" : "s"}`}
                      </div>
                    </div>
                  </button>

                  <div className="three-dot-menu-divider" />

                  {/* Google Calendar & Email Sync Option */}
                  <button
                    type="button"
                    className="three-dot-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setIntegrationTab("calendar");
                      setShowIntegrationModal(true);
                      setShowMenu(false);
                    }}
                  >
                    <div className="menu-item-icon">📅</div>
                    <div className="menu-item-text">
                      <div className="menu-item-title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <span>Calendar & Email</span>
                        <span
                          className={`header-combo-dot ${
                            calendarConfigured && smtpConfigured
                              ? "green"
                              : calendarConfigured || smtpConfigured
                              ? "amber"
                              : "red"
                          }`}
                          style={{ display: "inline-block", position: "static", transform: "none" }}
                        />
                      </div>
                      <div className="menu-item-desc">
                        {calendarConfigured ? "Calendar Synced ✓" : "Calendar Setup"} · {smtpConfigured ? "Email Active ✓" : "Email Setup"}
                      </div>
                    </div>
                  </button>

                  {/* API Key Modal Option */}
                  <button
                    type="button"
                    className="three-dot-menu-item"
                    role="menuitem"
                    onClick={() => {
                      setShowApiKeyModal(true);
                      setShowMenu(false);
                    }}
                  >
                    <div className="menu-item-icon">🔑</div>
                    <div className="menu-item-text">
                      <div className="menu-item-title">API Keys & Tokens</div>
                      <div className="menu-item-desc">View and manage master API keys</div>
                    </div>
                  </button>

                  {/* REST API Documentation Option */}
                  <Link
                    href="/docs"
                    className="three-dot-menu-item"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="menu-item-icon" style={{ color: "#16a34a" }}>⚡</div>
                    <div className="menu-item-text">
                      <div className="menu-item-title">REST API Portal</div>
                      <div className="menu-item-desc">Interactive endpoint tester & docs</div>
                    </div>
                  </Link>

                  <div className="three-dot-menu-divider" />

                  {/* Clients & Documents Page Option */}
                  <Link
                    href="/upload"
                    className="three-dot-menu-item"
                    role="menuitem"
                    onClick={() => setShowMenu(false)}
                    style={{ textDecoration: "none", color: "inherit" }}
                  >
                    <div className="menu-item-icon">📑</div>
                    <div className="menu-item-text">
                      <div className="menu-item-title">Clients & Documents</div>
                      <div className="menu-item-desc">Upload 10-year Excel / CSV audit sheets</div>
                    </div>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---------- NOTIFICATION CENTER (RIGHT CORNER PANEL) ---------- */}
        {showNotifCenter && (
          <div className="notif-center-panel" role="dialog" aria-label="Notification Center">
            <div className="notif-header">
              <h3>
                Notification Center
                {unreadCount > 0 && (
                  <span className="notif-count-chip">{unreadCount} new</span>
                )}
              </h3>
              <div className="notif-header-actions">
                {notifications.length > 0 && (
                  <button className="notif-clear-btn" onClick={clearAllNotifications}>
                    Clear all
                  </button>
                )}
                <button
                  className="notif-close-btn"
                  onClick={() => setShowNotifCenter(false)}
                  aria-label="Close Notification Center"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="notif-list">
              {notifications.length === 0 ? (
                <div className="notif-empty">No notifications yet</div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`notif-card ${n.type} ${n.read ? "read" : "unread"}`}
                  >
                    <div className="notif-card-icon">
                      {n.type === "meeting"
                        ? "📅"
                        : n.type === "audit"
                          ? "📑"
                          : "ℹ️"}
                    </div>
                    <div className="notif-card-body">
                      <div className="notif-card-title">{n.title}</div>
                      <div className="notif-card-msg">{n.message}</div>
                      <div className="notif-card-footer">
                        <span className="notif-card-time">{n.timestamp}</span>
                        {n.link && (
                          <a
                            href={n.link}
                            target="_blank"
                            rel="noreferrer"
                            className="notif-card-btn"
                          >
                            📹 {n.linkText || "Join"}
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Message Thread */}
        <div className="thread" aria-live="polite">
          {messages.length === 0 && (
            <div className="hint">
              <p>
                <strong>Audit Assistant Ready.</strong> Ask any specific question
                about this client's 10-year income, profit, or loss document:
              </p>
              <ul>
                <li>"What was the profit in 2021?"</li>
                <li>"What is the total income over the 10 years?"</li>
                <li>"Which year had the lowest income or incurred a loss?"</li>
                <li>
                  "Schedule a Google Meet about the audit review tomorrow at 4 PM"
                </li>
              </ul>
            </div>
          )}

          {messages.map((m, i) => (
            <div
              key={i}
              className={`msg ${m.error ? "error" : m.role === "user" ? "user" : "bot"
                }`}
            >
              {m.role === "assistant" && !m.error ? (
                <>
                  <ChatMessageContent
                    text={m.content}
                    onNotify={triggerNotification}
                    onOpenEmailSetup={() => setShowEmailModal(true)}
                  />
                  <div className="msg-voice-footer">
                    <button
                      type="button"
                      className={`msg-speak-btn ${isSpeaking && currentlySpeakingMsgIndex === i ? "speaking" : ""
                        }`}
                      onClick={() => {
                        if (isSpeaking && currentlySpeakingMsgIndex === i) {
                          stopSpeaking();
                        } else {
                          speakText(m.content, i);
                        }
                      }}
                      title={
                        isSpeaking && currentlySpeakingMsgIndex === i
                          ? "Stop voice playback"
                          : "Read this audit response aloud"
                      }
                      aria-label="Read response aloud"
                    >
                      {isSpeaking && currentlySpeakingMsgIndex === i ? (
                        <>
                          <span className="soundwave-anim green" style={{ height: 10 }}>
                            <span />
                            <span />
                            <span />
                          </span>
                          <span>⏹ Stop Voice</span>
                        </>
                      ) : (
                        <span>🔊 Read Aloud</span>
                      )}
                    </button>
                  </div>
                </>
              ) : (
                m.content
              )}
            </div>
          ))}

          {busy && (
            <div className="msg bot" aria-label="Assistant is analyzing audit records">
              <span className="typing">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Quick Suggestion Chips */}
        <div className="prompt-chips-bar">
          <span className="prompt-chips-label">Quick Prompts:</span>
          {promptSuggestions.map((prompt, idx) => (
            <button
              key={idx}
              className="prompt-chip"
              disabled={busy || !clientId}
              onClick={() => send(prompt)}
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Active Voice Bar (Listening, Transcribing or Speaking indicator) */}
        {(isListening || isSpeaking || isTranscribing) && (
          <div className={`voice-status-bar ${isListening ? "listening" : isTranscribing ? "transcribing" : "speaking"}`}>
            {isTranscribing ? (
              <div className="voice-status-inner">
                <span className="voice-status-icon">⚡</span>
                <span className="voice-status-text">
                  Transcribing your voice with Local AI & running NLP...
                </span>
                <span className="soundwave-anim green">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
              </div>
            ) : isListening ? (
              <div className="voice-status-inner">
                <span className="voice-status-icon">🎙️</span>
                <span className="voice-status-text">
                  {micStatusText || (audioVolume > 15 ? "Voice detected! Listening..." : "Listening... Speak clearly into your microphone.")}
                </span>
                <span className={`soundwave-anim ${audioVolume > 15 ? "active-vol" : "idle-vol"}`}>
                  <span style={{ transform: `scaleY(${Math.max(0.2, (audioVolume / 100) * 1.5)})` }} />
                  <span style={{ transform: `scaleY(${Math.max(0.3, (audioVolume / 100) * 2.2)})` }} />
                  <span style={{ transform: `scaleY(${Math.max(0.25, (audioVolume / 100) * 1.8)})` }} />
                  <span style={{ transform: `scaleY(${Math.max(0.4, (audioVolume / 100) * 2.5)})` }} />
                </span>
                <button
                  type="button"
                  className="voice-bar-stop-btn"
                  onClick={stopListening}
                >
                  ⏹ Done Speaking & Submit
                </button>
              </div>
            ) : (
              <div className="voice-status-inner">
                <span className="voice-status-icon">🔊</span>
                <span className="voice-status-text">
                  CA Keerthiga Sri J.M. is reading out the audit answer...
                </span>
                <span className="soundwave-anim green">
                  <span />
                  <span />
                  <span />
                  <span />
                </span>
                <button
                  type="button"
                  className="voice-bar-stop-btn"
                  onClick={stopSpeaking}
                >
                  ⏹ Stop Voice
                </button>
              </div>
            )}
          </div>
        )}

        {/* Composer */}
        <div className="composer">
          <div className="composer-input-wrap">
            <textarea
              value={input}
              rows={1}
              placeholder={
                isTranscribing
                  ? "⚡ Transcribing your voice with Local AI..."
                  : isListening
                    ? "🎙️ Listening... Speak your audit question now..."
                    : clientId
                      ? `Ask about ${client?.name || "client"}'s 10-year audit records or schedule a Google Meet...`
                      : "Select a client first"
              }
              disabled={!clientId}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
          </div>

          <div className="composer-actions">
            {/* Microphone Button */}
            <button
              type="button"
              className={`composer-tool-btn mic-btn ${isListening ? "active" : ""}`}
              onClick={isListening ? stopListening : startListening}
              disabled={!clientId || busy}
              title={
                isListening
                  ? "Listening... Click to finish speaking"
                  : "Voice Input: Click to speak your question"
              }
              aria-label="Voice input microphone"
            >
              {isListening ? "⏹️" : "🎙️"}
            </button>

            {/* Auto-Read Toggle Button */}
            <button
              type="button"
              className={`composer-tool-btn tts-toggle-btn ${autoSpeak ? "active" : ""}`}
              onClick={() => {
                const nextState = !autoSpeak;
                setAutoSpeak(nextState);
                if (!nextState && isSpeaking) stopSpeaking();
              }}
              title={
                autoSpeak
                  ? "Auto Voice Readout: ON (Replies read aloud automatically)"
                  : "Auto Voice Readout: OFF (Default: Click 'Read Aloud' on messages to listen)"
              }
              aria-label="Toggle auto voice readout"
            >
              {autoSpeak ? "🔊" : "🔇"}
            </button>

            {/* Send Button */}
            <button
              className="btn"
              onClick={() => send()}
              disabled={busy || !input.trim() || !clientId}
            >
              Send
            </button>
          </div>
        </div>

        {/* ---------- API KEY MODAL ---------- */}
        {showApiKeyModal && (
          <div className="email-modal-overlay" onClick={() => setShowApiKeyModal(false)}>
            <div
              className="email-modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 500 }}
            >
              <div className="email-modal-header">
                <h3>
                  <span>🔑</span> Master API Key & Integration
                </h3>
                <button
                  type="button"
                  className="email-modal-close"
                  onClick={() => setShowApiKeyModal(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="email-modal-body" style={{ padding: "20px 22px", display: "flex", flexDirection: "column", gap: "14px" }}>
                <p className="email-modal-desc" style={{ margin: 0, fontSize: "13.5px", color: "#334155" }}>
                  Use this Master API Key to connect external frontends, Python backends, or bots to this CA Audit Chatbot.
                </p>

                <div className="email-input-group">
                  <label style={{ fontSize: "12.5px", fontWeight: 600, color: "#1e293b" }}>
                    Active Master API Key:
                  </label>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input
                      type="text"
                      readOnly
                      value="ca_live_541c806cb70ae18dab3721e1e6740c5b"
                      className="email-app-pass-input"
                      style={{ fontSize: "13px", padding: "8px 10px", margin: 0 }}
                    />
                    <button
                      type="button"
                      className="email-save-btn"
                      onClick={() => {
                        navigator.clipboard.writeText("ca_live_541c806cb70ae18dab3721e1e6740c5b");
                        setCopiedKey(true);
                        setTimeout(() => setCopiedKey(false), 2000);
                      }}
                      style={{ whiteSpace: "nowrap", padding: "8px 14px" }}
                    >
                      {copiedKey ? "Copied! ✓" : "📋 Copy"}
                    </button>
                  </div>
                </div>

                <div
                  className="email-steps-box"
                  style={{
                    background: "#f8fafc",
                    borderColor: "#e2e8f0",
                    color: "#334155",
                    padding: "12px 14px",
                    borderRadius: "8px",
                  }}
                >
                  <strong style={{ display: "block", marginBottom: "4px" }}>HTTP Request Header:</strong>
                  <div
                    style={{
                      fontFamily: "monospace",
                      fontSize: "12px",
                      background: "#ffffff",
                      padding: "8px 10px",
                      borderRadius: "6px",
                      border: "1px solid #cbd5e1",
                    }}
                  >
                    X-API-Key: ca_live_541c806cb70ae18dab3721e1e6740c5b
                  </div>
                  <div style={{ marginTop: "8px", fontSize: "12px", color: "#64748b" }}>
                    Universal Single Endpoint: <code>POST /api/agent</code>
                  </div>
                </div>

                <div
                  className="email-modal-actions"
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginTop: "6px",
                  }}
                >
                  <Link
                    href="/docs"
                    onClick={() => setShowApiKeyModal(false)}
                    style={{
                      fontSize: "13px",
                      color: "#16a34a",
                      fontWeight: 600,
                      textDecoration: "none",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "4px",
                    }}
                  >
                    <span>⚡</span> Open Full Developer Docs & Test Console →
                  </Link>
                  <button
                    type="button"
                    className="email-cancel-btn"
                    onClick={() => setShowApiKeyModal(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ---------- UNIFIED CALENDAR & EMAIL SETUP MODAL ---------- */}
        {showIntegrationModal && (
          <div className="email-modal-overlay" onClick={() => setShowIntegrationModal(false)}>
            <div className="email-modal-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 540 }}>
              <div className="email-modal-header">
                <h3>⚡ Calendar & Email Connection Setup</h3>
                <button
                  type="button"
                  className="email-modal-close"
                  onClick={() => setShowIntegrationModal(false)}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              {/* TABS */}
              <div className="integration-tabs">
                <button
                  type="button"
                  className={`integration-tab-btn ${integrationTab === "calendar" ? "active" : ""}`}
                  onClick={() => setIntegrationTab("calendar")}
                >
                  <span>📅</span> Google Calendar
                  <span className={`tab-status-pill ${calendarConfigured ? "active" : "pending"}`}>
                    {calendarConfigured ? "Synced" : "Setup"}
                  </span>
                </button>
                <button
                  type="button"
                  className={`integration-tab-btn ${integrationTab === "email" ? "active" : ""}`}
                  onClick={() => setIntegrationTab("email")}
                >
                  <span>✉️</span> Email Dispatch (SMTP)
                  <span className={`tab-status-pill ${smtpConfigured ? "active" : "pending"}`}>
                    {smtpConfigured ? "Active" : "Setup"}
                  </span>
                </button>
                <button
                  type="button"
                  className={`integration-tab-btn ${integrationTab === "voice" ? "active" : ""}`}
                  onClick={() => setIntegrationTab("voice")}
                >
                  <span>🎙️</span> Voice Assistant
                  <span className={`tab-status-pill ${autoSpeak ? "active" : "pending"}`}>
                    {autoSpeak ? "Voice ON" : "Muted"}
                  </span>
                </button>
              </div>

              <div className="email-modal-body">
                {integrationTab === "calendar" ? (
                  <>
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      <div
                        style={{
                          background: "#f0fdf4",
                          border: "1px solid #bbf7d0",
                          borderRadius: "8px",
                          padding: "12px 14px",
                          fontSize: "13px",
                          color: "#166534",
                          lineHeight: "1.5",
                        }}
                      >
                        <strong>✓ Automatic Email Calendar Sync Active</strong>
                        <div style={{ marginTop: "4px", color: "#1e3a24", fontSize: "12.5px" }}>
                          When meetings are scheduled, an RFC 5545 iCalendar request is automatically dispatched via email. Google Mail automatically registers the event directly onto your Google Calendar and all attendee calendars with RSVP options.
                        </div>
                      </div>

                      <div
                        style={{
                          background: calendarConfigured ? "#f0fdf4" : "#f8fafc",
                          border: `1px solid ${calendarConfigured ? "#bbf7d0" : "#e2e8f0"}`,
                          borderRadius: "8px",
                          padding: "12px 14px",
                          fontSize: "13px",
                          lineHeight: "1.5",
                        }}
                      >
                        <div style={{ fontWeight: 600, color: calendarConfigured ? "#15803d" : "#334155" }}>
                          {calendarConfigured ? "🟢 Direct Google Calendar API: Active" : "ℹ️ Direct Google Calendar API: Ready to Authorize"}
                        </div>
                        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "4px" }}>
                          Connected Account: <strong>{calendarData?.emailAccount || "keerthigasri04@gmail.com"}</strong>
                        </div>
                      </div>
                    </div>

                    {/* 1-Click Connect Button */}
                    <div style={{ margin: "14px 0 6px 0" }}>
                      <button
                        type="button"
                        className="email-save-btn"
                        style={{
                          width: "100%",
                          padding: "13px",
                          fontSize: "14px",
                          fontWeight: 700,
                          background: calendarConfigured ? "#15803d" : "#2563eb",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: "8px",
                          borderRadius: "8px",
                          cursor: connectingCalendar ? "wait" : "pointer",
                          boxShadow: "0 2px 8px rgba(37,99,235,0.25)",
                        }}
                        disabled={connectingCalendar}
                        onClick={handleConnectCalendar}
                      >
                        <span>{calendarConfigured ? "🟢" : "🔗"}</span>
                        {connectingCalendar
                          ? "⏳ Waiting for Google Sign-In in browser..."
                          : calendarConfigured
                            ? "✓ Google Calendar is Connected & Syncing"
                            : "1-Click Connect Google Calendar"}
                      </button>
                      <p style={{ fontSize: "12px", color: "#64748b", margin: "6px 0 0", textAlign: "center" }}>
                        {calendarConfigured
                          ? "Direct API synchronization is active. Scheduled meetings are added to your Google Calendar automatically."
                          : "Click to open Google sign-in. Once you allow access, your calendar is linked automatically!"}
                      </p>
                    </div>

                    <div className="email-input-group" style={{ marginTop: "14px" }}>
                      <label htmlFor="auditor-meet-input" style={{ fontSize: "12.5px" }}>
                        Google Meet Meeting Link:
                      </label>
                      <input
                        id="auditor-meet-input"
                        type="text"
                        placeholder="https://meet.google.com/new (or https://meet.google.com/xxx-yyyy-zzz)"
                        value={auditorMeetLinkInput}
                        onChange={(e) => setAuditorMeetLinkInput(e.target.value)}
                        className="email-app-pass-input"
                      />
                      <span style={{ fontSize: "11px", color: "#64748b" }}>
                        Default is <code>https://meet.google.com/new</code>. You can also paste your permanent room link (format: <code>https://meet.google.com/xxx-yyyy-zzz</code>).
                      </span>
                    </div>

                    <div className="email-input-group" style={{ marginTop: "14px" }}>
                      <label htmlFor="calendar-refresh-input" style={{ fontSize: "12.5px" }}>
                        Or paste Google OAuth Refresh Token manually:
                      </label>
                      <input
                        id="calendar-refresh-input"
                        type="password"
                        placeholder="1//04... (OAuth Refresh Token)"
                        value={calendarRefreshToken}
                        onChange={(e) => setCalendarRefreshToken(e.target.value)}
                        className="email-app-pass-input"
                      />
                    </div>

                    {calendarFeedback && (
                      <div className={`email-feedback-box ${calendarFeedback.type}`}>
                        {calendarFeedback.type === "success" ? "✓ " : "⚠️ "}
                        {calendarFeedback.text}
                      </div>
                    )}

                    <div className="email-modal-actions">
                      <button
                        type="button"
                        className="email-save-btn"
                        disabled={savingCalendar}
                        onClick={async () => {
                          setSavingCalendar(true);
                          setCalendarFeedback(null);
                          try {
                            const payload: Record<string, string> = {};
                            if (calendarRefreshToken.trim()) payload.refreshToken = calendarRefreshToken.trim();
                            if (auditorMeetLinkInput.trim()) payload.meetLink = auditorMeetLinkInput.trim();

                            const res = await fetch("/api/calendar/config", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify(payload),
                            });
                            const data = await res.json();
                            if (data.success) {
                              setCalendarConfigured(Boolean(data.configured));
                              setCalendarFeedback({ type: "success", text: "Settings saved successfully!" });
                              triggerNotification({
                                type: "success",
                                title: "Settings Saved",
                                message: "Google Calendar & Meet settings updated.",
                              });
                              setTimeout(() => setShowIntegrationModal(false), 1400);
                            } else {
                              setCalendarFeedback({
                                type: "error",
                                text: data.error || "Failed to update calendar configuration.",
                              });
                            }
                          } catch (err: any) {
                            setCalendarFeedback({
                              type: "error",
                              text: err?.message || "Failed to communicate with server.",
                            });
                          } finally {
                            setSavingCalendar(false);
                          }
                        }}
                      >
                        {savingCalendar ? "Saving..." : "Save Settings"}
                      </button>
                      <button
                        type="button"
                        className="email-cancel-btn"
                        onClick={() => setShowIntegrationModal(false)}
                      >
                        Close
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="email-modal-desc">
                      To automatically dispatch meeting invitations with the Google Meet link in the background to all attendee inboxes (without opening your email client), configure your 16-character <strong>Gmail App Password</strong> for <code>keerthigasrijm@gmail.com</code>.
                    </p>

                    <div className="email-steps-box">
                      <strong>30-Second Guide to get your Google App Password:</strong>
                      <ol>
                        <li>
                          Go to{" "}
                          <a
                            href="https://myaccount.google.com/apppasswords"
                            target="_blank"
                            rel="noreferrer"
                            className="email-step-link"
                          >
                            Google Account App Passwords ↗
                          </a>{" "}
                          (Ensure 2-Step Verification is ON).
                        </li>
                        <li>
                          Name the app: <em>CA Audit Chatbot</em> and click <strong>Create</strong>.
                        </li>
                        <li>Copy the 16-character code (e.g. <code>abcd efgh ijkl mnop</code>) and paste it below.</li>
                      </ol>
                    </div>

                    <div className="email-input-group">
                      <label htmlFor="app-pass-input">
                        16-Character Gmail App Password:
                      </label>
                      <input
                        id="app-pass-input"
                        type="password"
                        placeholder="e.g. abcd efgh ijkl mnop"
                        value={smtpPasswordInput}
                        onChange={(e) => setSmtpPasswordInput(e.target.value)}
                        className="email-app-pass-input"
                        autoFocus
                      />
                    </div>

                    {smtpFeedback && (
                      <div className={`email-feedback-box ${smtpFeedback.type}`}>
                        {smtpFeedback.type === "success" ? "✓ " : "⚠️ "}
                        {smtpFeedback.text}
                      </div>
                    )}

                    <div className="email-modal-actions">
                      <button
                        type="button"
                        className="email-save-btn"
                        disabled={savingSmtp || !smtpPasswordInput.trim()}
                        onClick={async () => {
                          setSavingSmtp(true);
                          setSmtpFeedback(null);
                          try {
                            const res = await fetch("/api/email/config", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ smtpPass: smtpPasswordInput.trim() }),
                            });
                            const data = await res.json();
                            if (data.success) {
                              setSmtpConfigured(true);
                              setSmtpFeedback({ type: "success", text: data.message });
                              triggerNotification({
                                type: "success",
                                title: "Automated Email Active",
                                message: "Gmail SMTP configured! Invitations will now be sent automatically in the background.",
                              });
                              setTimeout(() => setShowIntegrationModal(false), 1400);
                            } else {
                              setSmtpFeedback({
                                type: "error",
                                text: data.error || "Failed to verify password with Gmail.",
                              });
                            }
                          } catch (err: any) {
                            setSmtpFeedback({
                              type: "error",
                              text: err?.message || "Failed to communicate with server.",
                            });
                          } finally {
                            setSavingSmtp(false);
                          }
                        }}
                      >
                        {savingSmtp ? "Verifying with Google..." : "Save & Activate Automated Email"}
                      </button>
                      <button
                        type="button"
                        className="email-cancel-btn"
                        onClick={() => setShowIntegrationModal(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </>
                )}

                {integrationTab === "voice" && (
                  <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                    <div
                      style={{
                        background: "#f0fdf4",
                        border: "1px solid #bbf7d0",
                        borderRadius: "8px",
                        padding: "12px 14px",
                        fontSize: "13px",
                        color: "#166534",
                        lineHeight: "1.45",
                      }}
                    >
                      <strong>🎙️ AI Voice Assistant Active:</strong> Speak financial audit queries hands-free via your microphone and listen to CA Keerthiga Sri J.M.'s spoken audit answers.
                    </div>

                    <div className="email-config-field">
                      <label style={{ display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
                        <span style={{ fontWeight: 600, color: "#1e293b" }}>Auto-Read Answers Aloud:</span>
                        <input
                          type="checkbox"
                          checked={autoSpeak}
                          onChange={(e) => {
                            setAutoSpeak(e.target.checked);
                            if (!e.target.checked && isSpeaking) stopSpeaking();
                          }}
                          style={{ width: "18px", height: "18px", cursor: "pointer", accentColor: "#16a34a" }}
                        />
                      </label>
                      <div className="email-help-text" style={{ marginTop: "4px" }}>
                        Off by default. When disabled, responses remain silent until you click the &ldquo;🔊 Read Aloud&rdquo; button under a message.
                      </div>
                    </div>

                    <div className="email-config-field">
                      <label style={{ fontWeight: 600, color: "#1e293b" }}>Auditor Voice Character & Accent:</label>
                      <select
                        value={selectedVoiceName}
                        onChange={(e) => setSelectedVoiceName(e.target.value)}
                        className="email-app-pass-input"
                        style={{ cursor: "pointer", width: "100%", padding: "8px 10px", borderRadius: "6px" }}
                      >
                        {voices.length === 0 ? (
                          <option value="">Default Browser Voice</option>
                        ) : (
                          voices.map((v, idx) => (
                            <option key={idx} value={v.name}>
                              {v.name} ({v.lang})
                            </option>
                          ))
                        )}
                      </select>
                      <div className="email-help-text">
                        Automatically prefers Indian English (en-IN) voices matching CA Keerthiga Sri J.M.'s firm persona.
                      </div>
                    </div>

                    <div className="email-config-field">
                      <label style={{ display: "flex", justifyContent: "space-between", fontWeight: 600, color: "#1e293b" }}>
                        <span>Speech Speed / Rate:</span>
                        <span style={{ fontWeight: 700, color: "#166534" }}>{speechRate}x</span>
                      </label>
                      <input
                        type="range"
                        min="0.75"
                        max="1.35"
                        step="0.05"
                        value={speechRate}
                        onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                        style={{ width: "100%", accentColor: "#16a34a", cursor: "pointer" }}
                      />
                    </div>

                    <div className="email-modal-actions" style={{ justifyContent: "space-between", marginTop: "10px" }}>
                      <button
                        type="button"
                        className="email-cancel-btn"
                        onClick={() => {
                          speakText(
                            "Greetings. I am CA Keerthiga Sri J.M. from J.M. and Associates. I have verified your ten-year financial statements."
                          );
                        }}
                      >
                        <span>🔊 Test Auditor Voice</span>
                      </button>

                      <button
                        type="button"
                        className="email-save-btn"
                        onClick={() => setShowIntegrationModal(false)}
                      >
                        Done
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
