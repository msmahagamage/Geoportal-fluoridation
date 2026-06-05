# Fluoridation Geoportal

Static geoportal for visualizing groundwater fluoride, county fluoridation, state fluoridation, public water system reports, and optional county health access indicators.

## Open the Geoportal

Live link: [https://msmahagamage.github.io/Geoportal-fluoridation/](https://msmahagamage.github.io/Geoportal-fluoridation/)

Open `index.html` in a browser, or serve this folder with any static web server.

For limited sharing, keep the GitHub repository private and add only the intended collaborators. If GitHub Pages is enabled, review the Pages visibility setting before sharing the live link.

## Run Locally

If GitHub Pages is not enabled, run the geoportal from your computer with a local web server:

```powershell
cd D:\Geoportal-fluoridation
python -m http.server 8877 --bind 127.0.0.1
```

Then open:

[http://127.0.0.1:8877/index.html](http://127.0.0.1:8877/index.html)

Keep the PowerShell window open while using the geoportal. Press `Ctrl+C` in that window to stop the local server.

## Data Included

- `data/processed/groundwater_wells.geojson`: naturally occurring groundwater wells parsed from USGS site IDs.
- `data/processed/county_fluoride_2022.json`: county fluoridation levels from the Stata file.
- `data/processed/state_fluoride_2022.json`: supplied state fluoridation levels from `state_fluoride_2022.dta`.
- `data/processed/county_health_2025.json`: county healthy-food access and dentist-access indicators from County Health Rankings 2025.

The map uses public Census/Plotly GeoJSON boundaries at runtime, so an internet connection is needed for county and state polygons. The well points and tables are local.

## Add More Data

Use `data/templates/public_water_system_reports_template.csv` for individual public water system reports.

County healthy-food and dental-care access are built into the geoportal. Update the County Health Rankings source under `data/raw/COUNTY HEALTH`, then rebuild the processed data when a newer release is available.

## Rebuild Processed Data

```powershell
python scripts\prepare_data.py
```

Raw source datasets belong in `data/raw/`. The corrected
`McMahon_Fluoride_in_Groundwater_Data.csv` is included in GitHub; the other raw
source datasets remain excluded.
