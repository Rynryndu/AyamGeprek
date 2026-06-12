# 🗺️ Tour Map Studio

A self-contained web tool for turning a **walking / city tour design** into an
**interactive map**. Build a tour by clicking on the map, or import an existing
file — then preview it as a guided, stop-by-stop walkthrough.

Built with plain HTML/CSS/JS and [Leaflet](https://leafletjs.com/) +
[OpenStreetMap](https://www.openstreetmap.org/). **No build step, no API keys,
no sign-up.**

## Features

- **Interactive editing** — click *Add stop* and tap the map to drop numbered
  stops. Drag markers to fine-tune positions.
- **Rich stops** — give each stop a name, description, and optional image URL.
- **Ordered route** — stops are automatically connected in order with a dashed
  route line; reorder them with the ▲ / ▼ buttons.
- **Import / Export** — read and write `.json`, `.csv`, and `.gpx` files.
- **Preview mode** — play through the tour stop by stop (arrow keys work too).
- **Share link** — copy a link that encodes the whole tour in the URL.
- **Autosave** — your work is kept in the browser's local storage.

## Running it

It's just static files. Either:

```bash
# Option A — open directly
open index.html        # macOS  (or double-click the file)

# Option B — serve locally (recommended; avoids file:// quirks)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Because it's fully static, you can also host it for free on GitHub Pages,
Netlify, Cloudflare Pages, etc. — just upload the files.

## Importing data

| Format | Notes |
| ------ | ----- |
| **JSON** | Native format (see `sample-tour.json`). Round-trips losslessly. |
| **CSV**  | Needs `lat` and `lng` columns; `name`, `description`, `image` optional. See `sample-tour.csv`. |
| **GPX**  | Reads route points (`rtept`), waypoints (`wpt`), or track points (`trkpt`). |

To try it out, click **Import file** and choose `sample-tour.json`.

## Data format (JSON)

```json
{
  "title": "My Walking Tour",
  "description": "Optional summary",
  "stops": [
    {
      "name": "Stop name",
      "description": "What to see here",
      "imageUrl": "https://… (optional)",
      "lat": 40.7128,
      "lng": -74.006
    }
  ]
}
```

## Files

- `index.html` — markup and CDN includes
- `styles.css` — styling
- `app.js` — all application logic
- `sample-tour.json` / `sample-tour.csv` — example data to import
