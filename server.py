import os
import re
import json
import time
import queue
import threading
from urllib.parse import urljoin, urlparse

from flask import Flask, request, Response, send_from_directory, abort, stream_with_context
from bs4 import BeautifulSoup
import requests as http_client
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

app = Flask(__name__, static_folder='public', static_url_path='')
PORT = int(os.environ.get('PORT', 3000))


# ─── URL helpers ──────────────────────────────────────────────────────────────

def resolve_url(base, relative):
    try:
        return urljoin(base, relative)
    except Exception:
        return None

def is_image_url(url):
    if not url:
        return False
    path = urlparse(url).path.lower()
    return bool(re.search(r'\.(jpe?g|png|gif|webp|avif|bmp|svg|ico)$', path))

def base_filename(url):
    try:
        path = urlparse(url).path
        return (path.split('/')[-1] or url).lower()
    except Exception:
        return url

def best_from_srcset(srcset, base_url):
    entries = []
    for part in srcset.split(','):
        tokens = part.strip().split()
        if not tokens:
            continue
        raw_url = tokens[0]
        w = 0
        if len(tokens) > 1 and tokens[1].endswith('w'):
            try:
                w = int(tokens[1][:-1])
            except ValueError:
                pass
        entries.append((w, raw_url))
    if not entries:
        return None
    entries.sort(key=lambda x: x[0], reverse=True)
    return resolve_url(base_url, entries[0][1])

def dedupe_by_filename(urls):
    seen = {}
    result = []
    for url in urls:
        name = base_filename(url)
        if name not in seen:
            seen[name] = True
            result.append(url)
    return result

def extract_image_urls_from_json(json_text, base_url):
    results = []
    pattern = re.compile(
        r'"((?:https?://|/)[^"]{4,500}\.(?:jpe?g|png|gif|webp|avif|bmp|svg))[^"]*"',
        re.IGNORECASE,
    )
    for m in pattern.finditer(json_text):
        raw = m.group(1).split('\\u0026')[0].replace('\\"', '')
        resolved = resolve_url(base_url, raw)
        if resolved:
            results.append(resolved)
    return results


# ─── Image extraction ─────────────────────────────────────────────────────────

def extract_images(html, base_url):
    soup = BeautifulSoup(html, 'html.parser')
    collected = []

    def add(url):
        if not url:
            return
        if url.startswith('data:'):
            return
        if '%2F' in url or '%2f' in url:
            return
        collected.append(url)

    # <img> tags — prefer srcset, fall back to src and lazy-load attrs
    for img in soup.find_all('img'):
        srcset = img.get('srcset') or img.get('data-srcset')
        if srcset:
            add(best_from_srcset(srcset, base_url))
        else:
            src = (img.get('src') or img.get('data-src') or img.get('data-lazy-src')
                   or img.get('data-original') or img.get('data-image') or img.get('data-hi-res-src'))
            if src:
                add(resolve_url(base_url, src))

    # <source> tags — pick largest from srcset
    for source in soup.find_all('source'):
        srcset = source.get('srcset') or source.get('data-srcset')
        if srcset:
            add(best_from_srcset(srcset, base_url))

    # CSS background-image in style attributes
    bg_pattern = re.compile(r"url\(['\"]?([^'\")\s]+)['\"]?\)", re.IGNORECASE)
    for el in soup.find_all(style=True):
        for m in bg_pattern.finditer(el['style']):
            resolved = resolve_url(base_url, m.group(1))
            if resolved and is_image_url(resolved):
                add(resolved)

    # <a> tags pointing directly at images
    for a in soup.find_all('a', href=True):
        if is_image_url(a['href']):
            resolved = resolve_url(base_url, a['href'])
            if resolved:
                add(resolved)

    # Open Graph / Twitter card meta images
    for meta in soup.find_all('meta'):
        prop = meta.get('property', '') or meta.get('name', '')
        if prop in ('og:image', 'twitter:image', 'og:image:url'):
            content = meta.get('content')
            if content:
                resolved = resolve_url(base_url, content)
                if resolved:
                    add(resolved)

    # Inline JSON in <script> tags (Next.js __NEXT_DATA__, JSON-LD, etc.)
    for script in soup.find_all('script'):
        script_type = (script.get('type') or '').lower()
        script_id   = (script.get('id') or '').lower()
        text = script.string or ''
        is_json = (
            script_type in ('application/ld+json', 'application/json')
            or script_id == '__next_data__'
            or bool(re.match(r'^\s*[{\[]', text))
        )
        if is_json and len(text) < 5 * 1024 * 1024:
            for url in extract_image_urls_from_json(text, base_url):
                add(url)

    return dedupe_by_filename(collected)


# ─── Headless browser fetch ───────────────────────────────────────────────────

def fetch_with_browser(target_url, on_status=lambda msg: None):
    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
        )
        try:
            page = browser.new_page(
                user_agent=(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/120.0.0.0 Safari/537.36'
                ),
                viewport={'width': 1280, 'height': 900},
            )
            page.goto(target_url, wait_until='domcontentloaded', timeout=60000)
            on_status('Scrolling to load lazy images…')

            # Scroll incrementally to trigger lazy-loaded images
            page.evaluate("""
                async () => {
                    await new Promise(resolve => {
                        let total = 0;
                        const step = 600, delay = 150;
                        const timer = setInterval(() => {
                            window.scrollBy(0, step);
                            total += step;
                            if (total >= document.body.scrollHeight) {
                                clearInterval(timer);
                                resolve();
                            }
                        }, delay);
                    });
                }
            """)
            time.sleep(1.5)
            return page.content()
        finally:
            browser.close()


# ─── SSE helpers ──────────────────────────────────────────────────────────────

def sse(event, data):
    return f'event: {event}\ndata: {json.dumps(data)}\n\n'


# ─── Routes ───────────────────────────────────────────────────────────────────

@app.route('/')
def index():
    return send_from_directory('public', 'index.html')


@app.route('/api/extract')
def extract():
    url = request.args.get('url', '').strip()

    if not url:
        return {'error': 'A valid URL is required.'}, 400

    target_url = url if re.match(r'^https?://', url, re.IGNORECASE) else 'https://' + url

    try:
        parsed = urlparse(target_url)
        if not parsed.scheme or not parsed.netloc:
            raise ValueError()
    except Exception:
        return {'error': 'Invalid URL format.'}, 400

    # Run browser work in a background thread so the generator can stay
    # responsive, send heartbeat pings, and stream status updates via a queue.
    result_queue = queue.Queue()

    def worker():
        try:
            result_queue.put(('status', {'message': 'Navigating to page…'}))
            html = fetch_with_browser(
                target_url,
                on_status=lambda msg: result_queue.put(('status', {'message': msg})),
            )
            result_queue.put(('status', {'message': 'Extracting images…'}))
            images = extract_images(html, target_url)
            result_queue.put(('result', {'images': images, 'count': len(images), 'sourceUrl': target_url}))
        except PlaywrightTimeout:
            result_queue.put(('error', {'error': 'The page took too long to load. Try again.'}))
        except Exception as exc:
            msg = str(exc)
            if 'ERR_NAME_NOT_RESOLVED' in msg or 'getaddrinfo' in msg:
                result_queue.put(('error', {'error': 'Could not reach that URL. Check the address and try again.'}))
            else:
                print(f'Extract error: {exc}')
                result_queue.put(('error', {'error': 'Failed to fetch the URL.'}))
        finally:
            result_queue.put(None)  # sentinel

    def generate():
        yield sse('status', {'message': 'Launching browser…'})
        t = threading.Thread(target=worker, daemon=True)
        t.start()

        while True:
            try:
                item = result_queue.get(timeout=15)
                if item is None:
                    break
                event, data = item
                yield sse(event, data)
                if event in ('result', 'error'):
                    break
            except queue.Empty:
                yield ': ping\n\n'  # heartbeat — keeps connection alive

        t.join()

    return Response(
        stream_with_context(generate()),
        content_type='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
        },
    )


@app.route('/api/proxy')
def proxy():
    url = request.args.get('url', '')

    if not url:
        abort(400)

    try:
        parsed = urlparse(url)
        if parsed.scheme not in ('http', 'https'):
            abort(400)
    except Exception:
        abort(400)

    try:
        resp = http_client.get(
            url,
            stream=True,
            timeout=15,
            headers={
                'User-Agent': (
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/120.0.0.0 Safari/537.36'
                ),
                'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
            },
        )
        resp.raise_for_status()

        content_type = resp.headers.get('Content-Type', 'application/octet-stream')

        def stream():
            for chunk in resp.iter_content(chunk_size=8192):
                yield chunk

        response = Response(stream(), content_type=content_type)
        response.headers['Cache-Control'] = 'public, max-age=3600'
        return response

    except Exception as exc:
        print(f'Proxy error: {exc}')
        abort(502)


if __name__ == '__main__':
    print(f'Image Extractor running at http://localhost:{PORT}')
    app.run(host='0.0.0.0', port=PORT, debug=False, threaded=True)
