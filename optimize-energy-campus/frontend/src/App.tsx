import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { defaultSimulationRequest, weatherProfiles } from "./data/defaults";
import { simulateCampus } from "./services/api";
import type { ChartPoint, RoomResult, SimulationRequest, SimulationResponse, WeatherProfile } from "./types/simulation";
import { formatCo2, formatDeltaPct, formatEuro, formatKwh, formatNumber, formatPct } from "./utils/format";
import "./styles/app.css";
import "./styles/additions.css";

const apiErrorMessage = "Impossible de contacter le moteur de simulation Python. Vérifiez que le backend FastAPI est lancé.";

const trackedSectionIds = [
  "garde",
  "contexte",
  "tableau",
  "probleme",
  "strategies",
  "signaux",
  "algorithme",
  "gains",
  "comparaison",
  "campus",
];

const journeyItems = [
  {
    number: "01",
    title: "Comprendre le cadre",
    description: "Simulation pédagogique, trois salles et données simulées.",
    target: "contexte",
    accent: "cyan",
  },
  {
    number: "02",
    title: "Modifier puis lancer",
    description: "Salles, présence, météo, prix du kWh, seed et marges de prudence.",
    target: "tableau",
    accent: "amber",
  },
  {
    number: "03",
    title: "Comparer les salles",
    description: "Salle 1 défavorable, salle 2 standard, salle 3 optimisée.",
    target: "strategies",
    accent: "emerald",
  },
  {
    number: "04",
    title: "Lire les signaux",
    description: "Occupation, lumière, météo, température et horaires expliquent l'arbitrage.",
    target: "signaux",
    accent: "blue",
  },
  {
    number: "05",
    title: "Retenir le gain prudent",
    description: "Le chiffre défendable applique déploiement, foisonnement et prudence.",
    target: "gains",
    accent: "cyan",
  },
];

const wasteExamples = [
  { text: "Chauffage ou climatisation actifs alors que l'occupation simulée tombe à zéro." },
  { text: "Éclairage maintenu alors que la lumière naturelle suffit déjà." },
  { text: "Ventilation et équipements calés sur les horaires plutôt que sur la présence réelle." },
];

const baseSignals = [
  {
    id: "meteo",
    nom: "Météo",
    valeur: "En attente",
    detail: "Température extérieure, couverture nuageuse, inertie du bâtiment.",
    accent: "#7FB7FF",
    zone: "Façade nord",
  },
  {
    id: "occupation",
    nom: "Occupation",
    valeur: "En attente",
    detail: "Présence réelle, capacité, horaires et variations de dernière minute.",
    accent: "#63D99E",
    zone: "Zone élèves",
  },
  {
    id: "luminosite",
    nom: "Luminosité",
    valeur: "En attente",
    detail: "Apport de lumière naturelle et besoin d'éclairage artificiel.",
    accent: "#E8C46D",
    zone: "Baies vitrées",
  },
  {
    id: "temperature",
    nom: "Température intérieure",
    valeur: "En attente",
    detail: "Température mesurée dans la salle et marge de confort disponible.",
    accent: "#54D6B4",
    zone: "Zone de confort",
  },
  {
    id: "reprise",
    nom: "Prochaine occupation",
    valeur: "En attente",
    detail: "Reprise estimée à partir de la séquence d'occupation simulée.",
    accent: "#A6B8FF",
    zone: "Planning",
  },
  {
    id: "horaires",
    nom: "Horaires / jour ouvré",
    valeur: "En attente",
    detail: "Calendrier, jour de semaine et consignes associées au bâtiment.",
    accent: "#C2A4FF",
    zone: "Rythme campus",
  },
];

const engineActions = ["Prioriser le confort", "Limiter les consommations inutiles", "Adapter l'action en temps réel"];

type Signal = (typeof baseSignals)[number];

type TimeRange = "week" | "month" | "year";

type LaserPulse = {
  id: number;
  angle: number;
  duration: number;
  scale: number;
  tone: "cyan" | "amber";
  x: number;
  y: number;
};

const createLaserPulse = (id: number, variant: "context" | "problem"): LaserPulse => {
  const isContext = variant === "context";
  const peripheralBand = Math.random() > 0.5 ? 0 : 1;
  const y = peripheralBand === 0 ? 8 + Math.random() * 18 : 74 + Math.random() * 14;
  const angle = isContext ? -10 + Math.random() * 18 : 8 + Math.random() * 18;
  return {
    id,
    angle,
    duration: 5200 + Math.random() * 2200,
    scale: 0.72 + Math.random() * 0.34,
    tone: Math.random() > 0.48 ? "cyan" : "amber",
    x: isContext ? -12 + Math.random() * 18 : -10 + Math.random() * 16,
    y,
  };
};

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const sanitizeSimulationRequest = (payload: SimulationRequest): SimulationRequest => ({
  room_count: Math.round(clampNumber(Number.isFinite(payload.room_count) ? payload.room_count : defaultSimulationRequest.room_count, 1, 500)),
  average_people_per_room: Math.round(
    clampNumber(
      Number.isFinite(payload.average_people_per_room)
        ? payload.average_people_per_room
        : defaultSimulationRequest.average_people_per_room,
      1,
      250,
    ),
  ),
  presence_rate: clampNumber(
    Number.isFinite(payload.presence_rate) ? payload.presence_rate : defaultSimulationRequest.presence_rate,
    0.05,
    1,
  ),
  weather_profile: payload.weather_profile,
  kwh_price: clampNumber(Number.isFinite(payload.kwh_price) ? payload.kwh_price : defaultSimulationRequest.kwh_price, 0.01, 2),
  active_weeks: Math.round(clampNumber(Number.isFinite(payload.active_weeks) ? payload.active_weeks : defaultSimulationRequest.active_weeks, 1, 52)),
  deployment_rate: clampNumber(
    Number.isFinite(payload.deployment_rate) ? payload.deployment_rate : defaultSimulationRequest.deployment_rate,
    0,
    1,
  ),
  diversity_factor: clampNumber(
    Number.isFinite(payload.diversity_factor) ? payload.diversity_factor : defaultSimulationRequest.diversity_factor,
    0.1,
    1,
  ),
  prudence_factor: clampNumber(
    Number.isFinite(payload.prudence_factor) ? payload.prudence_factor : defaultSimulationRequest.prudence_factor,
    0.1,
    1,
  ),
  random_seed: Math.round(
    clampNumber(Number.isFinite(payload.random_seed) ? payload.random_seed : defaultSimulationRequest.random_seed, 0, 1_000_000),
  ),
  eco_mode: payload.eco_mode,
});

const areSimulationRequestsEqual = (left: SimulationRequest, right: SimulationRequest) =>
  left.room_count === right.room_count &&
  left.average_people_per_room === right.average_people_per_room &&
  left.presence_rate === right.presence_rate &&
  left.weather_profile === right.weather_profile &&
  left.kwh_price === right.kwh_price &&
  left.active_weeks === right.active_weeks &&
  left.deployment_rate === right.deployment_rate &&
  left.diversity_factor === right.diversity_factor &&
  left.prudence_factor === right.prudence_factor &&
  left.random_seed === right.random_seed &&
  left.eco_mode === right.eco_mode;

const roomRoleLabel: Record<string, string> = {
  room_1: "scénario défavorable",
  room_2: "fonctionnement standard",
  room_3: "algorithme optimisé",
};

const roomSelectLabel: Record<string, string> = {
  room_1: "Salle 1 — scénario défavorable",
  room_2: "Salle 2 — fonctionnement standard",
  room_3: "Salle 3 — algorithme optimisé",
};

const buildRoomSummary = (room: RoomResult, standardRoom: RoomResult | undefined, result: SimulationResponse) => {
  const energyDelta = standardRoom ? standardRoom.energy_kwh - room.energy_kwh : 0;
  const costDelta = standardRoom ? standardRoom.cost_eur - room.cost_eur : 0;
  const co2Delta = standardRoom ? standardRoom.co2_kg - room.co2_kg : 0;
  const pctDelta = standardRoom && standardRoom.energy_kwh ? (energyDelta / standardRoom.energy_kwh) * 100 : 0;
  const deltaValue =
    room.id === "room_2"
      ? "-"
      : energyDelta >= 0
        ? `${formatDeltaPct(pctDelta)}`
        : `+ ${formatNumber(Math.abs(pctDelta), 1)} %`;

  return {
    id: room.id,
    name: roomSelectLabel[room.id] ?? room.name,
    role: roomRoleLabel[room.id] ?? room.description,
    energy: formatKwh(room.energy_kwh),
    cost: formatEuro(room.cost_eur),
    co2: formatCo2(room.co2_kg),
    comfort: `${formatNumber(room.comfort_score, 1)} / 100`,
    delta: deltaValue,
    deltaDetail:
      room.id === "room_2"
        ? "Base officielle de comparaison"
        : `${formatKwh(Math.abs(energyDelta))} | ${formatEuro(Math.abs(costDelta))} | ${formatCo2(Math.abs(co2Delta))}`,
    isOfficialOptimized: room.id === "room_3" && result.standard_vs_optimized.savings_kwh >= 0,
  };
};

type RoomSummaryRow = ReturnType<typeof buildRoomSummary>;

const makeRoomMetrics = (room: RoomSummaryRow) => {
  const deltaLabel =
    room.id === "room_1" ? "Surconsommation vs standard" :
    room.id === "room_2" ? "Référence de comparaison" :
    "Économie vs standard";
  return [
    { label: "Consommation", value: room.energy },
    { label: "Coût estimé", value: room.cost },
    { label: "CO₂", value: room.co2 },
    { label: "Confort", value: room.comfort },
    { label: deltaLabel, value: room.delta },
  ];
};

const AnimatedCounter = ({
  value,
  duration = 1800,
  className = "",
  formatter = (next: number) => formatNumber(next, 0),
}: {
  value: number;
  duration?: number;
  className?: string;
  formatter?: (value: number) => string;
}) => {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      setCount(value);
      return;
    }

    let startTime: number | null = null;
    let animationFrame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) {
          return;
        }

        const step = (timestamp: number) => {
          if (!startTime) startTime = timestamp;
          const progress = Math.min((timestamp - startTime) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 4);
          setCount(Math.floor(eased * value));
          if (progress < 1) {
            animationFrame = window.requestAnimationFrame(step);
          }
        };

        animationFrame = window.requestAnimationFrame(step);
        observer.disconnect();
      },
      { threshold: 0.45 },
    );

    if (ref.current) observer.observe(ref.current);

    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, [duration, value]);

  return (
    <span ref={ref} className={className}>
      {formatter(count)}
    </span>
  );
};

const EnergyLaserBackground = ({ variant }: { variant: "context" | "problem" }) => {
  const [pulses, setPulses] = useState<LaserPulse[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      return;
    }

    const spawn = () => {
      const count = Math.random() > 0.34 ? 2 : 3;
      const next = Array.from({ length: count }, () => createLaserPulse(idRef.current++, variant));
      setPulses((current) => [...current.slice(-9), ...next]);
      next.forEach((pulse) => {
        window.setTimeout(() => {
          setPulses((current) => current.filter((item) => item.id !== pulse.id));
        }, pulse.duration + 420);
      });
    };

    const initialDelay = window.setTimeout(spawn, variant === "context" ? 650 : 1150);
    const interval = window.setInterval(spawn, 1850);
    return () => {
      window.clearTimeout(initialDelay);
      window.clearInterval(interval);
    };
  }, [variant]);

  return (
    <div className={`energy-laser-layer energy-laser-layer--${variant}`} aria-hidden="true">
      {pulses.map((pulse) => (
        <div
          className={`energy-laser energy-laser--${pulse.tone}`}
          key={pulse.id}
          style={
            {
              "--laser-angle": `${pulse.angle}deg`,
              "--laser-duration": `${pulse.duration}ms`,
              "--laser-scale": pulse.scale,
              "--laser-x": `${pulse.x}%`,
              "--laser-y": `${pulse.y}%`,
            } as CSSProperties
          }
        >
          <span className="energy-laser__beam" />
          <span className="energy-laser__burst energy-laser__burst--lead" />
          <span className="energy-laser__burst energy-laser__burst--tail" />
        </div>
      ))}
    </div>
  );
};

export const App = () => {
  const [request, setRequest] = useState<SimulationRequest>(defaultSimulationRequest);
  const [result, setResult] = useState<SimulationResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [activeRange, setActiveRange] = useState<TimeRange>("week");
  const [activeSignalId, setActiveSignalId] = useState(baseSignals[0].id);
  const [hoveredSignalId, setHoveredSignalId] = useState<string | null>(null);
  const [pinnedSignalId, setPinnedSignalId] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState("garde");
  const signalSectionRef = useRef<HTMLElement | null>(null);
  const simulationRunIdRef = useRef(0);

  const runSimulation = async (payload: SimulationRequest) => {
    const runId = simulationRunIdRef.current + 1;
    simulationRunIdRef.current = runId;
    const safePayload = sanitizeSimulationRequest(payload);
    setRequest((current) => (areSimulationRequestsEqual(current, safePayload) ? current : safePayload));
    setIsLoading(true);
    setApiError(null);
    try {
      const response = await simulateCampus(safePayload);
      if (simulationRunIdRef.current === runId) {
        setResult(response);
      }
    } catch (error) {
      if (simulationRunIdRef.current !== runId) {
        return;
      }
      const message = error instanceof Error ? error.message : apiErrorMessage;
      const isNetworkError = message.toLowerCase().includes("failed to fetch") || message.toLowerCase().includes("network");
      setApiError(
        message.includes("422")
          ? "Paramètre invalide : vérifiez les bornes de la simulation puis relancez."
          : isNetworkError
            ? apiErrorMessage
            : message,
      );
    } finally {
      if (simulationRunIdRef.current === runId) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void runSimulation(request);
    }, result ? 450 : 0);

    return () => window.clearTimeout(timeout);
  }, [request]);

  const currentPoint = result?.chart_points[1] ?? result?.chart_points[0];
  const rooms = result?.rooms ?? [];
  const standardRoom = rooms.find((room) => room.id === "room_2");
  const optimizedRoom = rooms.find((room) => room.id === "room_3");
  const worstRoom = rooms.find((room) => room.id === "room_1");

  const signaux = useMemo(
    () =>
      baseSignals.map((signal) => {
        if (!result || !currentPoint) return signal;
        const values: Record<string, string> = {
          meteo: `${formatNumber(currentPoint.outside_temp_c, 1)} °C`,
          occupation: `${currentPoint.occupancy} pers.`,
          luminosite: `${formatNumber(currentPoint.luminosity_pct, 0)} %`,
          temperature: `${formatNumber(currentPoint.optimized_temp_c, 1)} °C`,
          reprise: `${formatNumber(result.metadata.active_weeks, 0)} sem.`,
          horaires: `${result.metadata.simulation_hours} h`,
        };
        return { ...signal, valeur: values[signal.id] ?? signal.valeur };
      }),
    [currentPoint, result],
  );

  const energySavingsPct = result?.standard_vs_optimized.savings_pct ?? 0;
  const engineInputs = [
    { label: "Météo", value: currentPoint ? `${formatNumber(currentPoint.outside_temp_c, 1)} °C` : "En attente" },
    { label: "Occupation", value: currentPoint ? `${currentPoint.occupancy} pers.` : "En attente" },
    { label: "Luminosité", value: currentPoint ? `${formatNumber(currentPoint.luminosity_pct, 0)} %` : "En attente" },
  ];
  const engineOutputs = result
    ? result.energy_breakdown.map((item) => ({
        label: item.label,
        value: item.savings_kwh < 0 ? `${formatKwh(item.savings_kwh)} confort` : formatKwh(item.savings_kwh),
      }))
    : [
        { label: "CVC", value: "En attente" },
        { label: "Éclairage", value: "En attente" },
        { label: "Ventilation", value: "En attente" },
        { label: "Équipements", value: "En attente" },
      ];
  const impactOutputs = result
    ? [
        { label: "Énergie", value: formatDeltaPct(energySavingsPct), accent: "emerald" },
        { label: "Coût", value: formatEuro(result.summary.annual_savings_eur), accent: "amber" },
        { label: "CO₂", value: formatCo2(result.summary.co2_saved_kg), accent: "cyan" },
        { label: "Confort", value: `${formatNumber(result.summary.comfort_score, 1)} / 100`, accent: "blue" },
      ]
    : [
        { label: "Énergie", value: "En attente", accent: "emerald" },
        { label: "Coût", value: "En attente", accent: "amber" },
        { label: "CO₂", value: "En attente", accent: "cyan" },
        { label: "Confort", value: "En attente", accent: "blue" },
      ];
  const indicateurs = result
    ? [
        {
          label: "Gain campus prudent",
          value: formatEuro(result.summary.realistic_campus_gain_eur),
          detail: "Indicateur principal : déploiement, foisonnement et prudence déjà appliqués.",
          accent: "emerald",
          primary: true,
        },
        {
          label: "Économie annuelle en €",
          value: formatEuro(result.summary.annual_savings_eur),
          detail: "Écart de coût entre la salle standard et la salle optimisée.",
          accent: "amber",
        },
        {
          label: "Économie annuelle en kWh",
          value: formatKwh(result.summary.annual_savings_kwh),
          detail: "Énergie évitée sur une année active simulée.",
          accent: "cyan",
        },
        {
          label: "CO₂ évité",
          value: formatCo2(result.summary.co2_saved_kg),
          detail: "Émissions évitées avec le facteur carbone du moteur.",
          accent: "amber",
        },
        {
          label: "Score de confort",
          value: `${formatNumber(result.summary.comfort_score, 1)} / 100`,
          detail: "Confort préservé sur les heures réellement occupées.",
          accent: "blue",
        },
      ]
    : [];
  const kpiReveals = result
    ? [
        {
          label: "Gain campus prudent",
          value: Math.round(result.summary.realistic_campus_gain_eur),
          formatter: formatEuro,
          detail: "Résultat réaliste après foisonnement et prudence.",
          accent: "emerald",
        },
        {
          label: "Moins d'énergie consommée",
          value: Math.round(result.summary.annual_savings_kwh),
          formatter: formatKwh,
          detail: "Écart annuel entre le standard et l'optimisé.",
          accent: "cyan",
        },
        {
          label: "Moins d'émissions CO₂",
          value: Math.round(result.summary.co2_saved_kg),
          formatter: formatCo2,
          detail: "Estimation issue du facteur carbone du moteur Python.",
          accent: "amber",
        },
        {
          label: "Confort calculé",
          value: Math.round(result.summary.comfort_score),
          formatter: (value: number) => `${formatNumber(value, 0)} / 100`,
          detail: "Score obtenu sur les heures réellement occupées.",
          accent: "blue",
        },
      ]
    : [];

  const activeWeeks = Math.max(1, result?.metadata.active_weeks ?? request.active_weeks);
  const periodDivisor = activeRange === "week" ? activeWeeks : activeRange === "month" ? 12 : 1;
  const periodScale = activeRange === "week" ? 1 : activeRange === "month" ? activeWeeks / 12 : activeWeeks;
  const rangeLabels: Record<TimeRange, { title: string; shortTitle: string; subtitle: string; oralCue: string }> = {
    week: {
      title: "Semaine active",
      shortTitle: "Semaine",
      subtitle: "Lecture directe de la semaine simulée de 168 heures.",
      oralCue: "Base de démonstration : la même semaine est jouée en standard puis en optimisé.",
    },
    month: {
      title: "Mois moyen",
      shortTitle: "Mois",
      subtitle: "Projection mensuelle à partir des semaines actives configurées.",
      oralCue: "Utile pour donner un ordre de grandeur facile à retenir pendant la soutenance.",
    },
    year: {
      title: "Année active",
      shortTitle: "Année",
      subtitle: "Projection annuelle sur les semaines actives du campus.",
      oralCue: "Chiffre de conclusion : l'impact campus prudent, après déploiement, foisonnement et prudence.",
    },
  };
  const activeRangeLabel = rangeLabels[activeRange];
  const periodComparison = result
    ? {
        standardEnergy: result.standard_vs_optimized.standard_energy_kwh * periodScale,
        optimizedEnergy: result.standard_vs_optimized.optimized_energy_kwh * periodScale,
        savingsEnergy: result.standard_vs_optimized.savings_kwh * periodScale,
        standardCost: result.standard_vs_optimized.standard_cost_eur * periodScale,
        optimizedCost: result.standard_vs_optimized.optimized_cost_eur * periodScale,
        savingsCost: result.standard_vs_optimized.savings_eur * periodScale,
        standardCo2: result.standard_vs_optimized.standard_co2_kg * periodScale,
        optimizedCo2: result.standard_vs_optimized.optimized_co2_kg * periodScale,
        co2Saved: result.standard_vs_optimized.co2_saved_kg * periodScale,
        savingsPct: result.standard_vs_optimized.savings_pct,
        standardComfort: result.standard_vs_optimized.standard_comfort_score,
        optimizedComfort: result.standard_vs_optimized.optimized_comfort_score,
        comfortDelta: result.standard_vs_optimized.comfort_delta,
        annualEnergySaved: result.summary.annual_savings_kwh / periodDivisor,
        annualCostSaved: result.summary.annual_savings_eur / periodDivisor,
        annualCo2Saved: result.summary.co2_saved_kg / periodDivisor,
        campusPrudent: result.summary.realistic_campus_gain_eur / periodDivisor,
      }
    : null;
  const presentationKpis = periodComparison
    ? [
        {
          label: "Énergie économisée",
          value: formatKwh(periodComparison.annualEnergySaved),
          detail: activeRangeLabel.shortTitle,
          accent: "cyan",
        },
        {
          label: "Budget évité",
          value: formatEuro(periodComparison.annualCostSaved),
          detail: activeRangeLabel.shortTitle,
          accent: "emerald",
        },
        {
          label: "CO₂ évité",
          value: formatCo2(periodComparison.annualCo2Saved),
          detail: activeRangeLabel.shortTitle,
          accent: "amber",
        },
        {
          label: "Gain campus prudent",
          value: formatEuro(periodComparison.campusPrudent),
          detail: "avec marge de prudence",
          accent: "blue",
        },
      ]
    : [];
  const projectionSteps = result
    ? [
        {
          label: "Gain par salle",
          formula: "salle standard - salle optimisée",
          value: `${formatKwh(result.standard_vs_optimized.savings_kwh)} / ${formatEuro(result.standard_vs_optimized.savings_eur)}`,
        },
        {
          label: "Salles déployées",
          formula: "nombre de salles × taux de déploiement",
          value: `${formatNumber(result.campus.deployed_rooms, 1)} salles`,
        },
        {
          label: "Gain brut",
          formula: "gain par salle × salles déployées",
          value: `${formatKwh(result.campus.gross_gain_kwh)} / ${formatEuro(result.campus.gross_gain_eur)}`,
        },
        {
          label: "Après foisonnement",
          formula: "gain brut × facteur de foisonnement",
          value: `${formatKwh(result.campus.diversified_gain_kwh)} / ${formatEuro(result.campus.diversified_gain_eur)}`,
        },
        {
          label: "Gain prudent",
          formula: "gain après foisonnement × facteur de prudence",
          value: `${formatKwh(result.campus.realistic_gain_kwh)} / ${formatEuro(result.campus.realistic_gain_eur)}`,
        },
      ]
    : [];
  const officialSavingsLabel = result
    ? `${formatKwh(periodComparison?.savingsEnergy ?? 0)} et ${formatEuro(periodComparison?.savingsCost ?? 0)} économisés vs salle standard`
    : "Lancez une simulation pour lire l'économie officielle vs salle standard.";
  const roomSummaryRows = result
    ? rooms.map((room) => buildRoomSummary(room, standardRoom, result))
    : [];
  const worstSummary = roomSummaryRows.find((room) => room.id === "room_1");
  const standardSummary = roomSummaryRows.find((room) => room.id === "room_2");
  const optimizedSummary = roomSummaryRows.find((room) => room.id === "room_3");
  const apiStatusLabel = apiError ? apiError : isLoading ? "Simulation en cours" : result ? "Moteur FastAPI connecté" : "En attente de simulation";
  const apiStatusTone = apiError ? "error" : isLoading ? "loading" : result ? "connected" : "idle";
  const resetSimulation = () => {
    void runSimulation(defaultSimulationRequest);
  };
  const launchNewSeed = () => {
    const next = {
      ...request,
      random_seed: Math.floor(Math.random() * 1_000_000),
    };
    void runSimulation(next);
  };

  const displayedSignalId = pinnedSignalId ?? hoveredSignalId ?? activeSignalId;
  const activeSignal = signaux.find((signal) => signal.id === displayedSignalId) ?? signaux[0];
  const scrollToSection = (target: string) => {
    const element = document.getElementById(target);
    if (!element) return;
    element.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${target}`);
  };

  useEffect(() => {
    const updateActiveSignal = () => {
      const section = signalSectionRef.current;
      if (!section || hoveredSignalId || pinnedSignalId) return;
      const rect = section.getBoundingClientRect();
      const travel = Math.max(1, window.innerHeight + rect.height);
      const progress = Math.min(1, Math.max(0, (window.innerHeight - rect.top) / travel));
      const index = Math.min(signaux.length - 1, Math.floor(progress * signaux.length));
      setActiveSignalId(signaux[index].id);
    };

    updateActiveSignal();
    window.addEventListener("scroll", updateActiveSignal, { passive: true });
    window.addEventListener("resize", updateActiveSignal);
    return () => {
      window.removeEventListener("scroll", updateActiveSignal);
      window.removeEventListener("resize", updateActiveSignal);
    };
  }, [hoveredSignalId, pinnedSignalId, signaux]);

  useEffect(() => {
    const updateActiveSection = () => {
      const current =
        [...trackedSectionIds].reverse().find((id) => {
          const element = document.getElementById(id);
          return element ? element.getBoundingClientRect().top < window.innerHeight * 0.42 : false;
        }) ?? "garde";
      setActiveSection(current);
    };

    updateActiveSection();
    window.addEventListener("scroll", updateActiveSection, { passive: true });
    window.addEventListener("resize", updateActiveSection);
    return () => {
      window.removeEventListener("scroll", updateActiveSection);
      window.removeEventListener("resize", updateActiveSection);
    };
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.1, rootMargin: "0px 0px -50px 0px" },
    );

    const elements = document.querySelectorAll(".reveal-up, .reveal-scale, .reveal-left, .reveal-right");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, []);

  return (
    <main className="site-shell">
      <section id="garde" className="hero-section" aria-labelledby="hero-title">
        <div className="hero-background" aria-hidden="true">
          <div className="hero-background__image" />
          <div className="hero-background__flow" />
          <div className="hero-background__veil" />
        </div>

        <nav className="top-nav reveal-up" aria-label="Navigation principale">
          <NavLink active={activeSection === "contexte"} target="contexte" onSelect={scrollToSection}>
            Contexte
          </NavLink>
          <NavLink active={activeSection === "tableau"} target="tableau" onSelect={scrollToSection}>
            Simulateur
          </NavLink>
          <NavLink
            active={["probleme", "strategies", "signaux", "algorithme"].includes(activeSection)}
            target="probleme"
            onSelect={scrollToSection}
          >
            Système
          </NavLink>
          <NavLink active={["gains", "comparaison"].includes(activeSection)} target="gains" onSelect={scrollToSection}>
            Résultats
          </NavLink>
          <NavLink active={activeSection === "campus"} target="campus" onSelect={scrollToSection}>
            Campus
          </NavLink>
        </nav>

        <div className="hero-content">
          <p className="kicker">Simulation énergétique universitaire</p>
          <h1 id="hero-title">
            <span>Energy Optimizer</span>
            <span>Campus</span>
          </h1>
          <p className="hero-subtitle">
            Simuler, comparer et optimiser la consommation énergétique d'une salle de classe.
          </p>
          <div className="hero-actions">
            <a
              className="primary-cta"
              href="#contexte"
              onClick={(event) => {
                event.preventDefault();
                scrollToSection("contexte");
              }}
            >
              <span>Comprendre le simulateur</span>
              <i aria-hidden="true" />
            </a>
            <a
              className="secondary-cta"
              href="#tableau"
              onClick={(event) => {
                event.preventDefault();
                scrollToSection("tableau");
              }}
            >
              Ouvrir le dashboard
            </a>
          </div>
        </div>
      </section>

      <section id="contexte" className="context-section">
        <div className="context-background reveal-scale" aria-hidden="true" />
        <EnergyLaserBackground variant="context" />

        <div className="context-content">
          <div className="context-copy reveal-up">
            <p className="kicker">Présentation du projet</p>
            <h2>Un simulateur pédagogique pour rendre l'énergie lisible.</h2>
            <p>
              Energy Optimizer Campus compare trois stratégies de gestion énergétique sur une semaine simulée de 168 heures.
              Le moteur prend en compte l'occupation, la météo, la luminosité et la température pour estimer consommation, coût, CO₂ et confort.
            </p>
            <div className="demo-note reveal-up delay-200">
              Les résultats sont des estimations de simulation, pas des mesures terrain. Le chiffre principal à retenir est le gain campus prudent.
            </div>
          </div>

          <div className="context-method-card reveal-right delay-100">
            <p className="kicker">Comment lire la simulation ?</p>
            {[
              ["01", "Modifier les hypothèses", "Ajustez les paramètres : nombre de salles, météo, prix du kWh, marges de prudence."],
              ["02", "Lancer la simulation", "Le moteur Python calcule 168 heures de consommation pour trois stratégies."],
              ["03", "Comparer standard vs optimisé", "Lisez l'écart entre la salle 2 standard et la salle 3 optimisée."],
            ].map(([number, title, desc]) => (
              <button className="reading-step" key={number} type="button" onClick={() => scrollToSection(number === "01" || number === "02" ? "tableau" : "comparaison")}>
                <span>{number}</span>
                <strong>{title}</strong>
                <em>{desc}</em>
              </button>
            ))}
          </div>
        </div>

        <div className="context-room-strip reveal-up delay-200" aria-label="Lecture rapide des trois salles">
          {[
            ["Salle 1", "Scénario défavorable", "Fonctionnement continu sans adaptation : repère de gaspillage maximal."],
            ["Salle 2", "Référence standard", "Pilotage horaire classique : la base officielle de comparaison."],
            ["Salle 3", "Algorithme optimisé", "Arbitrage dynamique heure par heure selon les signaux simulés."],
          ].map(([title, label, desc]) => (
            <div className="context-room-card" key={title}>
              <span>{title}</span>
              <strong>{label}</strong>
              <p>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="tableau" className="dashboard-section dashboard-section--early">
        <div className={`dashboard-status-strip dashboard-status-strip--${apiStatusTone} reveal-up`}>
          <div className="status-dot pulse" />
          <span>{apiStatusLabel}</span>
          <span className="divider" />
          <span>{result?.metadata.weather_profile_label ?? weatherProfiles.find((profile) => profile.value === request.weather_profile)?.label}</span>
          <span className="divider" />
          <span>Seed {formatNumber(request.random_seed, 0)}</span>
          <span className="divider" />
          <span>{request.eco_mode ? "Mode éco" : "Mode normal"}</span>
        </div>

        {apiError ? <div className="dashboard-api-alert reveal-up delay-100">{apiError}</div> : null}

        <div className="dashboard-header reveal-up delay-100">
          <div>
            <p className="kicker">Dashboard interactif / simulateur campus</p>
            <h2>Tableau de bord</h2>
            <p className="dashboard-lead">
              Ajustez les paramètres, lancez le moteur Python, puis comparez le standard avec l'algorithme optimisé.
            </p>
          </div>
        </div>

        <div className="presentation-dashboard reveal-up delay-200">
          <div className="presentation-toolbar">
            <div>
              <span>Lecture de soutenance</span>
              <strong>{activeRangeLabel.title}</strong>
              <p>{activeRangeLabel.subtitle}</p>
            </div>
            <div className="time-range-switch time-range-switch--presentation" aria-label="Période de lecture">
              {[
                { key: "week" as const, label: "Semaine" },
                { key: "month" as const, label: "Mois" },
                { key: "year" as const, label: "Année" },
              ].map((item) => (
                <button
                  className={activeRange === item.key ? "range-btn range-btn--active" : "range-btn"}
                  key={item.key}
                  type="button"
                  onClick={() => setActiveRange(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {result && periodComparison ? (
            <>
              <div className="comparison-board">
                <article className="comparison-room comparison-room--standard">
                  <span>Salle 2</span>
                  <h3>Standard</h3>
                  <p>Pilotage classique : horaires fixes, moins de réaction aux usages réels.</p>
                  <dl>
                    <div>
                      <dt>Consommation</dt>
                      <dd>{formatKwh(periodComparison.standardEnergy)}</dd>
                    </div>
                    <div>
                      <dt>Coût</dt>
                      <dd>{formatEuro(periodComparison.standardCost)}</dd>
                    </div>
                    <div>
                      <dt>CO₂</dt>
                      <dd>{formatCo2(periodComparison.standardCo2)}</dd>
                    </div>
                    <div>
                      <dt>Confort</dt>
                      <dd>{formatNumber(periodComparison.standardComfort, 1)} / 100</dd>
                    </div>
                  </dl>
                </article>

                <div className="comparison-difference">
                  <span>Différence clé</span>
                  <strong>{formatNumber(periodComparison.savingsPct, 1)} %</strong>
                  <p>{officialSavingsLabel}</p>
                  <div>
                    <small>{formatKwh(periodComparison.savingsEnergy)}</small>
                    <small>{formatEuro(periodComparison.savingsCost)}</small>
                    <small>{formatCo2(periodComparison.co2Saved)}</small>
                    <small>Campus prudent : {formatEuro(periodComparison.campusPrudent)}</small>
                  </div>
                </div>

                <article className="comparison-room comparison-room--optimized">
                  <span>Salle 3</span>
                  <h3>Optimisée</h3>
                  <p>Algorithme dynamique : occupation, météo, luminosité et confort guident l'action.</p>
                  <dl>
                    <div>
                      <dt>Consommation</dt>
                      <dd>{formatKwh(periodComparison.optimizedEnergy)}</dd>
                    </div>
                    <div>
                      <dt>Coût</dt>
                      <dd>{formatEuro(periodComparison.optimizedCost)}</dd>
                    </div>
                    <div>
                      <dt>CO₂</dt>
                      <dd>{formatCo2(periodComparison.optimizedCo2)}</dd>
                    </div>
                    <div>
                      <dt>Confort</dt>
                      <dd>{formatNumber(periodComparison.optimizedComfort, 1)} / 100</dd>
                    </div>
                  </dl>
                </article>
              </div>

              <div className="presentation-kpi-grid" aria-label="KPI principaux">
                {presentationKpis.map((item) => (
                  <article className={`presentation-kpi presentation-kpi--${item.accent}`} key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value}</strong>
                    <em>{item.detail}</em>
                  </article>
                ))}
              </div>

              <div className="evidence-grid">
                <article className="panel panel--wide">
                  <PanelHeading
                    title="Courbe de consommation"
                    subtitle="La courbe montre visuellement l'écart entre standard et optimisé sur la semaine simulée."
                  />
                  <ConsumptionChart data={result.chart_points} />
                </article>
                <article className="panel">
                  <PanelHeading title="D'où viennent les économies ?" subtitle="Lecture par poste énergétique." />
                  <Breakdown breakdown={result.energy_breakdown} />
                </article>
              </div>

              <details className="advanced-settings">
                <summary>
                  <span>Modifier les hypothèses avancées</span>
                  <small>
                    {result.metadata.weather_profile_label} · {formatNumber(request.room_count, 0)} salles · seed {formatNumber(request.random_seed, 0)}
                  </small>
                </summary>
                <ScenarioControls
                  value={request}
                  loading={isLoading}
                  onChange={setRequest}
                  onSubmit={() => void runSimulation(request)}
                  onReset={resetSimulation}
                  onNewSeed={launchNewSeed}
                />
              </details>

              <details className="projection-details">
                <summary>
                  <span>Voir le calcul prudent campus</span>
                  <small>Pour expliquer pourquoi le chiffre final reste défendable.</small>
                </summary>
                <div className="projection-pipeline">
                  {projectionSteps.map((step, index) => (
                    <div className="projection-step" key={step.label}>
                      <span>{index + 1}</span>
                      <strong>{step.label}</strong>
                      <em>{step.formula}</em>
                      <b>{step.value}</b>
                    </div>
                  ))}
                </div>
              </details>
            </>
          ) : (
            <EmptyState title="Simulation en attente" text="Lancez le moteur pour afficher le comparatif standard vs optimisé." />
          )}
        </div>
      </section>


      <section id="probleme" className="problem-section">
        <div className="transition-wave reveal-up" aria-hidden="true" />
        <EnergyLaserBackground variant="problem" />
        <div className="section-copy section-copy--center reveal-up">
          <p className="kicker">Problème / gaspillage invisible</p>
          <h2>Le gaspillage reste invisible quand la salle n'est plus observée.</h2>
          <p>
            Les paramètres du dashboard montrent le problème : présence, météo, lumière naturelle et horaires varient,
            mais un pilotage classique réagit souvent trop tard ou pas du tout.
          </p>
        </div>
        <div className="waste-grid">
          {wasteExamples.map((item, index) => (
            <div className={`waste-card reveal-up delay-${(index + 1) * 100}`} key={item.text}>
              <div className="waste-indicator" />
              <p>{item.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="strategies" className="strategies-section">
        <div className="strategies-background" aria-hidden="true" />
        <div className="section-copy section-copy--center reveal-up">
          <p className="kicker">Même contexte. Trois pilotages.</p>
          <h2 className="strategies-title">Même salle. Même semaine. Trois stratégies.</h2>
          <p className="strategies-subtitle">
            Les conditions simulées restent identiques. Seule la logique de gestion énergétique change, pour isoler
            clairement l'effet de l'algorithme.
          </p>
        </div>
        <div className="strategy-cards-container">
          <StrategyCard
            className="strategy-card--pire"
            room="Salle 1 | Pire scénario"
            title="Pire scénario"
            description="Un scénario volontairement défavorable pour visualiser le gaspillage maximal."
            points={["CVC très sollicité", "Éclairage permanent", "Ventilation maximale", "Repère de gaspillage"]}
          >
            <path d="M0,35 Q10,38 20,34 T40,39 T60,35 T80,38 T100,36" fill="none" />
          </StrategyCard>
          <StrategyCard
            className="strategy-card--standard"
            room="Salle 2 | Standard"
            title="Standard"
            description="La référence réaliste : les équipements suivent principalement les horaires."
            points={["Pilotage horaire", "Veille hors activité", "Peu d'anticipation", "Référence de calcul"]}
          >
            <polyline points="0,35 15,35 15,20 35,20 35,10 65,10 65,20 85,20 85,35 100,35" fill="none" />
          </StrategyCard>
          <StrategyCard
            className="strategy-card--algo"
            room="Salle 3 | Algorithme"
            title="Algorithme"
            description="La salle optimisée arbitre heure par heure selon les signaux simulés."
            points={["Occupation réelle", "Lumière naturelle", "Prévision de reprise", "Confort préservé"]}
          >
            <path d="M0,35 C20,35 25,15 40,20 C55,25 65,12 80,25 C90,33 95,35 100,35" fill="none" />
          </StrategyCard>
        </div>
      </section>

      <p className="section-transition-text reveal-up">
        Une fois les stratégies posées, le système commence par observer la salle.
      </p>

      <section id="signaux" className="story-section story-section--signals" ref={signalSectionRef}>
        <div className="section-copy reveal-up">
          <p className="kicker">Signaux observés</p>
          <h2>Le système observe l'espace avant d'agir.</h2>
          <p>
            Chaque décision part d'un contexte simple : météo, occupation, luminosité, température intérieure, prochaine
            occupation et rythme du campus.
          </p>
        </div>
        <div className="classroom-diagram reveal-scale" aria-label="Signaux de salle de classe">
          <ClassroomSignalScene
            activeSignalId={displayedSignalId}
            activeSignal={activeSignal}
            onHover={setHoveredSignalId}
            onPin={setPinnedSignalId}
            pinnedSignalId={pinnedSignalId}
          />
          <div className="signal-list">
            {signaux.map((signal) => (
              <button
                className={[
                  "signal-row",
                  displayedSignalId === signal.id ? "signal-row--active" : "",
                  pinnedSignalId === signal.id ? "signal-row--pinned" : "",
                ].join(" ")}
                key={signal.id}
                type="button"
                style={{ "--signal-accent": signal.accent } as CSSProperties}
                onMouseEnter={() => setHoveredSignalId(signal.id)}
                onMouseLeave={() => setHoveredSignalId(null)}
                onFocus={() => setHoveredSignalId(signal.id)}
                onBlur={() => setHoveredSignalId(null)}
                onClick={() => setPinnedSignalId(signal.id)}
              >
                <span className="signal-index">{signal.valeur}</span>
                <strong>{signal.nom}</strong>
                <span>{signal.detail}</span>
                {pinnedSignalId === signal.id ? <em>Sélection fixée</em> : null}
              </button>
            ))}
          </div>
          {pinnedSignalId ? (
            <button className="signal-reset" type="button" onClick={() => setPinnedSignalId(null)}>
              Revenir au défilement automatique
            </button>
          ) : null}
        </div>
      </section>

      <p className="section-transition-text reveal-up">Les signaux deviennent ensuite des décisions.</p>

      <section id="algorithme" className="story-section story-section--algorithm">
        <div className="section-copy section-copy--center reveal-up">
          <p className="kicker">Algorithme d'arbitrage</p>
          <h2>Observer. Arbitrer. Optimiser.</h2>
          <p>
            Le raisonnement reste lisible : observer les signaux, arbitrer les priorités, agir sur CVC, éclairage,
            ventilation et équipements, puis mesurer l'impact.
          </p>
        </div>
        <DecisionEngine engineInputs={engineInputs} engineOutputs={engineOutputs} impactOutputs={impactOutputs} />
      </section>

      <section id="gains" className="kpi-reveal-section">
        <div className="kpi-reveal-background" aria-hidden="true" />
        <div className="section-copy section-copy--center reveal-up">
          <p className="kicker">Révélation des KPIs</p>
          <h2>Les résultats apparaissent un indicateur à la fois.</h2>
          <p>L'objectif est de relire les chiffres du dashboard sans confondre gain brut et gain prudent.</p>
        </div>
        <div className="kpi-reveal-track">
          {kpiReveals.length ? (
            kpiReveals.map((kpi, index) => (
              <article className={`kpi-reveal kpi-reveal--${kpi.accent} reveal-up delay-${index * 100}`} key={kpi.label}>
                <span className="kpi-reveal__index">0{index + 1}</span>
                <strong className="kpi-reveal__value">
                  <AnimatedCounter value={kpi.value} formatter={kpi.formatter} />
                </strong>
                <h3>{kpi.label}</h3>
                <p>{kpi.detail}</p>
              </article>
            ))
          ) : (
            <EmptyState title="Indicateurs en attente" text="Lancez une simulation depuis le tableau de bord pour révéler les indicateurs." />
          )}
        </div>
      </section>

      <section id="comparaison" className="compare-section new-comparison-section">
        <div className="comparison-atmosphere" aria-hidden="true">
          <div className="atmosphere-left" />
          <div className="atmosphere-right" />
        </div>
        <div className="section-copy section-copy--center reveal-up">
          <p className="kicker">Comparaison des salles</p>
          <h2>Comparer avant de décider.</h2>
          <p>
            La salle 1 sert de repère défavorable. La référence principale pour calculer les économies reste la salle 2
            standard comparée à la salle 3 optimisée.
          </p>
          <p className="microcopy">À lire en priorité : salle 2 = référence, salle 3 = économie officielle vs standard.</p>
        </div>
        <div className="comparison-showcase comparison-showcase--three">
          <CompareColumn
            className="compare-col--pire"
            graph="pire"
            label="Salle 1 | Pire scénario"
            value={worstSummary?.energy ?? "En attente"}
            description="Fonctionnement continu et décorrélé"
            details={["Fonctionnement continu", "Éclairage permanent", "Ventilation maximale", "Gaspillage élevé"]}
            metrics={worstSummary ? makeRoomMetrics(worstSummary) : []}
          />
          <div className="compare-vs reveal-scale delay-200">VS</div>
          <CompareColumn
            className="compare-col--standard"
            graph="standard"
            label="Salle 2 | Standard"
            value={standardSummary?.energy ?? "En attente"}
            description="Consignes fixes, horaires limités"
            details={["Pilotage horaire", "Consignes fixes", "Veille hors activité", "Peu d'anticipation"]}
            metrics={standardSummary ? makeRoomMetrics(standardSummary) : []}
          />
          <div className="compare-vs reveal-scale delay-400">VS</div>
          <CompareColumn
            className="compare-col--optimized"
            graph="optimized"
            label="Salle 3 | Algorithme"
            value={optimizedSummary?.energy ?? "En attente"}
            description="Arbitrage dynamique en temps réel"
            details={["Occupation réelle", "Lumière naturelle prise en compte", "Prévision de reprise", "Confort préservé"]}
            metrics={optimizedSummary ? makeRoomMetrics(optimizedSummary) : []}
          />
        </div>
        <div className="comparison-proof-strip reveal-up delay-500">
          <span>Écart vs standard</span>
          <strong>{result ? formatDeltaPct(result.standard_vs_optimized.savings_pct) : "En attente"}</strong>
          <span>Écart vs pire scénario</span>
          <strong>{worstRoom && optimizedRoom ? formatDeltaPct(((worstRoom.energy_kwh - optimizedRoom.energy_kwh) / worstRoom.energy_kwh) * 100) : "En attente"}</strong>
          <span>Confort maintenu</span>
          <strong>{optimizedRoom ? `${formatNumber(optimizedRoom.comfort_score, 1)} / 100` : "En attente"}</strong>
          <span>CO₂ réduit</span>
          <strong>{result ? formatCo2(result.standard_vs_optimized.co2_saved_kg) : "En attente"}</strong>
        </div>
      </section>

      <section id="campus" className="campus-closing-section">
        <div className="closing-background" />
        <div className="section-copy section-copy--center reveal-up">
          <p className="kicker">Échelle campus</p>
          <h2 className="animated-gradient-text">Une simulation locale. Une logique extensible à tout le campus.</h2>
          <p>
            Ce simulateur ne promet pas un gain terrain exact. Il donne un ordre de grandeur prudent, calculé à partir
            d'une référence standard, d'un déploiement réaliste, du foisonnement et d'un coefficient de prudence.
          </p>
        </div>
        <div className="closing-metrics">
          <div className="closing-metric reveal-up delay-100">
            <strong className="metric-cyan">
              {result ? (
                <>
                  <AnimatedCounter value={result.metadata.simulation_hours} /> h
                </>
              ) : (
                "En attente"
              )}
            </strong>
            <span>simulées</span>
          </div>
          <div className="closing-metric reveal-up delay-200">
            <strong className="metric-amber">
              {result ? <AnimatedCounter value={result.metadata.season_count} /> : "En attente"}
            </strong>
            <span>saisons comparées</span>
          </div>
          <div className="closing-metric reveal-up delay-300">
            <strong className="metric-emerald">
              {result ? <AnimatedCounter value={Math.round(result.campus.deployed_rooms)} /> : "En attente"}
            </strong>
            <span>salles déployées</span>
          </div>
        </div>
        <div className="closing-actions reveal-up delay-400">
          <a
            className="primary-cta"
            href="#contexte"
            onClick={(event) => {
              event.preventDefault();
              scrollToSection("contexte");
            }}
          >
            <span>Revoir le contexte</span>
            <i aria-hidden="true" />
          </a>
          <a
            className="secondary-cta"
            href="#tableau"
            onClick={(event) => {
              event.preventDefault();
              scrollToSection("tableau");
            }}
          >
            Revenir au tableau de bord
          </a>
        </div>
      </section>
    </main>
  );
};

const NavLink = ({
  active,
  children,
  target,
  onSelect,
}: {
  active: boolean;
  children: ReactNode;
  target: string;
  onSelect: (target: string) => void;
}) => (
  <a
    className={active ? "top-nav__link top-nav__link--active" : "top-nav__link"}
    href={`#${target}`}
    onClick={(event) => {
      event.preventDefault();
      onSelect(target);
    }}
  >
    {children}
  </a>
);

const StrategyCard = ({
  children,
  className,
  description,
  points,
  room,
  title,
}: {
  children: ReactNode;
  className: string;
  description: string;
  points: string[];
  room: string;
  title: string;
}) => (
  <div
    className={`strategy-card strategy-card--tilt ${className} reveal-up`}
    onPointerMove={(event) => {
      const card = event.currentTarget;
      const rect = card.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - 0.5;
      const y = (event.clientY - rect.top) / rect.height - 0.5;
      card.style.setProperty("--tilt-x", `${(-y * 8).toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${(x * 10).toFixed(2)}deg`);
      card.style.setProperty("--shine-x", `${((x + 0.5) * 100).toFixed(1)}%`);
      card.style.setProperty("--shine-y", `${((y + 0.5) * 100).toFixed(1)}%`);
    }}
    onPointerLeave={(event) => {
      const card = event.currentTarget;
      card.style.setProperty("--tilt-x", "0deg");
      card.style.setProperty("--tilt-y", "0deg");
      card.style.setProperty("--shine-x", "50%");
      card.style.setProperty("--shine-y", "0%");
    }}
  >
    <div className="strategy-card__header">
      <span className="strategy-card__room">{room}</span>
      <strong className="strategy-card__title">{title}</strong>
    </div>
    <p className="strategy-card__desc">{description}</p>
    <div className="strategy-card__visual">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none">
        {children}
      </svg>
    </div>
    <ul className="strategy-card__points">
      {points.map((point) => (
        <li key={point}>{point}</li>
      ))}
    </ul>
  </div>
);

const CompareColumn = ({
  className,
  description,
  details,
  graph,
  label,
  metrics,
  value,
}: {
  className: string;
  description: string;
  details: string[];
  graph: "pire" | "standard" | "optimized";
  label: string;
  metrics: Array<{ label: string; value: string }>;
  value: string;
}) => (
  <div className={`compare-col ${className} reveal-up`}>
    <header>
      <span className="compare-label">{label}</span>
      <strong>{value}</strong>
      <p>{description}</p>
    </header>
    <div className={`compare-mini-graph compare-mini-graph--${graph}`} aria-hidden="true">
      <svg viewBox="0 0 120 48" preserveAspectRatio="none">
        {graph === "pire" ? <path d="M0,36 C8,22 14,44 23,26 S38,41 48,18 S66,44 76,20 S96,34 120,15" /> : null}
        {graph === "standard" ? <polyline points="0,38 20,38 20,27 42,27 42,15 78,15 78,27 100,27 100,38 120,38" /> : null}
        {graph === "optimized" ? <path d="M0,36 C18,34 24,27 38,29 C56,32 62,19 78,22 C96,25 102,17 120,16" /> : null}
      </svg>
    </div>
    <ul className="compare-details">
      {details.map((detail) => (
        <li key={detail}>{detail}</li>
      ))}
    </ul>
    {metrics.length ? (
      <div className="compare-kpi-grid">
        {metrics.map((metric) => (
          <div key={metric.label}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
          </div>
        ))}
      </div>
    ) : null}
  </div>
);

const DecisionEngine = ({
  engineInputs,
  engineOutputs,
  impactOutputs,
}: {
  engineInputs: Array<{ label: string; value: string }>;
  engineOutputs: Array<{ label: string; value: string }>;
  impactOutputs: Array<{ label: string; value: string; accent: string }>;
}) => (
  <div className="new-decision-engine" aria-label="Moteur de décision">
    <div className="concept-line reveal-up delay-100">
      <span>Entrées mesurées</span>
      <i className="arrow" />
      <span>Décisions pilotées</span>
      <i className="arrow" />
      <span>Impacts calculés</span>
    </div>

    <div className="nde-flow-container">
      <svg className="nde-lines" viewBox="0 0 100 100" preserveAspectRatio="none">
        <path className="nde-path-cyan" d="M15,50 C30,50 35,50 50,50" />
        <path className="nde-path-amber" d="M50,50 C65,50 70,50 85,50" />
      </svg>

      <div className="nde-stage nde-stage--observe reveal-left delay-200">
        <header>
          <small>1. Observer</small>
          <strong>Les signaux de la salle</strong>
        </header>
        <div className="nde-cards">
          {engineInputs.map((item) => (
            <div className="nde-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>

      <div className="nde-stage nde-stage--arbitrate reveal-scale delay-300">
        <header>
          <small>2. Arbitrer</small>
          <strong>Modèle de décision</strong>
        </header>
        <div className="nde-core">
          <div className="nde-core-glow pulse" />
          {engineActions.map((action) => (
            <span key={action} className="nde-action-chip">
              {action}
            </span>
          ))}
        </div>
      </div>

      <div className="nde-stage nde-stage--act reveal-right delay-400">
        <header>
          <small>3. Agir</small>
          <strong>Les équipements pilotés</strong>
        </header>
        <div className="nde-cards">
          {engineOutputs.map((item) => (
            <div className="nde-card" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </div>
      </div>
    </div>

    <div className="nde-impact-strip reveal-up delay-500">
      <header>
        <small>4. Mesurer l'impact</small>
      </header>
      <div className="nde-impacts">
        {impactOutputs.map((item) => (
          <div className="nde-impact-item" key={item.label}>
            <span>{item.label}</span>
            <strong className={`color-${item.accent}`}>{item.value}</strong>
          </div>
        ))}
      </div>
    </div>
  </div>
);

interface ClassroomSignalSceneProps {
  activeSignalId: string;
  activeSignal: Signal;
  onHover: (signalId: string | null) => void;
  onPin: (signalId: string) => void;
  pinnedSignalId: string | null;
}

const signalHotspots = [
  { id: "meteo", x: 18, y: 24, label: "météo" },
  { id: "occupation", x: 48, y: 57, label: "occupation" },
  { id: "luminosite", x: 74, y: 28, label: "luminosité" },
  { id: "temperature", x: 36, y: 18, label: "température intérieure" },
  { id: "reprise", x: 66, y: 18, label: "prochaine occupation" },
  { id: "horaires", x: 71, y: 62, label: "horaires" },
];

const ClassroomSignalScene = ({ activeSignalId, activeSignal, onHover, onPin, pinnedSignalId }: ClassroomSignalSceneProps) => (
  <div
    className={`signal-scene signal-scene--${activeSignalId} ${pinnedSignalId ? "signal-scene--pinned" : ""}`}
    style={{ "--active-accent": activeSignal.accent } as CSSProperties}
  >
    <div className="scene-readout">
      <span>{activeSignal.zone}</span>
      <strong>{activeSignal.valeur}</strong>
      <em>{activeSignal.nom}</em>
    </div>

    <div className="scene-orbit scene-orbit--one" />
    <div className="scene-orbit scene-orbit--two" />
    <div className="scene-sweep" />

    <svg className="signal-traces" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path className="trace trace--meteo" d="M18 24 C24 38 28 48 48 57" />
      <path className="trace trace--occupation" d="M48 57 C48 47 48 38 52 30" />
      <path className="trace trace--luminosite" d="M74 28 C66 34 58 42 48 57" />
      <path className="trace trace--temperature" d="M36 18 C39 31 44 42 48 57" />
      <path className="trace trace--reprise" d="M66 18 C61 34 55 47 48 57" />
      <path className="trace trace--horaires" d="M71 62 C63 60 55 58 48 57" />
    </svg>

    <div className="technical-room">
      <div className="room-ceiling">
        <span />
        <span />
      </div>
      <div className="room-shell">
        <span className="room-edge room-edge--top" />
        <span className="room-edge room-edge--right" />
        <span className="room-edge room-edge--bottom" />
        <span className="room-edge room-edge--left" />
        <span className="daylight-band" />
        <span className="desk desk--a" />
        <span className="desk desk--b" />
        <span className="desk desk--c" />
        <span className="desk desk--d" />
        <span className="vent vent--a" />
        <span className="vent vent--b" />
      </div>
    </div>

    {signalHotspots.map((hotspot) => (
      <button
        className={activeSignalId === hotspot.id ? "hotspot hotspot--active" : "hotspot"}
        key={hotspot.id}
        type="button"
        style={{ left: `${hotspot.x}%`, top: `${hotspot.y}%` }}
        onMouseEnter={() => onHover(hotspot.id)}
        onMouseLeave={() => onHover(null)}
        onFocus={() => onHover(hotspot.id)}
        onBlur={() => onHover(null)}
        onClick={() => onPin(hotspot.id)}
        aria-label={hotspot.label}
      >
        <span />
      </button>
    ))}
  </div>
);

const PanelHeading = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <header className="panel-heading">
    <h3>{title}</h3>
    <p>{subtitle}</p>
  </header>
);

const EmptyState = ({ title, text, compact = false }: { title: string; text: string; compact?: boolean }) => (
  <div className={compact ? "empty-state empty-state--compact" : "empty-state"}>
    <strong>{title}</strong>
    <p>{text}</p>
  </div>
);

const ConsumptionChart = ({ data }: { data: ChartPoint[] }) => {
  if (!data.length) {
    return <EmptyState title="Courbe en attente" text="Lancez une simulation pour afficher la consommation en kW." />;
  }

  const max = Math.max(1, ...data.flatMap((point) => [point.worst_kw, point.standard_kw, point.optimized_kw]));
  const line = (key: "worst_kw" | "standard_kw" | "optimized_kw") =>
    data
      .map((point, index) => {
        const x = data.length <= 1 ? 0 : (index / (data.length - 1)) * 100;
        const y = 100 - (point[key] / max) * 88;
        return `${x},${y}`;
      })
      .join(" ");

  return (
    <div className="chart-frame">
      <div className="chart-legend" aria-hidden="true">
        <span className="legend-baseline">Pire scénario</span>
        <span className="legend-standard">Standard</span>
        <span className="legend-optimized">Optimisé</span>
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Courbe de consommation">
        <polyline points={line("worst_kw")} className="line line--baseline" />
        <polyline points={line("standard_kw")} className="line line--standard" />
        <polyline points={line("optimized_kw")} className="line line--optimized" />
      </svg>
      <div className="axis-row">
        {data.map((point) => (
          <span key={point.hour}>{point.hour}h</span>
        ))}
      </div>
      <div className="chart-unit">kW</div>
    </div>
  );
};

const TemperatureChart = ({ data }: { data: ChartPoint[] }) => {
  if (!data.length) {
    return <EmptyState title="Température en attente" text="La température intérieure simulée apparaîtra après le calcul." compact />;
  }

  return (
    <div className="temperature-chart" aria-label="Courbe de température intérieure simulée">
      {data.map((point) => (
        <span
          key={`${point.hour}-${point.optimized_temp_c}`}
          style={{ height: `${Math.max(8, (point.optimized_temp_c - 17) * 18)}px` }}
          title={`${formatNumber(point.optimized_temp_c, 1)} °C`}
        />
      ))}
      <em>°C intérieur simulé</em>
    </div>
  );
};

const Breakdown = ({ breakdown }: { breakdown: SimulationResponse["energy_breakdown"] }) => {
  if (!breakdown.length) {
    return <EmptyState title="Postes en attente" text="Les économies par poste seront détaillées après simulation." compact />;
  }

  const maxAbsSaving = Math.max(1, ...breakdown.map((item) => Math.abs(item.savings_kwh)));

  return (
    <div className="breakdown" aria-label="Répartition énergétique">
      {breakdown.map((item) => {
        const isNegative = item.savings_kwh < 0;
        const width = (Math.abs(item.savings_kwh) / maxAbsSaving) * 100;
        return (
          <div className={isNegative ? "breakdown-row breakdown-row--negative" : "breakdown-row"} key={item.key}>
            <span>{item.label}</span>
            <div aria-hidden="true">
              <i style={{ width: `${Math.max(4, width)}%` }} />
            </div>
            <strong>{formatKwh(item.savings_kwh)}</strong>
            <em>{isNegative ? "hausse liée au confort" : "économie"}</em>
          </div>
        );
      })}
    </div>
  );
};

const SeasonalPanel = ({ seasonal }: { seasonal: SimulationResponse["seasonal"] }) => {
  if (!seasonal.length) {
    return <EmptyState title="Saisons en attente" text="Hiver, printemps, été et automne seront affichés après simulation." compact />;
  }

  return (
    <div className="seasonal-grid">
      {seasonal.map((season) => (
        <article className="season-card" key={season.season}>
          <header>
            <strong>{season.season}</strong>
            <span>{formatNumber(season.weeks, 1)} sem.</span>
          </header>
          <dl>
            <div>
              <dt>Standard</dt>
              <dd>{formatKwh(season.standard_kwh)}</dd>
            </div>
            <div>
              <dt>Optimisé</dt>
              <dd>{formatKwh(season.optimized_kwh)}</dd>
            </div>
            <div>
              <dt>Économie</dt>
              <dd>{formatKwh(season.savings_kwh)}</dd>
            </div>
            <div>
              <dt>Coût</dt>
              <dd>{formatEuro(season.savings_eur)}</dd>
            </div>
            <div>
              <dt>CO₂</dt>
              <dd>{formatCo2(season.co2_saved_kg)}</dd>
            </div>
          </dl>
        </article>
      ))}
    </div>
  );
};

const RoomComparisonTable = ({ rows, compact = false }: { rows: RoomSummaryRow[]; compact?: boolean }) => {
  if (!rows.length) {
    return <EmptyState title="Comparaison en attente" text="Les trois salles seront comparées dès que la simulation aura répondu." compact />;
  }

  return (
    <div className={compact ? "room-comparison-table room-comparison-table--compact" : "room-comparison-table"}>
      <header>
        <strong>Comparaison des salles</strong>
        <span>Salle 2 = référence officielle ; salle 3 = optimisation mesurée vs standard.</span>
      </header>
      <div className="room-comparison-head" aria-hidden="true">
        <span>Salle</span>
        <span>Consommation</span>
        <span>Coût</span>
        <span>CO₂</span>
        <span>Confort</span>
        <span>Écart vs standard</span>
      </div>
      {rows.map((row) => (
        <div className={row.isOfficialOptimized ? "room-comparison-row room-comparison-row--official" : "room-comparison-row"} key={row.id}>
          <span>
            <strong>{row.name}</strong>
            <em>{row.role}</em>
          </span>
          <span>{row.energy}</span>
          <span>{row.cost}</span>
          <span>{row.co2}</span>
          <span>{row.comfort}</span>
          <span>
            <strong>{row.delta}</strong>
            <em>{row.deltaDetail}</em>
          </span>
        </div>
      ))}
    </div>
  );
};

interface ScenarioControlsProps {
  value: SimulationRequest;
  loading: boolean;
  onChange: (value: SimulationRequest) => void;
  onSubmit: () => void;
  onReset: () => void;
  onNewSeed: () => void;
}

const ScenarioControls = ({ value, loading, onChange, onSubmit, onReset, onNewSeed }: ScenarioControlsProps) => (
  <form
    className="scenario-controls"
    onSubmit={(event) => {
      event.preventDefault();
      onSubmit();
    }}
  >
    <CompactNumberControl label="Salles" value={value.room_count} min={1} max={500} onChange={(next) => onChange({ ...value, room_count: next })} />
    <CompactNumberControl
      label="Personnes / salle"
      value={value.average_people_per_room}
      min={1}
      max={250}
      onChange={(next) => onChange({ ...value, average_people_per_room: next })}
    />
    <CompactRangeControl
      label="Présence"
      value={value.presence_rate}
      min={0.05}
      max={1}
      step={0.05}
      display={formatPct(value.presence_rate)}
      onChange={(next) => onChange({ ...value, presence_rate: next })}
    />
    <label className="scenario-control scenario-control--select">
      <span>
        Profil météo
        <strong>{weatherProfiles.find((profile) => profile.value === value.weather_profile)?.label ?? "Profil"}</strong>
      </span>
      <select
        value={value.weather_profile}
        onChange={(event) => onChange({ ...value, weather_profile: event.target.value as WeatherProfile })}
      >
        {weatherProfiles.map((profile) => (
          <option key={profile.value} value={profile.value}>
            {profile.label}
          </option>
        ))}
      </select>
      <em className="scenario-help">
        {weatherProfiles.find((profile) => profile.value === value.weather_profile)?.description ?? "Profil de génération météo."}
      </em>
    </label>
    <CompactNumberControl
      label="Prix kWh"
      value={value.kwh_price}
      min={0.01}
      max={2}
      step={0.01}
      onChange={(next) => onChange({ ...value, kwh_price: next })}
    />
    <CompactNumberControl label="Semaines" value={value.active_weeks} min={1} max={52} onChange={(next) => onChange({ ...value, active_weeks: next })} />
    <CompactRangeControl
      label="Déploiement"
      value={value.deployment_rate}
      min={0}
      max={1}
      step={0.05}
      display={formatPct(value.deployment_rate)}
      onChange={(next) => onChange({ ...value, deployment_rate: next })}
      help="Part des salles réellement équipées ou concernées."
    />
    <CompactRangeControl
      label="Foisonnement"
      value={value.diversity_factor}
      min={0.1}
      max={1}
      step={0.05}
      display={formatPct(value.diversity_factor)}
      onChange={(next) => onChange({ ...value, diversity_factor: next })}
      help="Évite de supposer que toutes les salles génèrent le même gain en même temps."
    />
    <CompactRangeControl
      label="Prudence"
      value={value.prudence_factor}
      min={0.1}
      max={1}
      step={0.05}
      display={formatPct(value.prudence_factor)}
      onChange={(next) => onChange({ ...value, prudence_factor: next })}
      help="Applique une marge de sécurité pour obtenir un chiffre plus défendable."
    />
    <CompactNumberControl label="Seed" value={value.random_seed} min={0} max={1000000} onChange={(next) => onChange({ ...value, random_seed: next })} />
    <label className="scenario-control scenario-control--toggle">
      <span>
        Mode éco
        <strong>{value.eco_mode ? "Activé" : "Désactivé"}</strong>
      </span>
      <input type="checkbox" checked={value.eco_mode} onChange={(event) => onChange({ ...value, eco_mode: event.target.checked })} />
    </label>
    <div className="scenario-actions">
      <button className="dashboard-run-button" type="submit" disabled={loading}>
        {loading ? "Mise à jour..." : "Recalculer maintenant"}
      </button>
      <button className="dashboard-secondary-button" type="button" onClick={onReset} disabled={loading}>
        Réinitialiser
      </button>
      <button className="dashboard-secondary-button" type="button" onClick={onNewSeed} disabled={loading}>
        Nouvelle seed
      </button>
    </div>
    <p className="control-help">Chaque modification relance automatiquement le moteur et met à jour le comparatif principal.</p>
  </form>
);

const CompactNumberControl = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) => {
  const displayedValue = Number.isFinite(value) ? value : min;
  return (
    <label className="scenario-control">
      <span>
        {label}
        <strong>{formatNumber(displayedValue, step < 1 ? 2 : 0)}</strong>
      </span>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={displayedValue}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? clampNumber(next, min, max) : min);
        }}
      />
    </label>
  );
};

const CompactRangeControl = ({
  label,
  value,
  min,
  max,
  step,
  display,
  help,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  help?: string;
  onChange: (value: number) => void;
}) => {
  const safeValue = Number.isFinite(value) ? clampNumber(value, min, max) : min;
  const progress = ((safeValue - min) / (max - min)) * 100;
  return (
    <label className="scenario-control">
      <span>
        {label}
        <strong>{display}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={safeValue}
        style={{ "--range-progress": `${progress}%` } as CSSProperties}
        onChange={(event) => {
          const next = Number(event.target.value);
          onChange(Number.isFinite(next) ? clampNumber(next, min, max) : min);
        }}
      />
      {help ? <em className="scenario-help">{help}</em> : null}
    </label>
  );
};
