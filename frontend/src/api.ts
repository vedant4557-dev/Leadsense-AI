import type { Lead } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export async function fetchLeads(params?: {
  category?: string;
  intent?: string;
  search?: string;
}): Promise<Lead[]> {
  const q = new URLSearchParams();
  if (params?.category) q.set("category", params.category);
  if (params?.intent) q.set("intent", params.intent);
  if (params?.search) q.set("search", params.search);

  const res = await fetch(`${API_BASE}/get-leads?${q.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch leads");
  return res.json();
}

export async function fetchTopHot(): Promise<Lead[]> {
  const res = await fetch(`${API_BASE}/dashboard/top-hot`);
  if (!res.ok) throw new Error("Failed to fetch top hot leads");
  return res.json();
}

export async function fetchDailyPriority(): Promise<Lead[]> {
  const res = await fetch(`${API_BASE}/dashboard/daily-priority`);
  if (!res.ok) throw new Error("Failed to fetch daily priority leads");
  return res.json();
}

export async function createLead(payload: Partial<Lead>): Promise<Lead> {
  const res = await fetch(`${API_BASE}/add-lead`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error("Failed to create lead");
  return res.json();
}

export async function uploadCsv(file: File): Promise<Lead[]> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${API_BASE}/leads/upload-csv`, {
    method: "POST",
    body: form
  });
  if (!res.ok) throw new Error("Failed to upload CSV");
  return res.json();
}

export async function sendAiMessage(leadId: number): Promise<Lead> {
  const res = await fetch(`${API_BASE}/leads/${leadId}/send-ai-message`, {
    method: "POST"
  });
  if (!res.ok) throw new Error("Failed to send AI message");
  return res.json();
}
