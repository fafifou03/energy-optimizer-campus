"""Core simulation engine adapted from the functional Streamlit POC."""

from __future__ import annotations

import numpy as np
import pandas as pd

from simulation.config import (
    BREAKDOWN_COLUMNS,
    CO2_FACTOR_G_KWH,
    COMFORT_TEMP_MAX,
    COMFORT_TEMP_MIN,
    DEFAULT_ALGO_PARAMS,
    ECO_MODE_DELTAS,
    EQUIPMENT_ACTIVE_KW,
    EQUIPMENT_STANDBY_KW,
    HVAC_MAX_COOLING_KW,
    HVAC_MAX_HEATING_KW,
    HVAC_PROP_GAIN,
    HVAC_TEMP_COEF_C,
    HVAC_TEMP_COEF_H,
    LIGHTING_HALF_KW,
    LIGHTING_MAX_KW,
    NORM_COOLING_TARGET,
    NORM_ECO_TEMP,
    NORM_FROST_TEMP,
    NORM_HEATING_TARGET,
    ROOM_AREA_M2,
    ROOM_LABELS,
    SEASON_ORDER,
    SEASON_TEMP_RANGES,
    SIMULATION_HOURS,
    T_INT_START,
    THERMAL_ALPHA,
    VENTILATION_MAX_KW,
    VENTILATION_MIN_KW,
    WEATHER_PROFILES,
    WEEKS_PER_SEASON,
    WORK_END_HOUR,
    WORK_START_HOUR,
)
from simulation.models import (
    BreakdownComparison,
    CampusResult,
    ChartPoint,
    EnergyBreakdown,
    MetadataResult,
    RoomResult,
    SeasonalResult,
    SimulationRequest,
    SimulationResponse,
    StandardVsOptimized,
    SummaryResult,
)
from simulation.utils import clamp, pct_change, round_energy, round_money


def _season_weeks(profile_key: str, active_weeks: int) -> dict[str, float]:
    profile = WEATHER_PROFILES[profile_key]
    shares = profile["shares"]
    total = float(WEEKS_PER_SEASON * len(SEASON_ORDER)) if profile["uses_full_year"] else float(active_weeks)
    return {season: round(total * float(shares[season]), 2) for season in SEASON_ORDER}


def _build_algo_params(eco_mode: bool) -> dict[str, float | bool]:
    params: dict[str, float | bool] = dict(DEFAULT_ALGO_PARAMS)
    if eco_mode:
        for key, delta in ECO_MODE_DELTAS.items():
            params[key] = float(params[key]) + delta

    params["heating_target"] = clamp(float(params["heating_target"]), 17.0, 22.0)
    params["cooling_target"] = clamp(float(params["cooling_target"]), 24.0, 30.0)
    params["eco_temp"] = clamp(float(params["eco_temp"]), 14.0, 18.0)
    params["frost_temp"] = clamp(float(params["frost_temp"]), 5.0, 12.0)
    params["light_high_thresh"] = clamp(float(params["light_high_thresh"]), 0.50, 0.90)
    params["light_mid_thresh"] = clamp(
        float(params["light_mid_thresh"]),
        0.20,
        min(0.60, float(params["light_high_thresh"]) - 0.05),
    )
    params["eco_mode"] = eco_mode
    return params


def _generate_temperature(
    hour_of_day: np.ndarray,
    t_min: float,
    t_max: float,
    rng: np.random.Generator,
) -> np.ndarray:
    base = rng.uniform(t_min, t_max, len(hour_of_day))
    cycle = -3.0 * np.cos(2.0 * np.pi * (hour_of_day - 14) / 24)
    noise = rng.normal(0.0, 0.4, len(hour_of_day))
    temp = base + cycle + noise
    return np.round(np.clip(temp, t_min - 4.0, t_max + 4.0), 1)


def _generate_luminosity(hour_of_day: np.ndarray, season: str, rng: np.random.Generator) -> np.ndarray:
    cloud = rng.uniform(0.0, 1.0, len(hour_of_day))
    lum = np.zeros(len(hour_of_day))

    for i, hour in enumerate(hour_of_day):
        if hour < 6 or hour >= 21:
            level = 0.0
        elif 6 <= hour < 8:
            level = (hour - 6) / 2.0 * 0.55
        elif 8 <= hour < 17:
            level = 0.45 + (1.0 - cloud[i]) * 0.55
        elif 17 <= hour < 19:
            level = (19 - hour) / 2.0 * 0.45
        else:
            level = 0.04
        lum[i] = level

    factor = {"Hiver": 0.60, "Printemps": 0.88, "Été": 1.10, "Automne": 0.74}
    return np.round(np.clip(lum * factor.get(season, 1.0), 0.0, 1.0), 2)


def _generate_occupancy(
    df: pd.DataFrame,
    seed: int,
    average_people_per_room: int,
    presence_rate: float,
    max_occupancy: int,
) -> np.ndarray:
    rng = np.random.default_rng(seed)
    occupancy = np.zeros(len(df), dtype=int)

    for idx, row in df.iterrows():
        day = int(row["day_of_week"])
        hour = int(row["hour_of_day"])
        is_weekend = day >= 5
        is_workhour = WORK_START_HOUR <= hour < WORK_END_HOUR

        if is_weekend or not is_workhour or rng.random() > presence_rate:
            occupancy[idx] = 0
            continue

        sampled = rng.normal(float(average_people_per_room), max(2.0, average_people_per_room * 0.18))
        occupancy[idx] = int(np.clip(round(sampled), 1, max_occupancy))

    return occupancy


def _generate_simulation_data(season: str, request: SimulationRequest, seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    hours = np.arange(SIMULATION_HOURS)
    hour_of_day = hours % 24
    day_of_week = hours // 24
    t_min, t_max = SEASON_TEMP_RANGES[season]
    max_occupancy = max(1, int(round(request.average_people_per_room * 1.35)))

    df = pd.DataFrame(
        {
            "hour": hours,
            "day_of_week": day_of_week,
            "hour_of_day": hour_of_day,
            "temperature_ext": _generate_temperature(hour_of_day, t_min, t_max, rng),
            "luminosity": _generate_luminosity(hour_of_day, season, rng),
        }
    )
    df["occupancy"] = _generate_occupancy(
        df,
        seed=seed + 57,
        average_people_per_room=request.average_people_per_room,
        presence_rate=request.presence_rate,
        max_occupancy=max_occupancy,
    )
    df["is_occupied"] = df["occupancy"] > 0
    df["is_workday"] = df["day_of_week"] < 5
    df["is_workhour"] = (df["hour_of_day"] >= WORK_START_HOUR) & (df["hour_of_day"] < WORK_END_HOUR)
    df["season"] = season
    df["max_occupancy"] = max_occupancy
    return df


def _next_temperature(t_int: float, t_ext: float, hvac_delta: float) -> float:
    natural = THERMAL_ALPHA * (t_ext - t_int)
    return round(float(np.clip(t_int + natural + hvac_delta, -15.0, 60.0)), 2)


def _make_row(
    input_row: pd.Series,
    hvac_kw: float,
    lighting_kw: float,
    ventilation_kw: float,
    equipment_kw: float,
    t_int: float,
) -> dict[str, float | int]:
    return {
        "hour": int(input_row["hour"]),
        "hvac_kw": round(hvac_kw, 3),
        "lighting_kw": round(lighting_kw, 3),
        "ventilation_kw": round(ventilation_kw, 3),
        "equipment_kw": round(equipment_kw, 3),
        "total_kw": round(hvac_kw + lighting_kw + ventilation_kw + equipment_kw, 3),
        "temperature_int": t_int,
    }


def _heat(t_int: float, target: float, max_kw: float) -> tuple[float, float]:
    error = target - t_int
    if error <= 0.0:
        return 0.0, 0.0
    power = min(max_kw, error * HVAC_PROP_GAIN)
    return power, power * HVAC_TEMP_COEF_H


def _cool(t_int: float, target: float, max_kw: float) -> tuple[float, float]:
    error = t_int - target
    if error <= 0.0:
        return 0.0, 0.0
    power = min(max_kw, error * HVAC_PROP_GAIN)
    return power, -power * HVAC_TEMP_COEF_C


def _compute_hvac_room3(
    t_int: float,
    t_ext: float,
    occupancy: int,
    is_workhour: bool,
    is_workday: bool,
    season: str,
    next_occupancy: int,
    max_occupancy: int,
    params: dict[str, float | bool],
) -> tuple[float, float]:
    heating_target = float(params.get("heating_target", NORM_HEATING_TARGET))
    cooling_target = float(params.get("cooling_target", NORM_COOLING_TARGET))
    eco_temp = float(params.get("eco_temp", NORM_ECO_TEMP))
    frost_temp = float(params.get("frost_temp", NORM_FROST_TEMP))
    eco_mode = bool(params.get("eco_mode", False))

    is_occupied = occupancy > 0
    occ_ratio = occupancy / max_occupancy if max_occupancy else 0.0
    needs_heating = (t_ext < 15.5) or (season in ("Hiver", "Automne"))
    needs_cooling = (season == "Été") or (t_ext > 27.5)
    heat_target = heating_target + (0.25 if occ_ratio >= 0.75 and season in ("Hiver", "Automne") else 0.0)
    cool_target = cooling_target - (0.35 if occ_ratio >= 0.75 and season == "Été" else 0.0)
    deadband = 0.25 if is_occupied else 0.40

    if is_occupied:
        if needs_heating and t_int < heat_target - deadband:
            return _heat(t_int, heat_target, HVAC_MAX_HEATING_KW)
        if needs_cooling and t_int > cool_target + deadband:
            return _cool(t_int, cool_target, HVAC_MAX_COOLING_KW)
        return 0.0, 0.0

    imminent_use = is_workday and next_occupancy > 0 and (is_workhour or eco_mode)
    if imminent_use:
        if needs_heating and t_int < max(eco_temp, heating_target - 1.1):
            return _heat(t_int, max(eco_temp, heating_target - 1.1), HVAC_MAX_HEATING_KW * 0.55)
        if needs_cooling and t_int > cooling_target + 0.9:
            return _cool(t_int, cooling_target + 0.6, HVAC_MAX_COOLING_KW * 0.50)

    if is_workday and is_workhour:
        if needs_heating and t_int < eco_temp - 0.3:
            return _heat(t_int, eco_temp, HVAC_MAX_HEATING_KW * (0.38 if eco_mode else 0.45))
        if needs_cooling and t_int > cooling_target + 1.8:
            return _cool(t_int, cooling_target + 1.5, HVAC_MAX_COOLING_KW * 0.25)
        return 0.0, 0.0

    if t_int < frost_temp - 0.2:
        return _heat(t_int, frost_temp, HVAC_MAX_HEATING_KW * 0.22)

    return 0.0, 0.0


def _compute_lighting_room3(occupancy: int, luminosity: float, params: dict[str, float | bool]) -> float:
    high = float(params.get("light_high_thresh", 0.70))
    mid = float(params.get("light_mid_thresh", 0.40))

    if occupancy <= 0:
        return 0.0
    if luminosity >= high:
        return 0.0
    if luminosity >= mid:
        return LIGHTING_HALF_KW
    return LIGHTING_MAX_KW


def _compute_ventilation_room3(
    occupancy: int,
    is_workday: bool,
    is_workhour: bool,
    next_occupancy: int,
    max_occupancy: int,
    params: dict[str, float | bool],
) -> float:
    eco_mode = bool(params.get("eco_mode", False))

    if occupancy <= 0:
        if not (is_workday and is_workhour):
            return 0.0
        if next_occupancy > 0:
            return 0.06 if eco_mode else 0.08
        return 0.03 if eco_mode else 0.04

    ratio = occupancy / max_occupancy if max_occupancy else 0.0
    base = VENTILATION_MIN_KW * (0.90 if eco_mode else 1.0)
    return round(base + ratio * (VENTILATION_MAX_KW - base), 3)


def _compute_equipment_room3(
    is_workday: bool,
    is_workhour: bool,
    occupancy: int,
    next_occupancy: int,
    params: dict[str, float | bool],
) -> float:
    eco_mode = bool(params.get("eco_mode", False))

    if not (is_workday and is_workhour):
        return 0.0
    if occupancy > 0:
        return EQUIPMENT_ACTIVE_KW
    if next_occupancy > 0:
        return 0.12 if eco_mode else 0.18
    return round(EQUIPMENT_STANDBY_KW * (0.32 if eco_mode else 0.40), 3)


def _simulate_room1(df: pd.DataFrame, season: str) -> pd.DataFrame:
    is_heating = season in ("Hiver", "Automne")
    t_int = T_INT_START
    rows: list[dict[str, float | int]] = []

    for _, row in df.iterrows():
        t_ext = float(row["temperature_ext"])
        hour = int(row["hour_of_day"])
        is_night = hour < 6 or hour >= 22

        if is_heating:
            hvac_kw = HVAC_MAX_HEATING_KW
            hvac_delta = HVAC_MAX_HEATING_KW * HVAC_TEMP_COEF_H
        else:
            hvac_kw = HVAC_MAX_COOLING_KW
            hvac_delta = -HVAC_MAX_COOLING_KW * HVAC_TEMP_COEF_C

        lighting_kw = LIGHTING_MAX_KW
        ventilation_kw = VENTILATION_MAX_KW
        equipment_kw = EQUIPMENT_STANDBY_KW if is_night else EQUIPMENT_ACTIVE_KW
        t_int = _next_temperature(t_int, t_ext, hvac_delta)
        rows.append(_make_row(row, hvac_kw, lighting_kw, ventilation_kw, equipment_kw, t_int))

    return pd.DataFrame(rows)


def _simulate_room2(df: pd.DataFrame, season: str) -> pd.DataFrame:
    is_heating = season in ("Hiver", "Automne")
    is_cooling = season == "Été"
    t_int = T_INT_START
    rows: list[dict[str, float | int]] = []

    for _, row in df.iterrows():
        t_ext = float(row["temperature_ext"])
        in_session = bool(row["is_workday"]) and bool(row["is_workhour"])
        hvac_kw = 0.0
        hvac_delta = 0.0

        if in_session:
            if is_heating and t_int < 20.0:
                hvac_kw = min(HVAC_MAX_HEATING_KW, (20.0 - t_int) * HVAC_PROP_GAIN)
                hvac_delta = hvac_kw * HVAC_TEMP_COEF_H
            elif is_cooling and t_int > 24.0:
                hvac_kw = min(HVAC_MAX_COOLING_KW, (t_int - 24.0) * HVAC_PROP_GAIN)
                hvac_delta = -hvac_kw * HVAC_TEMP_COEF_C

        lighting_kw = LIGHTING_MAX_KW if in_session else 0.0
        ventilation_kw = VENTILATION_MAX_KW if in_session else VENTILATION_MIN_KW
        equipment_kw = EQUIPMENT_ACTIVE_KW if in_session else EQUIPMENT_STANDBY_KW
        t_int = _next_temperature(t_int, t_ext, hvac_delta)
        rows.append(_make_row(row, hvac_kw, lighting_kw, ventilation_kw, equipment_kw, t_int))

    return pd.DataFrame(rows)


def _simulate_room3(df: pd.DataFrame, season: str, params: dict[str, float | bool]) -> pd.DataFrame:
    t_int = T_INT_START
    rows: list[dict[str, float | int]] = []
    occupancies = df["occupancy"].to_numpy(dtype=int)
    max_occupancy = int(df["max_occupancy"].iloc[0])

    for idx, row in df.iterrows():
        t_ext = float(row["temperature_ext"])
        occupancy = int(row["occupancy"])
        next_occupancy = int(occupancies[idx + 1]) if idx + 1 < len(df) else 0
        hvac_kw, hvac_delta = _compute_hvac_room3(
            t_int=t_int,
            t_ext=t_ext,
            occupancy=occupancy,
            is_workhour=bool(row["is_workhour"]),
            is_workday=bool(row["is_workday"]),
            season=season,
            next_occupancy=next_occupancy,
            max_occupancy=max_occupancy,
            params=params,
        )
        lighting_kw = _compute_lighting_room3(occupancy, float(row["luminosity"]), params)
        ventilation_kw = _compute_ventilation_room3(
            occupancy=occupancy,
            is_workday=bool(row["is_workday"]),
            is_workhour=bool(row["is_workhour"]),
            next_occupancy=next_occupancy,
            max_occupancy=max_occupancy,
            params=params,
        )
        equipment_kw = _compute_equipment_room3(
            is_workday=bool(row["is_workday"]),
            is_workhour=bool(row["is_workhour"]),
            occupancy=occupancy,
            next_occupancy=next_occupancy,
            params=params,
        )
        t_int = _next_temperature(t_int, t_ext, hvac_delta)
        rows.append(_make_row(row, hvac_kw, lighting_kw, ventilation_kw, equipment_kw, t_int))

    return pd.DataFrame(rows)


def _compute_comfort_score(df_sim: pd.DataFrame, df_input: pd.DataFrame) -> float:
    mask = df_input["is_occupied"].values
    occupied_hours = int(mask.sum())
    if occupied_hours == 0:
        return 100.0

    t_int = df_sim["temperature_int"].values
    light_kw = df_sim["lighting_kw"].values
    nat_lum = df_input["luminosity"].values
    max_penalty = occupied_hours * 1.5
    penalties = 0.0

    for index in range(len(df_sim)):
        if not mask[index]:
            continue
        if t_int[index] < COMFORT_TEMP_MIN or t_int[index] > COMFORT_TEMP_MAX:
            penalties += 1.0
        if nat_lum[index] < 0.40 and light_kw[index] < 1.0:
            penalties += 0.5

    return round(max(0.0, 100.0 * (1.0 - penalties / max_penalty)), 1)


def _co2_kg_from_kwh(kwh: float) -> float:
    return round(float(kwh) * CO2_FACTOR_G_KWH / 1000.0, 2)


def _weighted_comfort(scores: list[float], weights: list[float]) -> float:
    total = sum(weights)
    if total <= 0:
        return round(float(np.mean(scores)), 1) if scores else 100.0
    return round(sum(score * weight for score, weight in zip(scores, weights)) / total, 1)


def _empty_room_totals() -> dict[str, dict[str, float]]:
    return {
        room_id: {
            "energy_kwh": 0.0,
            "cost_eur": 0.0,
            "co2_kg": 0.0,
            "comfort_weighted": 0.0,
            "comfort_weight": 0.0,
            "hvac": 0.0,
            "lighting": 0.0,
            "ventilation": 0.0,
            "equipment": 0.0,
        }
        for room_id in ROOM_LABELS
    }


def _add_room_totals(
    totals: dict[str, dict[str, float]],
    room_id: str,
    frame: pd.DataFrame,
    df_input: pd.DataFrame,
    weeks: float,
    kwh_price: float,
) -> None:
    weekly_kwh = float(frame["total_kw"].sum())
    comfort = _compute_comfort_score(frame, df_input)
    totals[room_id]["energy_kwh"] += weekly_kwh * weeks
    totals[room_id]["cost_eur"] += weekly_kwh * kwh_price * weeks
    totals[room_id]["co2_kg"] += _co2_kg_from_kwh(weekly_kwh) * weeks
    totals[room_id]["comfort_weighted"] += comfort * weeks
    totals[room_id]["comfort_weight"] += weeks
    for column, key in BREAKDOWN_COLUMNS.items():
        totals[room_id][key] += float(frame[column].sum()) * weeks


def _chart_points(df_input: pd.DataFrame, room1: pd.DataFrame, room2: pd.DataFrame, room3: pd.DataFrame) -> list[ChartPoint]:
    points: list[ChartPoint] = []
    workday = df_input[(df_input["day_of_week"] == 1) & (df_input["hour_of_day"] >= 8) & (df_input["hour_of_day"] <= 17)]
    if workday.empty:
        workday = df_input.head(10)

    for idx in workday.index[:10]:
        points.append(
            ChartPoint(
                hour=f"{int(df_input.loc[idx, 'hour_of_day']):02d}",
                standard_kw=round(float(room2.loc[idx, "total_kw"]), 2),
                optimized_kw=round(float(room3.loc[idx, "total_kw"]), 2),
                worst_kw=round(float(room1.loc[idx, "total_kw"]), 2),
                occupancy=int(df_input.loc[idx, "occupancy"]),
                luminosity_pct=round(float(df_input.loc[idx, "luminosity"]) * 100.0, 1),
                outside_temp_c=round(float(df_input.loc[idx, "temperature_ext"]), 1),
                optimized_temp_c=round(float(room3.loc[idx, "temperature_int"]), 1),
            )
        )

    return points


def run_simulation(request: SimulationRequest) -> SimulationResponse:
    params = _build_algo_params(request.eco_mode)
    season_weeks = _season_weeks(request.weather_profile, request.active_weeks)
    room_totals = _empty_room_totals()
    seasonal_results: list[SeasonalResult] = []
    sample_for_chart: tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame, pd.DataFrame] | None = None

    for offset, season in enumerate(SEASON_ORDER):
        weeks = float(season_weeks[season])
        season_seed = request.random_seed + offset * 101
        df_input = _generate_simulation_data(season, request, seed=season_seed)
        room1 = _simulate_room1(df_input, season)
        room2 = _simulate_room2(df_input, season)
        room3 = _simulate_room3(df_input, season, params=params)

        if sample_for_chart is None and weeks > 0:
            sample_for_chart = (df_input, room1, room2, room3)

        for room_id, frame in (("room_1", room1), ("room_2", room2), ("room_3", room3)):
            _add_room_totals(room_totals, room_id, frame, df_input, weeks, request.kwh_price)

        standard_weekly = float(room2["total_kw"].sum())
        optimized_weekly = float(room3["total_kw"].sum())
        savings_weekly = standard_weekly - optimized_weekly
        seasonal_results.append(
            SeasonalResult(
                season=season,
                weeks=round(weeks, 2),
                standard_kwh=round_energy(standard_weekly * weeks),
                optimized_kwh=round_energy(optimized_weekly * weeks),
                savings_kwh=round_energy(savings_weekly * weeks),
                standard_cost_eur=round_money(standard_weekly * request.kwh_price * weeks),
                optimized_cost_eur=round_money(optimized_weekly * request.kwh_price * weeks),
                savings_eur=round_money(savings_weekly * request.kwh_price * weeks),
                co2_saved_kg=round_energy(_co2_kg_from_kwh(savings_weekly) * weeks),
            )
        )

    standard = room_totals["room_2"]
    optimized = room_totals["room_3"]
    standard_energy_kwh = round_energy(standard["energy_kwh"])
    optimized_energy_kwh = round_energy(optimized["energy_kwh"])
    standard_cost_eur = round_money(standard["cost_eur"])
    optimized_cost_eur = round_money(optimized["cost_eur"])
    standard_co2_kg = round_energy(standard["co2_kg"])
    optimized_co2_kg = round_energy(optimized["co2_kg"])

    # Public values deliberately use the visible standard-minus-optimized formula.
    annual_savings_kwh = round_energy(standard_energy_kwh - optimized_energy_kwh)
    annual_savings_eur = round_money(standard_cost_eur - optimized_cost_eur)
    co2_saved_kg = round_energy(standard_co2_kg - optimized_co2_kg)

    deployed_rooms = request.room_count * request.deployment_rate
    gross_gain_eur = annual_savings_eur * deployed_rooms
    diversified_gain_eur = gross_gain_eur * request.diversity_factor
    realistic_gain_eur = diversified_gain_eur * request.prudence_factor
    gross_gain_kwh = annual_savings_kwh * deployed_rooms
    diversified_gain_kwh = gross_gain_kwh * request.diversity_factor
    realistic_gain_kwh = diversified_gain_kwh * request.prudence_factor

    room_results: list[RoomResult] = []
    descriptions = {
        "room_1": "Référence volontairement défavorable : fonctionnement largement décorrélé de l'usage réel.",
        "room_2": "Référence réaliste : pilotage par horaires fixes et consignes classiques.",
        "room_3": "Pilotage adaptatif : occupation, lumière naturelle, saison et reprise d'activité sont pris en compte.",
    }
    standard_energy = standard["energy_kwh"]

    for room_id, values in room_totals.items():
        room_results.append(
            RoomResult(
                id=room_id,
                name=ROOM_LABELS[room_id],
                energy_kwh=round_energy(values["energy_kwh"]),
                cost_eur=round_money(values["cost_eur"]),
                co2_kg=round_energy(values["co2_kg"]),
                comfort_score=round(
                    values["comfort_weighted"] / values["comfort_weight"] if values["comfort_weight"] else 100.0,
                    1,
                ),
                breakdown=EnergyBreakdown(
                    hvac=round_energy(values["hvac"]),
                    lighting=round_energy(values["lighting"]),
                    ventilation=round_energy(values["ventilation"]),
                    equipment=round_energy(values["equipment"]),
                ),
                relative_savings_vs_standard_pct=pct_change(standard_energy, values["energy_kwh"]),
                description=descriptions[room_id],
            )
        )

    breakdown_labels = {
        "hvac": "CVC",
        "lighting": "Éclairage",
        "ventilation": "Ventilation",
        "equipment": "Équipements",
    }
    energy_breakdown = [
        BreakdownComparison(
            key=key,
            label=label,
            standard_kwh=round_energy(standard[key]),
            optimized_kwh=round_energy(optimized[key]),
            savings_kwh=round_energy(standard[key] - optimized[key]),
            savings_pct=pct_change(standard[key], optimized[key]),
        )
        for key, label in breakdown_labels.items()
    ]

    standard_comfort = room_results[1].comfort_score
    optimized_comfort = room_results[2].comfort_score
    profile = WEATHER_PROFILES[request.weather_profile]
    chart_source = sample_for_chart
    chart_points = _chart_points(*chart_source) if chart_source else []

    return SimulationResponse(
        summary=SummaryResult(
            annual_savings_eur=annual_savings_eur,
            annual_savings_kwh=annual_savings_kwh,
            co2_saved_kg=co2_saved_kg,
            comfort_score=optimized_comfort,
            realistic_campus_gain_eur=round_money(realistic_gain_eur),
            realistic_campus_gain_kwh=round_energy(realistic_gain_kwh),
            gross_campus_gain_eur=round_money(gross_gain_eur),
            gross_campus_gain_kwh=round_energy(gross_gain_kwh),
        ),
        campus=CampusResult(
            room_count=request.room_count,
            deployed_rooms=round(deployed_rooms, 2),
            deployment_rate=request.deployment_rate,
            diversity_factor=request.diversity_factor,
            prudence_factor=request.prudence_factor,
            gross_gain_eur=round_money(gross_gain_eur),
            diversified_gain_eur=round_money(diversified_gain_eur),
            realistic_gain_eur=round_money(realistic_gain_eur),
            gross_gain_kwh=round_energy(gross_gain_kwh),
            diversified_gain_kwh=round_energy(diversified_gain_kwh),
            realistic_gain_kwh=round_energy(realistic_gain_kwh),
        ),
        rooms=room_results,
        seasonal=seasonal_results,
        energy_breakdown=energy_breakdown,
        standard_vs_optimized=StandardVsOptimized(
            standard_energy_kwh=standard_energy_kwh,
            optimized_energy_kwh=optimized_energy_kwh,
            savings_kwh=annual_savings_kwh,
            savings_eur=annual_savings_eur,
            savings_pct=pct_change(standard_energy_kwh, optimized_energy_kwh),
            standard_cost_eur=standard_cost_eur,
            optimized_cost_eur=optimized_cost_eur,
            standard_co2_kg=standard_co2_kg,
            optimized_co2_kg=optimized_co2_kg,
            co2_saved_kg=co2_saved_kg,
            standard_comfort_score=standard_comfort,
            optimized_comfort_score=optimized_comfort,
            comfort_delta=round(optimized_comfort - standard_comfort, 1),
        ),
        chart_points=chart_points,
        metadata=MetadataResult(
            random_seed=request.random_seed,
            weather_profile=request.weather_profile,
            weather_profile_label=str(profile["label"]),
            eco_mode=request.eco_mode,
            kwh_price=request.kwh_price,
            active_weeks=round(sum(season_weeks.values()), 2),
            simulation_hours=SIMULATION_HOURS,
            season_count=len(SEASON_ORDER),
            room_area_m2=ROOM_AREA_M2,
            co2_factor_g_kwh=CO2_FACTOR_G_KWH,
            note=(
                "Estimations issues d'une simulation horaire. Le gain campus réaliste applique le taux de "
                "déploiement, le foisonnement et le coefficient de prudence après le calcul du gain "
                "standard moins optimisé."
            ),
        ),
    )
