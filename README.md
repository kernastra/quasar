![Quasar](img.png)



## Features

- **Full page rendering** — Uses a headless Chromium browser (Playwright) to execute JavaScript and scroll the page, capturing images from dynamically loaded content, lazy-loaded grids, and JS-rendered frameworks (Next.js, React, etc.)
- **Smart extraction** — Pulls images from `<img>` tags, `srcset` / `<picture>` / `<source>` elements, CSS `background-image`, Open Graph / Twitter Card meta tags, and embedded JSON (e.g. `__NEXT_DATA__`)
- **Best resolution selection** — When multiple sizes are available via `srcset`, only the largest variant is kept
- **Deduplication** — Only one copy of each image (by filename) is shown, no duplicates
- **Size filtering** — Images smaller than 100×100 px (icons, tracking pixels) are automatically discarded
- **Live progress via SSE** — Uses Server-Sent Events to stream real-time status updates to the browser during extraction, avoiding proxy timeouts
- **Grid and list views** — Toggle between a card grid and a compact list
- **Filter by size** — Filter results by Large (>500k px), Medium (>50k px), or Small
- **Lightbox preview** — Click the eye icon on any card for a full-size preview with keyboard navigation (← / → / Esc)
- **Batch download** — Select any number of images and download them all; images are proxied through the server to bypass CORS restrictions

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python 3, Flask |
| Browser automation | Playwright (Chromium headless) |
| HTML parsing | BeautifulSoup4 |
| Image proxying | requests (streaming) |
| Real-time streaming | Server-Sent Events (SSE) |
| Frontend | Vanilla HTML / CSS / JavaScript |

---

## Project Structure

```
Quasar/
├── server.py          # Flask backend — extraction, SSE stream, image proxy
├── requirements.txt   # Python dependencies
└── public/
    ├── index.html     # App shell and markup
    ├── style.css      # All styles (dark theme, responsive)
    └── app.js         # Frontend logic (SSE client, grid, lightbox, downloads)
```

---

## Getting Started

### Prerequisites

- Python 3.9+
- pip

### Installation

**1. Clone the repository**

```bash
git clone https://github.com/kernastra/Quasar.git
cd Quasar
```

**2. Install Python dependencies**

```bash
pip install -r requirements.txt
```

**3. Install the Playwright browser**

```bash
python -m playwright install chromium
```

**4. Start the server**

```bash
python server.py
```

**5. Open the app**

Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## Usage

1. Paste any webpage URL into the input field (e.g. `https://www.si.com/mlb/some-article`)
2. Click **Extract Images** — the status bar shows live progress as the browser navigates and scrolls
3. Images load into a card grid; tiny or broken images are automatically removed
4. Use the **filter buttons** (All / Large / Medium / Small) to narrow results
5. Click any card to **select** it (teal border = selected); click again to deselect
6. Use **Select All** / **Deselect All** to bulk-select visible images
7. Click the **eye icon** on a card to open the full-size **lightbox preview**
   - Use ← / → arrow keys or the nav buttons to browse images
   - Click **Download** in the lightbox to save the current image
8. Click **Download Selected** to save all selected images at once

---

## API Endpoints

### `GET /api/extract?url=<encoded-url>`

Opens an SSE stream. Sends the following event types:

| Event | Payload | Description |
|---|---|---|
| `status` | `{ "message": "..." }` | Progress update (browser launch, navigation, scroll, parse) |
| `result` | `{ "images": [...], "count": N, "sourceUrl": "..." }` | Final list of image URLs |
| `error` | `{ "error": "..." }` | Human-readable error message |

A `: ping` comment is written every 15 seconds as a heartbeat to prevent idle connection timeouts.

### `GET /api/proxy?url=<encoded-url>`

Proxies an image URL through the server and streams the response back to the client. This is required because browsers block cross-origin downloads. Only `http` and `https` URLs are accepted.

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port the Flask server listens on |

```bash
PORT=8080 python server.py
```

---

## Color Theme

| Variable | Hex | Role |
|---|---|---|
| `--blue` | `#0984e3` | Primary actions, buttons, focus rings |
| `--dark` | `#1e272e` | Page background |
| `--teal` | `#00cec9` | Accents, selection state, download button |
| `--light` | `#f5f6fa` | Text, card backgrounds |

---

## Known Limitations

- **JavaScript-heavy pages** take 10–20 seconds to process because a full browser render is required
- **Login-gated content** (paywalled articles, authenticated feeds) cannot be accessed — the headless browser has no session cookies
- **Canvas-drawn images** and **CSS sprites** are not captured, as they produce no extractable URLs
- **WebP / AVIF served without extensions** (e.g. CDN resizing URLs with no file extension) may not be detected by the JSON regex extractor
- Flask's built-in development server is single-threaded by default; concurrent requests are handled via Flask's `threaded=True` option, but for production use a WSGI server such as Gunicorn is recommended
