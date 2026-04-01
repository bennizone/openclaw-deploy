import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/** WMO Weather interpretation codes → German descriptions */
const WMO_CODES: Record<number, string> = {
  0: "Klar",
  1: "Ueberwiegend klar",
  2: "Teilweise bewoelkt",
  3: "Bedeckt",
  45: "Nebel",
  48: "Reifnebel",
  51: "Leichter Nieselregen",
  53: "Maessiger Nieselregen",
  55: "Starker Nieselregen",
  56: "Gefrierender Nieselregen (leicht)",
  57: "Gefrierender Nieselregen (stark)",
  61: "Leichter Regen",
  63: "Maessiger Regen",
  65: "Starker Regen",
  66: "Gefrierender Regen (leicht)",
  67: "Gefrierender Regen (stark)",
  71: "Leichter Schneefall",
  73: "Maessiger Schneefall",
  75: "Starker Schneefall",
  77: "Schneegriesel",
  80: "Leichte Regenschauer",
  81: "Maessige Regenschauer",
  82: "Starke Regenschauer",
  85: "Leichte Schneeschauer",
  86: "Starke Schneeschauer",
  95: "Gewitter",
  96: "Gewitter mit leichtem Hagel",
  99: "Gewitter mit starkem Hagel",
};

function weatherDescription(code: number): string {
  return WMO_CODES[code] ?? `Unbekannt (Code ${code})`;
}

function windDirection(degrees: number): string {
  const dirs = ["N", "NO", "O", "SO", "S", "SW", "W", "NW"];
  return dirs[Math.round(degrees / 45) % 8];
}

interface GeoResult {
  name: string;
  admin1?: string;
  country: string;
  latitude: number;
  longitude: number;
}

async function geocode(location: string): Promise<GeoResult | null> {
  const url = new URL("https://geocoding-api.open-meteo.com/v1/search");
  url.searchParams.set("name", location);
  url.searchParams.set("count", "1");
  url.searchParams.set("language", "de");
  url.searchParams.set("format", "json");

  const res = await fetch(url);
  if (!res.ok) return null;

  const data = (await res.json()) as { results?: GeoResult[] };
  return data.results?.[0] ?? null;
}

interface ForecastResponse {
  current_weather: {
    temperature: number;
    windspeed: number;
    winddirection: number;
    weathercode: number;
  };
  daily: {
    time: string[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    weathercode: number[];
    sunrise: string[];
    sunset: string[];
    uv_index_max: number[];
  };
  hourly: {
    relative_humidity_2m: number[];
    apparent_temperature: number[];
  };
}

async function fetchForecast(lat: number, lon: number, days: number): Promise<ForecastResponse> {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current_weather", "true");
  url.searchParams.set("hourly", "relative_humidity_2m,apparent_temperature");
  url.searchParams.set(
    "daily",
    "temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,weathercode,sunrise,sunset,uv_index_max"
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", String(days));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Open-Meteo API error: ${res.status} ${res.statusText}`);
  return (await res.json()) as ForecastResponse;
}

export function registerWeather(server: McpServer): void {
  server.registerTool(
    "weather",
    {
      title: "Weather",
      description:
        "Get current weather and forecast for a location using Open-Meteo. " +
        "Supports city names in any language. Returns temperature, precipitation, " +
        "wind, humidity, and a multi-day forecast.",
      inputSchema: {
        location: z.string().describe("City name or location (e.g. 'Nuernberg', 'Berlin', 'Paris')"),
        days: z
          .number()
          .int()
          .min(1)
          .max(7)
          .optional()
          .default(3)
          .describe("Number of forecast days (1-7, default: 3)"),
      },
    },
    async ({ location, days }) => {
      const geo = await geocode(location);
      if (!geo) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Ort "${location}" nicht gefunden. Versuche einen spezifischeren Namen oder eine andere Schreibweise.`,
            },
          ],
        };
      }

      const forecast = await fetchForecast(geo.latitude, geo.longitude, days);
      const cw = forecast.current_weather;

      // Current humidity + feels-like from first hourly entry
      const humidity = forecast.hourly.relative_humidity_2m?.[0] ?? null;
      const feelsLike = forecast.hourly.apparent_temperature?.[0] ?? null;

      const lines: string[] = [];

      // Location header
      const regionPart = geo.admin1 ? `, ${geo.admin1}` : "";
      lines.push(`Wetter fuer ${geo.name}${regionPart}, ${geo.country}`);
      lines.push("");

      // Current weather
      lines.push("Aktuell:");
      lines.push(`  Temperatur: ${cw.temperature}°C${feelsLike != null ? ` (gefuehlt ${feelsLike}°C)` : ""}`);
      lines.push(`  ${weatherDescription(cw.weathercode)}`);
      lines.push(`  Wind: ${cw.windspeed} km/h aus ${windDirection(cw.winddirection)}`);
      if (humidity != null) lines.push(`  Luftfeuchtigkeit: ${humidity}%`);
      lines.push("");

      // Daily forecast
      lines.push(`Vorhersage (${days} Tage):`);
      const daily = forecast.daily;
      for (let i = 0; i < daily.time.length; i++) {
        const date = daily.time[i];
        const desc = weatherDescription(daily.weathercode[i]);
        const precip = daily.precipitation_sum[i];
        const precipProb = daily.precipitation_probability_max[i];
        const sunrise = daily.sunrise[i]?.split("T")[1] ?? "";
        const sunset = daily.sunset[i]?.split("T")[1] ?? "";

        lines.push(`  ${date}: ${daily.temperature_2m_min[i]}–${daily.temperature_2m_max[i]}°C, ${desc}`);
        if (precip > 0 || precipProb > 20) {
          lines.push(`    Niederschlag: ${precip} mm (${precipProb}% Wahrscheinlichkeit)`);
        }
        lines.push(`    UV-Index: ${daily.uv_index_max[i]} | Sonne: ${sunrise}–${sunset}`);
      }

      lines.push("");
      lines.push("Quelle: Open-Meteo (open-meteo.com)");

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    }
  );
}
