export type WeatherProfile = "academic_year" | "full_year" | "cold_winter" | "hot_summer" | "mid_season";

export interface SimulationRequest {
  room_count: number;
  average_people_per_room: number;
  presence_rate: number;
  weather_profile: WeatherProfile;
  kwh_price: number;
  active_weeks: number;
  deployment_rate: number;
  diversity_factor: number;
  prudence_factor: number;
  random_seed: number;
  eco_mode: boolean;
}

export interface EnergyBreakdown {
  hvac: number;
  lighting: number;
  ventilation: number;
  equipment: number;
}

export interface RoomResult {
  id: string;
  name: string;
  energy_kwh: number;
  cost_eur: number;
  co2_kg: number;
  comfort_score: number;
  breakdown: EnergyBreakdown;
  relative_savings_vs_standard_pct: number;
  description: string;
}

export interface SummaryResult {
  annual_savings_eur: number;
  annual_savings_kwh: number;
  co2_saved_kg: number;
  comfort_score: number;
  realistic_campus_gain_eur: number;
  realistic_campus_gain_kwh: number;
  gross_campus_gain_eur: number;
  gross_campus_gain_kwh: number;
}

export interface CampusResult {
  room_count: number;
  deployed_rooms: number;
  deployment_rate: number;
  diversity_factor: number;
  prudence_factor: number;
  gross_gain_eur: number;
  diversified_gain_eur: number;
  realistic_gain_eur: number;
  gross_gain_kwh: number;
  diversified_gain_kwh: number;
  realistic_gain_kwh: number;
}

export interface SeasonalResult {
  season: string;
  weeks: number;
  standard_kwh: number;
  optimized_kwh: number;
  savings_kwh: number;
  standard_cost_eur: number;
  optimized_cost_eur: number;
  savings_eur: number;
  co2_saved_kg: number;
}

export type BreakdownKey = "hvac" | "lighting" | "ventilation" | "equipment";

export interface BreakdownComparison {
  key: BreakdownKey;
  label: string;
  standard_kwh: number;
  optimized_kwh: number;
  savings_kwh: number;
  savings_pct: number;
}

export interface StandardVsOptimized {
  standard_energy_kwh: number;
  optimized_energy_kwh: number;
  savings_kwh: number;
  savings_eur: number;
  savings_pct: number;
  standard_cost_eur: number;
  optimized_cost_eur: number;
  standard_co2_kg: number;
  optimized_co2_kg: number;
  co2_saved_kg: number;
  standard_comfort_score: number;
  optimized_comfort_score: number;
  comfort_delta: number;
}

export interface ChartPoint {
  hour: string;
  standard_kw: number;
  optimized_kw: number;
  worst_kw: number;
  occupancy: number;
  luminosity_pct: number;
  outside_temp_c: number;
  optimized_temp_c: number;
}

export interface MetadataResult {
  random_seed: number;
  weather_profile: WeatherProfile;
  weather_profile_label: string;
  eco_mode: boolean;
  kwh_price: number;
  active_weeks: number;
  simulation_hours: number;
  season_count: number;
  room_area_m2: number;
  co2_factor_g_kwh: number;
  note: string;
}

export interface SimulationResponse {
  summary: SummaryResult;
  campus: CampusResult;
  rooms: RoomResult[];
  seasonal: SeasonalResult[];
  energy_breakdown: BreakdownComparison[];
  standard_vs_optimized: StandardVsOptimized;
  chart_points: ChartPoint[];
  metadata: MetadataResult;
}
