import { GeoPoint } from "@/lib/travel-types";

const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";

type OpenMeteoResponse = {
  timezone?: string;
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    precipitation?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  hourly?: {
    time?: string[];
    temperature_2m?: number[];
    precipitation_probability?: number[];
    precipitation?: number[];
  };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
    precipitation_sum?: number[];
  };
};

export async function getWeatherForecast(location: GeoPoint) {
  const params = new URLSearchParams({
    latitude: String(location.lat),
    longitude: String(location.lng),
    current:
      "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
    hourly: "temperature_2m,precipitation_probability,precipitation",
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum",
    forecast_days: "3",
    timezone: "auto",
  });
  const response = await fetch(`${FORECAST_URL}?${params}`, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Weather forecast request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as OpenMeteoResponse;
  const current = data.current;
  return {
    location: location.label,
    timezone: data.timezone ?? "local time",
    source: "Open-Meteo",
    current: current
      ? {
          time: current.time ?? null,
          temperatureC: current.temperature_2m ?? null,
          feelsLikeC: current.apparent_temperature ?? null,
          condition: weatherDescription(current.weather_code),
          precipitationMm: current.precipitation ?? null,
          windKmh: current.wind_speed_10m ?? null,
        }
      : null,
    nextHours: (data.hourly?.time ?? []).slice(0, 8).map((time, index) => ({
      time,
      temperatureC: data.hourly?.temperature_2m?.[index] ?? null,
      precipitationProbability: data.hourly?.precipitation_probability?.[index] ?? null,
      precipitationMm: data.hourly?.precipitation?.[index] ?? null,
    })),
    daily: (data.daily?.time ?? []).slice(0, 3).map((date, index) => ({
      date,
      condition: weatherDescription(data.daily?.weather_code?.[index]),
      minC: data.daily?.temperature_2m_min?.[index] ?? null,
      maxC: data.daily?.temperature_2m_max?.[index] ?? null,
      precipitationProbability: data.daily?.precipitation_probability_max?.[index] ?? null,
      precipitationMm: data.daily?.precipitation_sum?.[index] ?? null,
    })),
  };
}

function weatherDescription(code?: number) {
  const descriptions: Record<number, string> = {
    0: "clear sky",
    1: "mainly clear",
    2: "partly cloudy",
    3: "overcast",
    45: "fog",
    48: "rime fog",
    51: "light drizzle",
    53: "drizzle",
    55: "heavy drizzle",
    61: "light rain",
    63: "rain",
    65: "heavy rain",
    71: "light snow",
    73: "snow",
    75: "heavy snow",
    80: "rain showers",
    81: "rain showers",
    82: "heavy rain showers",
    95: "thunderstorm",
    96: "thunderstorm with hail",
    99: "severe thunderstorm with hail",
  };
  return code === undefined ? "conditions unavailable" : descriptions[code] ?? "mixed conditions";
}
