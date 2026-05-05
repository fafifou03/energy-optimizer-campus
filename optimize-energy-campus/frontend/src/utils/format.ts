export const formatEuro = (value: number) =>
  new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: Math.abs(value) >= 1000 ? 0 : 1,
  }).format(value);

export const formatNumber = (value: number, maximumFractionDigits = 1) =>
  new Intl.NumberFormat("fr-FR", { maximumFractionDigits }).format(value);

export const formatKwh = (value: number) => {
  if (Math.abs(value) >= 1000) {
    return `${formatNumber(value / 1000, 1)} MWh`;
  }
  return `${formatNumber(value, 0)} kWh`;
};

export const formatCo2 = (value: number) => {
  if (Math.abs(value) >= 1000) {
    return `${formatNumber(value / 1000, 1)} t CO₂`;
  }
  return `${formatNumber(value, 0)} kg CO₂`;
};

export const formatPct = (value: number) => `${formatNumber(value * 100, 0)} %`;

export const formatDeltaPct = (value: number) => `${value > 0 ? "+" : ""}${formatNumber(value, 1)} %`;
