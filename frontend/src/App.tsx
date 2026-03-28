import React, { useEffect, useMemo, useState } from "react";
import type { Lead } from "./types";
import {
  fetchLeads,
  fetchTopHot,
  fetchDailyPriority,
  createLead,
  uploadCsv,
  sendAiMessage
} from "./api";

type FilterState = {
  category: "" | "Hot" | "Warm" | "Cold";
  intent: "" | "High" | "Medium" | "Low";
  search: string;
};

const intentColor = (intent?: string) => {
  switch (intent) {
    case "High":
      return "bg-green-100 text-green-800";
    case "Medium":
      return "bg-yellow-100 text-yellow-800";
    case "Low":
      return "bg-red-100 text-red-800";
    default:
      return "bg-slate-100 text-slate-700";
  }
};

const categoryDot = (cat: string) => {
  if (cat === "Hot") return "bg-red-500";
  if (cat === "Warm") return "bg-yellow-400";
  return "bg-slate-400";
};

const App: React.FC = () => {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [topHot, setTopHot] = useState<Lead[]>([]);
  const [dailyPriority, setDailyPriority] = useState<Lead[]>([]);
  const [filters, setFilters] = useState<FilterState>({
    category: "",
    intent: "",
    search: ""
  });
  const [loading, setLoading] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [csvUploading, setCsvUploading] = useState(false);
  const [creatingLead, setCreatingLead] = useState(false);

  // form state for manual lead entry
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    budget_min: "",
    budget_max: "",
    preferred_location: "",
    property_type: "",
    source: "",
    number_of_property_views: "0",
    time_spent_on_site: "0",
    repeat_visits: "0",
    last_response_time_hours: "",
    saved_properties_count: "0",
    random_location_browsing: "false",
    notes: ""
  });

  const loadAll = async () => {
    setLoading(true);
    try {
      const [all, hot, priority] = await Promise.all([
        fetchLeads({
          category: filters.category || undefined,
          intent: filters.intent || undefined,
          search: filters.search || undefined
        }),
        fetchTopHot(),
        fetchDailyPriority()
      ]);
      setLeads(all);
      setTopHot(hot);
      setDailyPriority(priority);
    } catch (e) {
      console.error(e);
      alert("Failed to load leads");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.category, filters.intent]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadAll();
  };

  const handleCsvChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setCsvUploading(true);
    try {
      await uploadCsv(file);
      await loadAll();
      alert("CSV uploaded and leads created");
      e.target.value = "";
    } catch (err) {
      console.error(err);
      alert("Failed to upload CSV");
    } finally {
      setCsvUploading(false);
    }
  };

  const handleCreateLead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      alert("Name is required");
      return;
    }
    setCreatingLead(true);
    try {
      const payload = {
        name: form.name,
        email: form.email || undefined,
        phone: form.phone || undefined,
        budget_min: form.budget_min ? Number(form.budget_min) : undefined,
        budget_max: form.budget_max ? Number(form.budget_max) : undefined,
        preferred_location: form.preferred_location || undefined,
        property_type: form.property_type || undefined,
        source: form.source || undefined,
        number_of_property_views: Number(form.number_of_property_views || 0),
        time_spent_on_site: Number(form.time_spent_on_site || 0),
        repeat_visits: Number(form.repeat_visits || 0),
        last_response_time_hours: form.last_response_time_hours
          ? Number(form.last_response_time_hours)
          : undefined,
        saved_properties_count: Number(form.saved_properties_count || 0),
        random_location_browsing: form.random_location_browsing === "true",
        notes: form.notes
      };
      const created = await createLead(payload);
      setLeads(prev => [created, ...prev]);
      setTopHot(prev => [created, ...prev].sort((a, b) => b.lead_score - a.lead_score).slice(0, 10));
      alert("Lead created and scored");
      setForm({
        name: "",
        email: "",
        phone: "",
        budget_min: "",
        budget_max: "",
        preferred_location: "",
        property_type: "",
        source: "",
        number_of_property_views: "0",
        time_spent_on_site: "0",
        repeat_visits: "0",
        last_response_time_hours: "",
        saved_properties_count: "0",
        random_location_browsing: "false",
        notes: ""
      });
    } catch (err) {
      console.error(err);
      alert("Failed to create lead");
    } finally {
      setCreatingLead(false);
    }
  };

  const handleSendAiMessage = async (lead: Lead) => {
    setSendingMessage(true);
    try {
      const updated = await sendAiMessage(lead.id);
      setLeads(prev => prev.map(l => (l.id === updated.id ? updated : l)));
      setSelectedLead(updated);
      alert("AI message generated (simulation only)");
    } catch (err) {
      console.error(err);
      alert("Failed to generate AI message");
    } finally {
      setSendingMessage(false);
    }
  };

  const kpi = useMemo(() => {
    const total = leads.length;
    const hot = leads.filter(l => l.lead_category === "Hot").length;
    const warm = leads.filter(l => l.lead_category === "Warm").length;
    const cold = leads.filter(l => l.lead_category === "Cold").length;
    return { total, hot, warm, cold };
  }, [leads]);

  return (
    <div className="min-h-screen bg-bg text-slate-900">
      <header className="border-b border-slate-200 bg-surface">
        <div className="mx-auto max-w-7xl px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center text-white text-xs font-semibold">
              LS
            </div>
            <div>
              <h1 className="text-lg font-semibold">LeadSense AI</h1>
              <p className="text-xs text-slate-500">
                Real Estate Lead Scoring & Conversion Engine
              </p>
            </div>
          </div>
          <div className="text-xs text-slate-500">
            Daily Priority · Focus on leads most likely to convert
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-6 space-y-6">
        {/* Top section: KPIs + Daily Priority */}
        <section className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Leads" value={kpi.total} />
              <KpiCard label="Hot" value={kpi.hot} accent="bg-red-50 text-red-700" />
              <KpiCard label="Warm" value={kpi.warm} accent="bg-amber-50 text-amber-700" />
              <KpiCard label="Cold" value={kpi.cold} accent="bg-slate-50 text-slate-700" />
            </div>

            <div className="bg-surface rounded-xl shadow-sm border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Top 10 Hot Leads</h2>
                {loading && (
                  <span className="text-xs text-slate-500">Refreshing…</span>
                )}
              </div>
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {topHot.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-surface2 px-3 py-2 text-left hover:border-primary/40 hover:bg-white transition"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{lead.name}</span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${intentColor(
                            lead.ai_buyer_intent
                          )}`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${categoryDot(
                              lead.lead_category
                            )}`}
                          />
                          {lead.lead_category} · {lead.ai_buyer_intent || "Unknown"}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">
                        {lead.preferred_location || "Any location"} ·{" "}
                        {lead.property_type || "Any type"} · Score {lead.lead_score}
                      </p>
                    </div>
                    <div className="text-[10px] text-slate-400 text-right">
                      {lead.source || "Unknown source"}
                    </div>
                  </button>
                ))}
                {topHot.length === 0 && (
                  <p className="text-xs text-slate-500">No leads yet. Add some to get started.</p>
                )}
              </div>
            </div>
          </div>

          {/* Daily Priority List */}
          <div className="bg-surface rounded-xl shadow-sm border border-slate-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Daily Priority List</h2>
              <button
                onClick={loadAll}
                className="text-xs text-primary hover:text-primaryDark"
              >
                Refresh
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Leads you should contact today based on score, intent and last contact time.
            </p>
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {dailyPriority.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => setSelectedLead(lead)}
                  className="w-full flex items-start justify-between rounded-lg border border-amber-100 bg-amber-50/60 px-3 py-2 text-left hover:border-amber-300 transition"
                >
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-xs">{lead.name}</span>
                      <span className="text-[10px] text-slate-500">
                        {lead.lead_category} · {lead.ai_buyer_intent || "Unknown"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">
                      {lead.next_best_action || "Follow up"} · Score {lead.lead_score}
                    </p>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {lead.last_contacted_at ? "Last contacted" : "Never contacted"}
                  </span>
                </button>
              ))}
              {dailyPriority.length === 0 && (
                <p className="text-xs text-slate-500">No leads qualify for priority today.</p>
              )}
            </div>
          </div>
        </section>

        {/* Filters + Table + Lead detail */}
        <section className="grid gap-6 lg:grid-cols-[2fr,1fr]">
          <div className="space-y-3">
            <form
              onSubmit={handleSearchSubmit}
              className="flex flex-wrap items-center gap-2 bg-surface rounded-xl border border-slate-200 px-3 py-2.5"
            >
              <input
                type="text"
                placeholder="Search by name, email, phone or location..."
                value={filters.search}
                onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
                className="flex-1 min-w-[140px] text-xs rounded-md border border-slate-200 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <select
                value={filters.category}
                onChange={e =>
                  setFilters(f => ({ ...f, category: e.target.value as FilterState["category"] }))
                }
                className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1.5"
              >
                <option value="">All Categories</option>
                <option value="Hot">Hot</option>
                <option value="Warm">Warm</option>
                <option value="Cold">Cold</option>
              </select>
              <select
                value={filters.intent}
                onChange={e =>
                  setFilters(f => ({ ...f, intent: e.target.value as FilterState["intent"] }))
                }
                className="text-xs rounded-md border border-slate-200 bg-white px-2 py-1.5"
              >
                <option value="">Any Intent</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
              <button
                type="submit"
                className="text-xs rounded-md bg-primary text-white px-3 py-1.5 hover:bg-primaryDark"
              >
                Apply
              </button>
            </form>

            <div className="bg-surface rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              <div className="border-b border-slate-200 px-3 py-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold">All Leads</h2>
                <span className="text-[11px] text-slate-500">{leads.length} leads</span>
              </div>
              <div className="max-h-[420px] overflow-auto text-xs">
                <table className="min-w-full">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">Lead</th>
                      <th className="px-3 py-2 text-left">Score</th>
                      <th className="px-3 py-2 text-left">Intent</th>
                      <th className="px-3 py-2 text-left">Location / Type</th>
                      <th className="px-3 py-2 text-left">Budget</th>
                      <th className="px-3 py-2 text-left">Source</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {leads.map(lead => (
                      <tr
                        key={lead.id}
                        className="hover:bg-surface2 cursor-pointer"
                        onClick={() => setSelectedLead(lead)}
                      >
                        <td className="px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={`w-2 h-2 rounded-full ${categoryDot(
                                lead.lead_category
                              )}`}
                            />
                            <div>
                              <div className="font-medium text-[11px]">{lead.name}</div>
                              <div className="text-[10px] text-slate-500">
                                {lead.phone || lead.email || "No contact"}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-col">
                            <span className="font-semibold text-[11px]">
                              {lead.lead_score}
                            </span>
                            <span className="text-[10px] text-slate-500">
                              {lead.lead_category}
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${intentColor(
                              lead.ai_buyer_intent
                            )}`}
                          >
                            {lead.ai_buyer_intent || "Unknown"}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-[10px]">
                            {lead.preferred_location || "Any"}
                          </div>
                          <div className="text-[10px] text-slate-500">
                            {lead.property_type || "Any type"}
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-[10px]">
                            {lead.budget_min && lead.budget_max
                              ? `₹${(lead.budget_min / 1e5).toFixed(0)}L–₹${(
                                  lead.budget_max / 1e5
                                ).toFixed(0)}L`
                              : "N/A"}
                          </div>
                        </td>
                        <td className="px-3 py-2 text-[10px] text-slate-500">
                          {lead.source || "Unknown"}
                        </td>
                      </tr>
                    ))}
                    {leads.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className="px-3 py-6 text-center text-xs text-slate-500"
                        >
                          No leads yet. Use the form on the right or upload a CSV to import
                          leads.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Right column: Add lead + CSV + Lead details */}
          <div className="space-y-4">
            <form
              onSubmit={handleCreateLead}
              className="bg-surface rounded-xl shadow-sm border border-slate-200 p-4 space-y-3"
            >
              <div className="flex items-center justify-between mb-1">
                <h2 className="text-sm font-semibold">Add Lead</h2>
                <span className="text-[10px] text-slate-500">
                  Rule-based scoring + AI intent
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <Input
                  label="Name *"
                  value={form.name}
                  onChange={v => setForm(f => ({ ...f, name: v }))}
                />
                <Input
                  label="Phone"
                  value={form.phone}
                  onChange={v => setForm(f => ({ ...f, phone: v }))}
                />
                <Input
                  label="Email"
                  value={form.email}
                  onChange={v => setForm(f => ({ ...f, email: v }))}
                />
                <Input
                  label="Preferred Location"
                  value={form.preferred_location}
                  onChange={v => setForm(f => ({ ...f, preferred_location: v }))}
                />
                <Input
                  label="Property Type"
                  placeholder="2BHK, Villa..."
                  value={form.property_type}
                  onChange={v => setForm(f => ({ ...f, property_type: v }))}
                />
                <Input
                  label="Source"
                  placeholder="Facebook, Website..."
                  value={form.source}
                  onChange={v => setForm(f => ({ ...f, source: v }))}
                />
                <Input
                  label="Budget Min (₹)"
                  value={form.budget_min}
                  onChange={v => setForm(f => ({ ...f, budget_min: v }))}
                />
                <Input
                  label="Budget Max (₹)"
                  value={form.budget_max}
                  onChange={v => setForm(f => ({ ...f, budget_max: v }))}
                />
                <Input
                  label="Property Views"
                  value={form.number_of_property_views}
                  onChange={v => setForm(f => ({ ...f, number_of_property_views: v }))}
                />
                <Input
                  label="Time on Site (sec)"
                  value={form.time_spent_on_site}
                  onChange={v => setForm(f => ({ ...f, time_spent_on_site: v }))}
                />
                <Input
                  label="Repeat Visits"
                  value={form.repeat_visits}
                  onChange={v => setForm(f => ({ ...f, repeat_visits: v }))}
                />
                <Input
                  label="Last Response Time (h)"
                  value={form.last_response_time_hours}
                  onChange={v => setForm(f => ({ ...f, last_response_time_hours: v }))}
                />
                <Input
                  label="Saved Properties"
                  value={form.saved_properties_count}
                  onChange={v => setForm(f => ({ ...f, saved_properties_count: v }))}
                />
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-slate-600">
                    Random Location Browsing
                  </label>
                  <select
                    className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px]"
                    value={form.random_location_browsing}
                    onChange={e =>
                      setForm(f => ({ ...f, random_location_browsing: e.target.value }))
                    }
                  >
                    <option value="false">No</option>
                    <option value="true">Yes</option>
                  </select>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-[11px]">
                <label className="text-[10px] text-slate-600">
                  Notes / recent conversation
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="Any notes or chat snippets. Used by AI to detect intent."
                />
              </div>
              <button
                type="submit"
                disabled={creatingLead}
                className="w-full rounded-md bg-primary text-white py-1.5 text-xs font-medium hover:bg-primaryDark disabled:opacity-60"
              >
                {creatingLead ? "Creating lead..." : "Add & Score Lead"}
              </button>
            </form>

            <div className="bg-surface rounded-xl shadow-sm border border-slate-200 p-4 space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">CSV Upload</h2>
                <span className="text-[10px] text-slate-500">Bulk import</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Upload a CSV with columns like: name, email, phone, budget_min, budget_max,
                preferred_location, property_type, source, number_of_property_views,
                time_spent_on_site, repeat_visits, last_response_time_hours,
                saved_properties_count, random_location_browsing, notes.
              </p>
              <input
                type="file"
                accept=".csv"
                onChange={handleCsvChange}
                className="text-[11px]"
              />
              {csvUploading && (
                <p className="text-[11px] text-slate-500">Uploading and scoring leads…</p>
              )}
            </div>

            {selectedLead && (
              <div className="bg-surface rounded-xl shadow-sm border border-slate-200 p-4 space-y-2 text-xs">
                <div className="flex items-center justify-between mb-1">
                  <h2 className="text-sm font-semibold">Lead Detail</h2>
                  <button
                    onClick={() => setSelectedLead(null)}
                    className="text-[10px] text-slate-500 hover:text-slate-700"
                  >
                    Close
                  </button>
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{selectedLead.name}</span>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] ${intentColor(
                          selectedLead.ai_buyer_intent
                        )}`}
                      >
                        {selectedLead.lead_category} ·{" "}
                        {selectedLead.ai_buyer_intent || "Unknown"}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      {selectedLead.preferred_location || "Any location"} ·{" "}
                      {selectedLead.property_type || "Any type"}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">
                      {selectedLead.lead_score}
                    </div>
                    <div className="text-[10px] text-slate-500">Lead score</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] mb-2">
                  <DetailItem
                    label="Budget"
                    value={
                      selectedLead.budget_min && selectedLead.budget_max
                        ? `₹${(selectedLead.budget_min / 1e5).toFixed(0)}L–₹${(
                            selectedLead.budget_max / 1e5
                          ).toFixed(0)}L`
                        : "N/A"
                    }
                  />
                  <DetailItem
                    label="Source"
                    value={selectedLead.source || "Unknown"}
                  />
                  <DetailItem
                    label="Property Views"
                    value={String(selectedLead.number_of_property_views)}
                  />
                  <DetailItem
                    label="Repeat Visits"
                    value={String(selectedLead.repeat_visits)}
                  />
                  <DetailItem
                    label="Saved Properties"
                    value={String(selectedLead.saved_properties_count)}
                  />
                  <DetailItem
                    label="Last Response Time"
                    value={
                      selectedLead.last_response_time_hours != null
                        ? `${selectedLead.last_response_time_hours.toFixed(1)} h`
                        : "Unknown"
                    }
                  />
                </div>

                <div className="border-t border-slate-200 pt-2 space-y-1.5">
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600">
                      AI Intent Summary
                    </div>
                    <p className="text-[11px] text-slate-700">
                      {selectedLead.ai_summary || "No AI summary yet."}
                    </p>
                    <p className="text-[10px] text-slate-500 mt-0.5">
                      Buyer type: {selectedLead.ai_buyer_type || "Unknown"}
                    </p>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600">
                      Next Best Action
                    </div>
                    <p className="text-[11px] text-slate-700">
                      {selectedLead.next_best_action || "AI will recommend after analysis."}
                    </p>
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold text-slate-600 mb-0.5">
                      Suggested Message
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] text-slate-700 whitespace-pre-line">
                      {selectedLead.suggested_message ||
                        "Click “Send AI message” to generate a tailored WhatsApp/email message. (Simulation only – no real sending.)"}
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={sendingMessage}
                    onClick={() => handleSendAiMessage(selectedLead)}
                    className="mt-1.5 w-full rounded-md border border-primary bg-white text-primary py-1.5 text-[11px] font-medium hover:bg-primary/5 disabled:opacity-60"
                  >
                    {sendingMessage ? "Generating message…" : "Send AI message (simulate)"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};

const KpiCard: React.FC<{
  label: string;
  value: number;
  accent?: string;
}> = ({ label, value, accent }) => {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-surface2 px-3 py-2.5 shadow-sm ${
        accent || ""
      }`}
    >
      <div className="text-[10px] text-slate-500 uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
};

const Input: React.FC<{
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}> = ({ label, value, placeholder, onChange }) => (
  <div className="flex flex-col gap-1">
    <label className="text-[10px] text-slate-600">{label}</label>
    <input
      className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
    />
  </div>
);

const DetailItem: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div className="text-[10px] text-slate-500">{label}</div>
    <div className="text-[11px] text-slate-800">{value}</div>
  </div>
);

export default App;
