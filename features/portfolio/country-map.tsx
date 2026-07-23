"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import L, { type GeoJSON as LeafletGeoJSON, type Layer, type LeafletMouseEvent } from "leaflet";
import { GeoJSON, MapContainer, TileLayer, useMap } from "react-leaflet";

type CsvRow = Record<string, string>;
type Company = { name: string; ticker: string; sector: string };
type CountryData = {
  name: string;
  internationalName: string;
  geoJsonName: string;
  mainIndex: string;
  americanEtfs: string;
  sp: string;
  moodys: string;
  fitch: string;
  risk: string;
  companies: Company[];
};
type CountryFeature = Parameters<NonNullable<L.GeoJSONOptions<{ name: string }>["onEachFeature"]>>[0];
type CountryFeatureCollection = ComponentProps<typeof GeoJSON>["data"];
type DetailTab = "indices" | "companies" | "etfs";

const WORLD_DATA_URL = "/data/world-countries.json";
const COUNTRY_DATA_URL = "/data/paises_dados_completos_final.csv";

function normalize(value: string | undefined) {
  return value?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() ?? "";
}

function parseCsv(source: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (character === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(cell);
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    if (row.some(Boolean)) rows.push(row);
  }

  const [headers = [], ...values] = rows;
  return values.map((columns) => Object.fromEntries(headers.map((header, index) => [header, columns[index] ?? ""]))) as CsvRow[];
}

function groupCountries(rows: CsvRow[]) {
  const grouped = new Map<string, CountryData>();
  for (const row of rows) {
    const name = row["País"];
    if (!name) continue;
    if (!grouped.has(name)) {
      grouped.set(name, {
        name,
        internationalName: row.Country,
        geoJsonName: row["GeoJSON name"],
        mainIndex: row["Principal Índice"],
        americanEtfs: row["ETFs Americanos"],
        sp: row["S&P"],
        moodys: row["Moody's"],
        fitch: row.Fitch,
        risk: row["Nível de Risco"],
        companies: [],
      });
    }
    if (row.Empresa && row.Ticker) {
      grouped.get(name)?.companies.push({ name: row.Empresa, ticker: row.Ticker, sector: row.Setor });
    }
  }
  return Array.from(grouped.values());
}

function riskColor(riskValue: string | undefined) {
  const risk = riskValue?.toLowerCase() || "sem_nota";
  if (risk === "sem_nota" || risk === "unknown") return "#94a3b8";
  if (risk === "aaa") return "#3b82f6";
  if (risk === "aa" || risk === "a") return "#10b981";
  if (risk === "bbb" || risk === "bb") return "#f59e0b";
  if (["b", "ccc", "cc", "c", "d"].includes(risk)) return "#ef4444";
  const numeric = Number.parseInt(risk, 10);
  if (!Number.isNaN(numeric)) {
    if (numeric >= 70) return "#10b981";
    if (numeric >= 40) return "#f59e0b";
    return "#ef4444";
  }
  if (risk === "baixo") return "#10b981";
  if (risk === "médio" || risk === "medio") return "#f59e0b";
  if (risk === "alto") return "#ef4444";
  return "#94a3b8";
}

function riskLabel(riskValue: string | undefined) {
  const risk = riskValue?.toLowerCase() || "sem_nota";
  if (risk === "sem_nota" || risk === "unknown") return "Sem Classificação";
  if (risk === "aaa") return "AAA (Máxima Qualidade)";
  if (risk === "aa") return "AA (Alta Qualidade)";
  if (risk === "a") return "A (Forte Capacidade)";
  if (risk === "bbb") return "BBB (Média Capacidade)";
  if (risk === "bb") return "BB (Especulativo)";
  if (risk === "b") return "B (Altamente Especulativo)";
  if (["ccc", "cc", "c"].includes(risk)) return "CCC/CC/C (Alto Risco)";
  if (risk === "d") return "D (Default)";
  const numeric = Number.parseInt(risk, 10);
  if (!Number.isNaN(numeric)) {
    if (numeric >= 70) return "Baixo Risco";
    if (numeric >= 40) return "Médio Risco";
    return "Alto Risco";
  }
  if (risk === "baixo") return "Baixo Risco";
  if (risk === "médio" || risk === "medio") return "Médio Risco";
  if (risk === "alto") return "Alto Risco";
  return "Risco Desconhecido";
}

function ResizeMap() {
  const map = useMap();
  useEffect(() => {
    const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    observer.observe(map.getContainer());
    return () => observer.disconnect();
  }, [map]);
  return null;
}

function WorldLayer({
  data,
  countries,
  appliedQuery,
  selectedGeoJsonName,
  onSelect,
}: {
  data: CountryFeatureCollection;
  countries: CountryData[];
  appliedQuery: string;
  selectedGeoJsonName?: string;
  onSelect: (country: CountryData, geoJsonName: string) => void;
}) {
  const map = useMap();
  const layerRef = useRef<LeafletGeoJSON>(null);
  const countryByGeoName = useMemo(() => new Map(countries.map((country) => [normalize(country.geoJsonName), country])), [countries]);
  const matchingGeoNames = useMemo(() => {
    const query = normalize(appliedQuery.trim());
    if (!query) return null;
    return new Set(countries
      .filter((country) => normalize(country.name).includes(query) || normalize(country.internationalName).includes(query) || normalize(country.mainIndex).includes(query))
      .map((country) => normalize(country.geoJsonName)));
  }, [appliedQuery, countries]);

  const styleCountry = useCallback((feature?: CountryFeature) => {
    const geoJsonName = feature?.properties.name ?? "";
    const country = countryByGeoName.get(normalize(geoJsonName));
    if (!country) return { fillColor: "#94a3b8", weight: 1, opacity: 0.5, color: "#334155", fillOpacity: 0.3 };
    const selected = geoJsonName === selectedGeoJsonName;
    const matches = !matchingGeoNames || matchingGeoNames.has(normalize(geoJsonName));
    return {
      fillColor: riskColor(country.risk),
      weight: selected ? 3 : 1,
      opacity: 1,
      color: selected ? "#ffffff" : "#334155",
      fillOpacity: selected ? 0.9 : matches ? 0.7 : 0.2,
    };
  }, [countryByGeoName, matchingGeoNames, selectedGeoJsonName]);

  const onEachCountry = useCallback((feature: CountryFeature, layer: Layer) => {
    const geoJsonName = feature.properties.name;
    const country = countryByGeoName.get(normalize(geoJsonName));
    const path = layer as L.Polygon;
    path.bindTooltip(country?.name ?? geoJsonName, { permanent: false, direction: "center", className: "country-tooltip" });

    const selectCountry = () => {
      if (!country) return;
      onSelect(country, geoJsonName);
      const bounds = path.getBounds();
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 5, animate: true, duration: 1 });
    };

    path.on({
      mouseover: (event: LeafletMouseEvent) => {
        if (geoJsonName === selectedGeoJsonName) return;
        event.target.setStyle({ weight: 2, color: "#ffffff", fillOpacity: 0.8 });
        event.target.bringToFront();
      },
      mouseout: (event: LeafletMouseEvent) => {
        if (geoJsonName !== selectedGeoJsonName) layerRef.current?.resetStyle(event.target);
      },
      click: selectCountry,
      add: () => {
        const element = path.getElement();
        if (!element) return;
        element.setAttribute("role", country ? "button" : "img");
        element.setAttribute("aria-label", country?.name ?? geoJsonName);
        if (country) {
          element.setAttribute("tabindex", "0");
          element.addEventListener("keydown", (event) => {
            const keyboardEvent = event as KeyboardEvent;
            if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
              keyboardEvent.preventDefault();
              selectCountry();
            }
          });
        }
      },
    });
  }, [countryByGeoName, map, onSelect, selectedGeoJsonName]);

  return <GeoJSON key={`${appliedQuery}:${selectedGeoJsonName ?? "none"}`} ref={layerRef} data={data} style={styleCountry} onEachFeature={onEachCountry} />;
}

function CountryInfo({ country, tab, onTabChange }: { country?: CountryData; tab: DetailTab; onTabChange: (tab: DetailTab) => void }) {
  if (!country) {
    return <div className="grid h-[300px] place-items-center px-8 text-center text-lg text-slate-500">Selecione um país no mapa para ver informações detalhadas</div>;
  }

  const etfs = country.americanEtfs ? country.americanEtfs.split(",").map((item) => item.trim()).filter(Boolean) : [];
  return (
    <div className="p-6 text-slate-700">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[1.8rem] font-bold text-[#daa95a]">{country.name}</h2>
        <span className="rounded-full px-4 py-2 text-sm font-semibold text-white" style={{ backgroundColor: riskColor(country.risk) }}>{riskLabel(country.risk)}</span>
      </div>
      <div role="tablist" aria-label="Dados do país" className="mb-6 flex border-b border-slate-200">
        {(["indices", "companies", "etfs"] as const).map((item) => (
          <button
            key={item}
            type="button"
            role="tab"
            aria-selected={tab === item}
            onClick={() => onTabChange(item)}
            className={`border-b-2 px-6 py-3 font-medium transition ${tab === item ? "border-blue-500 text-blue-500" : "border-transparent text-slate-500 hover:text-slate-700"}`}
          >
            {item === "indices" ? "Índices" : item === "companies" ? "Empresas" : "ETFs"}
          </button>
        ))}
      </div>

      {tab === "indices" && (
        <div>
          <div className="mb-6">
            <p className="mb-1 text-sm font-medium text-slate-500">Principal Índice</p>
            <p className="text-lg font-medium text-[#daa95a]">{country.mainIndex}</p>
            <p className="mt-1 text-sm text-slate-500">Nome internacional: {country.internationalName}</p>
          </div>
          <div>
            <p className="mb-2 text-sm font-medium text-slate-500">Classificações de Risco</p>
            <div className="grid grid-cols-3 gap-4">
              {[["S&P", country.sp], ["Moody's", country.moodys], ["Fitch", country.fitch]].map(([label, value]) => (
                <div key={label}><p className="mb-1 text-sm font-medium text-slate-500">{label}</p><p className="text-lg font-medium text-[#daa95a]">{value || "N/A"}</p></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === "companies" && (
        country.companies.length ? <div className="grid max-h-[400px] gap-4 overflow-y-auto pr-2 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] scrollbar-thin">
          {country.companies.map((company, index) => <div key={`${company.ticker}-${index}`} className="rounded-lg bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:bg-slate-100"><p className="mb-1 font-semibold text-[#daa95a]">{company.name}</p><p className="text-sm text-slate-500">{company.ticker}{company.sector ? ` • ${company.sector}` : ""}</p></div>)}
        </div> : <div className="grid h-[300px] place-items-center text-center text-lg text-slate-500">Nenhuma empresa encontrada para este índice</div>
      )}

      {tab === "etfs" && (
        etfs.length ? <div>{etfs.map((etf) => <div key={etf} className="mb-3 rounded-lg bg-slate-50 p-4 transition hover:-translate-y-0.5 hover:bg-slate-100"><p className="mb-1 font-semibold text-[#daa95a]">{etf}</p><p className="text-sm text-slate-500">ETF Americano</p></div>)}</div> : <div className="grid h-[300px] place-items-center text-center text-lg text-slate-500">Nenhum ETF disponível para este país</div>
      )}
    </div>
  );
}

export default function CountryMap() {
  const [countries, setCountries] = useState<CountryData[]>([]);
  const [world, setWorld] = useState<CountryFeatureCollection>();
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<CountryData>();
  const [selectedGeoJsonName, setSelectedGeoJsonName] = useState<string>();
  const [detailTab, setDetailTab] = useState<DetailTab>("indices");
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetch(COUNTRY_DATA_URL).then((response) => {
        if (!response.ok) throw new Error("country data");
        return response.text();
      }),
      fetch(WORLD_DATA_URL).then((response) => {
        if (!response.ok) throw new Error("world data");
        return response.json() as Promise<CountryFeatureCollection>;
      }),
    ]).then(([csv, geoJson]) => {
      if (!active) return;
      setCountries(groupCountries(parseCsv(csv)));
      setWorld(geoJson);
    }).catch(() => active && setLoadError(true));
    return () => { active = false; };
  }, []);

  const selectCountry = useCallback((country: CountryData, geoJsonName: string) => {
    setSelectedCountry(country);
    setSelectedGeoJsonName(geoJsonName);
    setDetailTab("indices");
  }, []);

  return (
    <div className="space-y-8">
      <header className="border-b border-[color-mix(in_srgb,var(--primary)_38%,var(--border))] pb-4">
        <h2 className="text-3xl font-bold">Mapa</h2>
        <p className="mt-1 text-[var(--muted-foreground)]">Verifique a baixo a saúde financeira de cada Pais.</p>
      </header>

      <div className="space-y-4">
        <input
          type="search"
          aria-label="Buscar por país ou índice"
          placeholder="Buscar por país ou índice..."
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            if (!event.target.value.trim()) setAppliedQuery("");
          }}
          onKeyDown={(event) => event.key === "Enter" && setAppliedQuery(query.trim())}
          className="h-11 w-full max-w-[200px] rounded-lg border bg-transparent px-4 text-sm outline-none transition focus:border-[var(--primary)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--primary)_25%,transparent)]"
        />

        <div className="grid min-h-[400px] gap-4 md:min-h-[600px] md:grid-cols-[1.5fr_1fr]">
          <div className="overflow-hidden rounded-lg bg-slate-800 shadow-md" role="region" aria-label="Mapa de risco por país">
            {world && countries.length ? (
              <MapContainer center={[20, 0]} zoom={2} minZoom={2} maxZoom={6} maxBounds={[[-90, -180], [90, 180]]} scrollWheelZoom className="auvp-country-map z-0">
                <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>' subdomains="abcd" maxZoom={20} url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
                <WorldLayer data={world} countries={countries} appliedQuery={appliedQuery} selectedGeoJsonName={selectedGeoJsonName} onSelect={selectCountry} />
                <ResizeMap />
              </MapContainer>
            ) : <div className="grid h-full min-h-[400px] place-items-center text-sm text-slate-300 md:min-h-[600px]">{loadError ? "Não foi possível carregar o mapa." : "Carregando mapa…"}</div>}
          </div>
          <aside data-testid="country-info-panel" className="min-h-full max-h-[600px] overflow-y-auto rounded-lg bg-white shadow-md">
            <CountryInfo country={selectedCountry} tab={detailTab} onTabChange={setDetailTab} />
          </aside>
        </div>
      </div>
    </div>
  );
}
