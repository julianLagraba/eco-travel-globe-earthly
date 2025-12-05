
import pandas as pd, numpy as np, re
from pathlib import Path

BASE = Path(__file__).parent
DATA = BASE / "data" if (BASE / "data").exists() else BASE
OUT  = DATA / "OUT"; OUT.mkdir(exist_ok=True)

# ---------- util ----------
def read_csv_smart(p):
    """
    Lee CSV de forma robusta:
    - Si detecta cabecera WDI ('Data Source' en las primeras líneas), hace skiprows=3.
    - UTF-8 por defecto; fallback a latin-1 si hay caracteres raros.
    """
    from pathlib import Path
    p = Path(p)

    try:
        with open(p, 'r', encoding='utf-8', errors='ignore') as f:
            first5 = [next(f, '') for _ in range(5)]
    except Exception:
        first5 = []
    skip = 3 if any('Data Source' in line for line in first5) else 0

    try:
        return pd.read_csv(p, engine='python', skiprows=skip, quotechar='"')
    except UnicodeDecodeError:
        return pd.read_csv(p, engine='python', skiprows=skip, quotechar='"', encoding='latin-1')
    
def normalize(s, invert=False):
    s = pd.to_numeric(s, errors="coerce")
    lo, hi = s.min(skipna=True), s.max(skipna=True)
    if pd.isna(lo) or pd.isna(hi) or hi == lo:
        v = pd.Series(np.nan, index=s.index, dtype="float64")
    else:
        v = (s - lo) / (hi - lo)
    return 1 - v if invert else v

def weighted(row, W):
    num = den = 0.0
    for k,w in W.items():
        v = row.get(k)
        if pd.notna(v): num += w*v; den += w
    return num/den if den>0 else np.nan

def wdi_unpivot(csv_path, value_name):
    """WDI clásico (con “Data Source”) o ya-normalizado (isoA3,year,val)."""
    df = read_csv_smart(csv_path)
    cols_lower = {c.lower() for c in df.columns}
    # Caso ya normalizado
    if {"isoa3","year",value_name.lower()} <= cols_lower:
        m = df.rename(columns={next(c for c in df.columns if c.lower()=="isoa3"): "isoA3",
                               next(c for c in df.columns if c.lower()=="year"): "year",
                               next(c for c in df.columns if c.lower()==value_name.lower()): value_name})
        m[value_name] = pd.to_numeric(m[value_name], errors="coerce")
        return m[["isoA3","year",value_name]]
    # WDI ancho
    if {"country name","country code"} <= cols_lower:
        code_col = next(c for c in df.columns if c.lower()=="country code")
        name_col = next(c for c in df.columns if c.lower()=="country name")
        year_cols = [c for c in df.columns if re.fullmatch(r"\d{4}", str(c))]
        m = df.melt(id_vars=[name_col, code_col], value_vars=year_cols,
                    var_name="year", value_name=value_name)
        m = m.rename(columns={code_col:"isoA3", name_col:"name"})
        m["year"] = pd.to_numeric(m["year"], errors="coerce")
        m[value_name] = pd.to_numeric(m[value_name], errors="coerce")
        m = m.dropna(subset=[value_name])
        return m[["isoA3","year",value_name]]
    raise ValueError(f"WDI no reconocido: {csv_path.name} | columnas: {df.columns.tolist()[:8]}")

# ---------- CO2 (normalizado) ----------
co2 = read_csv_smart(DATA/"co2.csv")
co2.columns = [c.strip() for c in co2.columns]
co2 = co2.rename(columns={next(c for c in co2.columns if c.lower()=="isoa3"):"isoA3",
                          next(c for c in co2.columns if c.lower()=="year"):"year",
                          next(c for c in co2.columns if "co2" in c.lower()):"co2_per_capita"})
co2["co2_per_capita"] = pd.to_numeric(co2["co2_per_capita"], errors="coerce")
co2 = co2.sort_values("year").groupby("isoA3", as_index=False).last()[["isoA3","co2_per_capita"]]

# ---------- PM2.5 (OWID) ----------
air = read_csv_smart(DATA/"air_pollution.csv")
air = air.rename(columns={
    "Entity":"name","Code":"isoA3","Year":"year",
    # nombre largo de la columna en tus capturas:
    "Concentrations of fine particulate matter (PM2.5) - Residence area type: Total":"pm25"
})
air["pm25"] = pd.to_numeric(air["pm25"], errors="coerce")
air = air.sort_values("year").groupby("isoA3", as_index=False).last()[["isoA3","pm25"]]

# ---------- Renovables y Áreas protegidas (WDI) ----------
renew = wdi_unpivot(DATA/"wdi_renewables.csv", "renewables_elec_pct")
renew = renew.sort_values("year").groupby("isoA3", as_index=False).last()[["isoA3","renewables_elec_pct"]]

prot = wdi_unpivot(DATA/"wdi_protected.csv", "protected_land_pct")
prot = prot.sort_values("year").groupby("isoA3", as_index=False).last()[["isoA3","protected_land_pct"]]

# ---------- Agua potable segura (WDI) ----------
water = wdi_unpivot(DATA/"safe_water.csv", "safe_water_pct")
water = water.sort_values("year").groupby("isoA3", as_index=False).last()[["isoA3","safe_water_pct"]]

# ---------- Esperanza de vida (WDI) ----------
life = wdi_unpivot(DATA/"life_expectancy.csv", "life_expectancy_yrs")
life = life.sort_values("year").groupby("isoA3", as_index=False).last()[["isoA3","life_expectancy_yrs"]]

# ---------- HDI (tabla ancha) ----------
hdi_df = read_csv_smart(DATA/"hdi.csv")
hdi_df.columns = [c.strip().lower() for c in hdi_df.columns]
hdi_df = hdi_df.rename(columns={"iso3":"isoA3"})
hdi_cols = sorted([c for c in hdi_df.columns if re.fullmatch(r"hdi_\d{4}", c)], key=lambda x:int(x.split("_")[1]))
for c in hdi_cols: hdi_df[c] = pd.to_numeric(hdi_df[c], errors="coerce")
# último valor no nulo por país
hdi_df["hdi"] = hdi_df[hdi_cols].apply(lambda r: r.dropna().iloc[-1] if r.dropna().size else np.nan, axis=1)
hdi = hdi_df[["isoA3","hdi"]].copy()
hdi["isoA3"] = hdi["isoA3"].str.upper().str.strip()

# ---------- Merge ----------
merged = co2.merge(air,  on="isoA3", how="outer") \
            .merge(renew,on="isoA3", how="outer") \
            .merge(prot, on="isoA3", how="outer") \
            .merge(water,on="isoA3", how="outer") \
            .merge(life, on="isoA3", how="outer") \
            .merge(hdi,  on="isoA3", how="outer")

merged["isoA3"] = merged["isoA3"].str.upper().str.strip()

# ---------- Normalización + Score ----------
merged["co2_n"]        = normalize(merged["co2_per_capita"], invert=True)
merged["air_n"]        = normalize(merged["pm25"], invert=True)
merged["ren_n"]        = normalize(merged["renewables_elec_pct"])
merged["prot_n"]       = normalize(merged["protected_land_pct"])
merged["water_n"]      = normalize(merged["safe_water_pct"])
merged["life_n"]       = normalize(merged["life_expectancy_yrs"])
merged["hdi_n"]        = normalize(merged["hdi"])  

# pesos: priorizo emisiones y aire; luego renovables/agua/vida; luego áreas e hdi
W = {"co2_n":0.28, "air_n":0.22, "ren_n":0.16, "water_n":0.12, "life_n":0.12, "prot_n":0.06, "hdi_n":0.04}
merged["score"] = merged.apply(lambda r: weighted(r, W), axis=1)

# ---------- Export ----------
out_cols = ["isoA3","co2_per_capita","pm25","renewables_elec_pct","protected_land_pct",
            "safe_water_pct","life_expectancy_yrs","hdi","score"]
(merged[out_cols]).to_csv(OUT/"sustainability_index.csv", index=False, encoding="utf-8")
print("✅ sustainability_index.csv listo →", OUT/"sustainability_index.csv")
print("Filas:", len(merged))
