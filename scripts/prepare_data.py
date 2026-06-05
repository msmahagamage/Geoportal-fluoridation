import argparse
import csv
import json
from pathlib import Path

import pandas as pd


def parse_number(value):
    if pd.isna(value):
        return None
    text = str(value).strip().replace(",", "")
    if not text:
        return None
    if text.startswith("<"):
        text = text[1:].strip()
    try:
        return float(text)
    except ValueError:
        return None


def coordinate_from_usgs_id(site_id):
    text = "".join(ch for ch in str(site_id) if ch.isdigit())
    if len(text) < 13:
        return None
    lat = dms_to_decimal(text[0:2], text[2:4], text[4:6], 1)
    lon = dms_to_decimal(text[6:9], text[9:11], text[11:13], -1)
    if not (18 <= lat <= 72 and -180 <= lon <= -60):
        return None
    return [round(lon, 6), round(lat, 6)]


def dms_to_decimal(degrees, minutes, seconds, sign):
    return sign * (int(degrees) + int(minutes) / 60 + int(seconds) / 3600)


def build_groundwater(raw_data, output):
    source = raw_data / "McMahon_Fluoride_in_Groundwater_Data.csv"
    features = []
    with source.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            coords = coordinate_from_usgs_id(row.get("USGS_ID", ""))
            if not coords:
                continue
            fluoride = parse_number(row.get("F"))
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": coords},
                "properties": {
                    "usgs_id": row.get("USGS_ID"),
                    "aquifer": row.get("AQUIFER"),
                    "state": row.get("STATE"),
                    "date": row.get("DATE"),
                    "lithology": row.get("LITH"),
                    "well_type": row.get("W_TYPE"),
                    "depth_ft": parse_number(row.get("DEPTH")),
                    "fluoride_mg_l": fluoride,
                    "ph": parse_number(row.get("PH")),
                    "tds": parse_number(row.get("TDS"))
                }
            })
    write_json(output / "groundwater_wells.geojson", {
        "type": "FeatureCollection",
        "features": features
    })


def build_fluoride(raw_data, output):
    source = raw_data / "COUNTY FLUORIDE_2022.dta"
    df = pd.read_stata(source)
    df["fips"] = df["fipscode"].astype(int).astype(str).str.zfill(5)
    county_rows = df[["fips", "state", "county", "pctfluoride_2022"]].to_dict(orient="records")
    for row in county_rows:
        row["pctfluoride_2022"] = None if pd.isna(row["pctfluoride_2022"]) else round(float(row["pctfluoride_2022"]), 4)
    write_json(output / "county_fluoride_2022.json", county_rows)

    state_rows = (
        df.groupby("state", as_index=False)
        .agg(avg_pctfluoride_2022=("pctfluoride_2022", "mean"), county_count=("fips", "count"))
        .sort_values("state")
        .to_dict(orient="records")
    )
    for row in state_rows:
        row["avg_pctfluoride_2022"] = None if pd.isna(row["avg_pctfluoride_2022"]) else round(float(row["avg_pctfluoride_2022"]), 4)
        row["county_count"] = int(row["county_count"])
    write_json(output / "state_fluoride_2022.json", state_rows)


def build_county_health(raw_data, output):
    source = raw_data / "COUNTY HEALTH" / "analytic_data2025_v2.csv"
    df = pd.read_csv(source, header=1, low_memory=False)
    df = df[df["countycode"].astype(str).str.zfill(3) != "000"].copy()
    df["fips"] = df["fipscode"].astype(int).astype(str).str.zfill(5)

    rows = []
    for row in df.itertuples(index=False):
        limited_food = getattr(row, "v083_rawvalue")
        dentists = getattr(row, "v088_rawvalue")
        food_index = getattr(row, "v133_rawvalue")
        dentist_ratio = getattr(row, "v088_other_data_1")
        rows.append({
            "fips": row.fips,
            "state": row.state,
            "county": row.county,
            "year": int(row.year),
            "limited_healthy_food_pct": None if pd.isna(limited_food) else round(float(limited_food) * 100, 2),
            "food_environment_index": None if pd.isna(food_index) else round(float(food_index), 2),
            "dentists_per_100k": None if pd.isna(dentists) else round(float(dentists) * 100000, 2),
            "population_per_dentist": None if pd.isna(dentist_ratio) else round(float(dentist_ratio), 0)
        })
    write_json(output / "county_health_2025.json", rows)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw-data", default="D:/fluoridation/data")
    parser.add_argument("--output", default="data/processed")
    args = parser.parse_args()
    raw_data = Path(args.raw_data)
    output = Path(args.output)
    build_groundwater(raw_data, output)
    build_fluoride(raw_data, output)
    build_county_health(raw_data, output)


if __name__ == "__main__":
    main()

