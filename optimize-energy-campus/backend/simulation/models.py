"""Pydantic models for simulation inputs and outputs."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

WeatherProfile = Literal["academic_year", "full_year", "cold_winter", "hot_summer", "mid_season"]


class SimulationRequest(BaseModel):
    room_count: int = Field(default=80, ge=1, le=500)
    average_people_per_room: int = Field(default=24, ge=1, le=250)
    presence_rate: float = Field(default=0.75, ge=0.05, le=1.0)
    weather_profile: WeatherProfile = "academic_year"
    kwh_price: float = Field(default=0.20, ge=0.01, le=2.0)
    active_weeks: int = Field(default=36, ge=1, le=52)
    deployment_rate: float = Field(default=0.70, ge=0.0, le=1.0)
    diversity_factor: float = Field(default=0.65, ge=0.10, le=1.0)
    prudence_factor: float = Field(default=0.55, ge=0.10, le=1.0)
    random_seed: int = Field(default=42, ge=0, le=1_000_000)
    eco_mode: bool = True


class EnergyBreakdown(BaseModel):
    hvac: float
    lighting: float
    ventilation: float
    equipment: float


class RoomResult(BaseModel):
    id: str
    name: str
    energy_kwh: float
    cost_eur: float
    co2_kg: float
    comfort_score: float
    breakdown: EnergyBreakdown
    relative_savings_vs_standard_pct: float
    description: str


class SummaryResult(BaseModel):
    annual_savings_eur: float
    annual_savings_kwh: float
    co2_saved_kg: float
    comfort_score: float
    realistic_campus_gain_eur: float
    realistic_campus_gain_kwh: float
    gross_campus_gain_eur: float
    gross_campus_gain_kwh: float


class CampusResult(BaseModel):
    room_count: int
    deployed_rooms: float
    deployment_rate: float
    diversity_factor: float
    prudence_factor: float
    gross_gain_eur: float
    diversified_gain_eur: float
    realistic_gain_eur: float
    gross_gain_kwh: float
    diversified_gain_kwh: float
    realistic_gain_kwh: float


class SeasonalResult(BaseModel):
    season: str
    weeks: float
    standard_kwh: float
    optimized_kwh: float
    savings_kwh: float
    standard_cost_eur: float
    optimized_cost_eur: float
    savings_eur: float
    co2_saved_kg: float


class BreakdownComparison(BaseModel):
    key: Literal["hvac", "lighting", "ventilation", "equipment"]
    label: str
    standard_kwh: float
    optimized_kwh: float
    savings_kwh: float
    savings_pct: float


class StandardVsOptimized(BaseModel):
    standard_energy_kwh: float
    optimized_energy_kwh: float
    savings_kwh: float
    savings_eur: float
    savings_pct: float
    standard_cost_eur: float
    optimized_cost_eur: float
    standard_co2_kg: float
    optimized_co2_kg: float
    co2_saved_kg: float
    standard_comfort_score: float
    optimized_comfort_score: float
    comfort_delta: float


class ChartPoint(BaseModel):
    hour: str
    standard_kw: float
    optimized_kw: float
    worst_kw: float
    occupancy: int
    luminosity_pct: float
    outside_temp_c: float
    optimized_temp_c: float


class MetadataResult(BaseModel):
    random_seed: int
    weather_profile: WeatherProfile
    weather_profile_label: str
    eco_mode: bool
    kwh_price: float
    active_weeks: float
    simulation_hours: int
    season_count: int
    room_area_m2: int
    co2_factor_g_kwh: float
    note: str


class SimulationResponse(BaseModel):
    summary: SummaryResult
    campus: CampusResult
    rooms: list[RoomResult]
    seasonal: list[SeasonalResult]
    energy_breakdown: list[BreakdownComparison]
    standard_vs_optimized: StandardVsOptimized
    chart_points: list[ChartPoint]
    metadata: MetadataResult
