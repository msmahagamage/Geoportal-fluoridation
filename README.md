# Fluoridation Geoportal

Static geoportal for visualizing groundwater fluoride, county fluoridation, state fluoridation, public water system reports, and optional county health access indicators.

## Open the Geoportal

Live link: [https://msmahagamage.github.io/Geoportal-fluoridation/](https://msmahagamage.github.io/Geoportal-fluoridation/)

Open `index.html` in a browser, or serve this folder with any static web server.

For limited sharing, keep the GitHub repository private and add only the intended collaborators. If GitHub Pages is enabled, review the Pages visibility setting before sharing the live link.

## Run Locally

If GitHub Pages is not enabled, run the geoportal from your computer with a local web server:

```powershell
cd D:\fluoridation
& "C:\Users\mmahagamage\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" -m http.server 8877 --bind 127.0.0.1
```

Then open:

[http://127.0.0.1:8877/index.html](http://127.0.0.1:8877/index.html)

Keep the PowerShell window open while using the geoportal. Press `Ctrl+C` in that window to stop the local server.

## Data Included

- `data/processed/groundwater_wells.geojson`: naturally occurring groundwater wells parsed from USGS site IDs.
- `data/processed/county_fluoride_2022.json`: county fluoridation levels from the Stata file.
- `data/processed/state_fluoride_2022.json`: population-unweighted county average by state from the county file.

The map uses public Census/Plotly GeoJSON boundaries at runtime, so an internet connection is needed for county and state polygons. The well points and tables are local.

## Add More Data

Use the templates in `data/templates/`:

- `county_health_access_template.csv`: county-level healthy food and dental care indicators.
- `public_water_system_reports_template.csv`: individual public water system reports.

After adding real files, either upload them inside the app or update `scripts/prepare_data.py` to merge them into `data/processed/`.

## Rebuild Processed Data

```powershell
& "C:\Users\mmahagamage\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" scripts\prepare_data.py --raw-data "D:\fluoridation\data" --output data\processed
```
