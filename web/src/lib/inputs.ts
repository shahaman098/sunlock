import { LANDER_LIMITS } from "./power";

/** Read lander settings from a shared link using the limits of the editable controls. */
export function readLanderParams(params: URLSearchParams) {
  const read = (key: string, limits: { min: number; max: number }, scale = 1) => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === "") return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value * scale >= limits.min && value * scale <= limits.max
      ? value
      : undefined;
  };
  return {
    load: read("load", LANDER_LIMITS.loadW),
    heater: read("heater", LANDER_LIMITS.heaterW),
    array: read("array", LANDER_LIMITS.arrayM2),
    battery: read("battery", LANDER_LIMITS.batteryWh, 1000),
  };
}
