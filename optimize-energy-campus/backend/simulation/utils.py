"""Small formatting and numeric helpers for the simulation engine."""

from __future__ import annotations


def round_money(value: float) -> float:
    return round(float(value), 2)


def round_energy(value: float) -> float:
    return round(float(value), 1)


def pct_change(reference: float, value: float) -> float:
    if abs(reference) < 1e-9:
        return 0.0
    return round((float(reference) - float(value)) / float(reference) * 100.0, 1)


def clamp(value: float, lower: float, upper: float) -> float:
    return min(max(float(value), lower), upper)
