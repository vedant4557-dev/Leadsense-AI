export type LeadCategory = "Hot" | "Warm" | "Cold";

export interface Lead {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  budget_min?: number;
  budget_max?: number;
  preferred_location?: string;
  property_type?: string;
  source?: string;
  created_at: string;

  number_of_property_views: number;
  time_spent_on_site: number;
  repeat_visits: number;
  last_response_time_hours?: number;
  saved_properties_count: number;
  random_location_browsing: boolean;

  notes: string;
  ai_buyer_intent?: string;
  ai_buyer_type?: string;
  ai_summary?: string;

  lead_score: number;
  lead_category: LeadCategory;

  next_best_action?: string;
  suggested_message?: string;
  last_contacted_at?: string;
}
