import type { SimulationRequest, WeatherProfile } from "../types/simulation";

export const defaultSimulationRequest: SimulationRequest = {
  room_count: 80,
  average_people_per_room: 24,
  presence_rate: 0.75,
  weather_profile: "academic_year",
  kwh_price: 0.2,
  active_weeks: 36,
  deployment_rate: 0.7,
  diversity_factor: 0.65,
  prudence_factor: 0.55,
  random_seed: 42,
  eco_mode: true,
};

export const weatherProfiles: Array<{ value: WeatherProfile; label: string; description: string }> = [
  {
    value: "academic_year",
    label: "Année académique réaliste",
    description: "Répartition prudente sur hiver, printemps, été et automne.",
  },
  {
    value: "full_year",
    label: "Année complète",
    description: "52 semaines simulées avec quatre saisons équilibrées.",
  },
  {
    value: "cold_winter",
    label: "Hiver froid",
    description: "Poids renforcé du chauffage et des semaines froides.",
  },
  {
    value: "hot_summer",
    label: "Été chaud",
    description: "Poids renforcé de la climatisation et des semaines chaudes.",
  },
  {
    value: "mid_season",
    label: "Mi-saison",
    description: "Usage dominant au printemps et à l'automne.",
  },
];
