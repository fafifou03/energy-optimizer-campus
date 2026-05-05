import type { SimulationRequest, SimulationResponse } from "../types/simulation";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

export async function simulateCampus(payload: SimulationRequest): Promise<SimulationResponse> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE_URL}/simulate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Impossible de contacter le moteur de simulation Python. Vérifiez que le backend FastAPI est lancé.");
  }

  if (!response.ok) {
    if (response.status === 422) {
      throw new Error("Erreur API 422 : les paramètres envoyés sont invalides.");
    }
    throw new Error(`Erreur API ${response.status}`);
  }

  return response.json() as Promise<SimulationResponse>;
}

export { API_BASE_URL };
