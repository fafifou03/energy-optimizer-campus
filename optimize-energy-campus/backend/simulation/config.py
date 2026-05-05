"""Physical and financial constants for the campus energy simulation."""

from __future__ import annotations

CO2_FACTOR_G_KWH: float = 58.0
ROOM_AREA_M2: int = 60

HVAC_MAX_HEATING_KW: float = 5.0
HVAC_MAX_COOLING_KW: float = 4.0
LIGHTING_MAX_KW: float = 2.0
LIGHTING_HALF_KW: float = 1.0
VENTILATION_MAX_KW: float = 0.50
VENTILATION_MIN_KW: float = 0.05
EQUIPMENT_ACTIVE_KW: float = 1.0
EQUIPMENT_STANDBY_KW: float = 0.3

THERMAL_ALPHA: float = 0.05
HVAC_TEMP_COEF_H: float = 0.30
HVAC_TEMP_COEF_C: float = 0.25
HVAC_PROP_GAIN: float = 3.0
T_INT_START: float = 20.0

NORM_HEATING_TARGET: float = 19.0
NORM_COOLING_TARGET: float = 26.0
NORM_ECO_TEMP: float = 16.0
NORM_FROST_TEMP: float = 8.0

COMFORT_TEMP_MIN: float = 18.0
COMFORT_TEMP_MAX: float = 27.0

SEASON_TEMP_RANGES: dict[str, tuple[float, float]] = {
    "Hiver": (2.0, 10.0),
    "Printemps": (10.0, 20.0),
    "Été": (22.0, 35.0),
    "Automne": (8.0, 18.0),
}

SEASON_ORDER: list[str] = ["Hiver", "Printemps", "Été", "Automne"]
WORK_START_HOUR: int = 8
WORK_END_HOUR: int = 18
SIMULATION_HOURS: int = 168
WEEKS_PER_SEASON: int = 13

DEFAULT_ALGO_PARAMS: dict[str, float] = {
    "heating_target": 19.0,
    "cooling_target": 26.0,
    "eco_temp": 16.0,
    "frost_temp": 8.0,
    "light_high_thresh": 0.70,
    "light_mid_thresh": 0.40,
}

ECO_MODE_DELTAS: dict[str, float] = {
    "heating_target": -0.2,
    "cooling_target": 0.4,
    "eco_temp": -0.3,
    "frost_temp": 0.0,
    "light_high_thresh": 0.03,
    "light_mid_thresh": 0.03,
}

WEATHER_PROFILES: dict[str, dict[str, object]] = {
    "academic_year": {
        "label": "Année académique réaliste",
        "uses_full_year": False,
        "shares": {"Hiver": 0.28, "Printemps": 0.28, "Été": 0.11, "Automne": 0.33},
    },
    "full_year": {
        "label": "Année complète",
        "uses_full_year": True,
        "shares": {"Hiver": 0.25, "Printemps": 0.25, "Été": 0.25, "Automne": 0.25},
    },
    "cold_winter": {
        "label": "Hiver froid",
        "uses_full_year": False,
        "shares": {"Hiver": 0.55, "Printemps": 0.15, "Été": 0.05, "Automne": 0.25},
    },
    "hot_summer": {
        "label": "Été chaud",
        "uses_full_year": False,
        "shares": {"Hiver": 0.10, "Printemps": 0.15, "Été": 0.55, "Automne": 0.20},
    },
    "mid_season": {
        "label": "Mi-saison",
        "uses_full_year": False,
        "shares": {"Hiver": 0.12, "Printemps": 0.43, "Été": 0.05, "Automne": 0.40},
    },
}

ROOM_LABELS: dict[str, str] = {
    "room_1": "Salle 1 — scénario défavorable",
    "room_2": "Salle 2 — fonctionnement standard",
    "room_3": "Salle 3 — algorithme optimisé",
}

BREAKDOWN_COLUMNS: dict[str, str] = {
    "hvac_kw": "hvac",
    "lighting_kw": "lighting",
    "ventilation_kw": "ventilation",
    "equipment_kw": "equipment",
}
