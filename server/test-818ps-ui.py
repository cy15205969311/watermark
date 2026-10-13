"""Run with the project's Vite server; all APIs/media are isolated local fixtures. Set VITE_API_TARGET=http://127.0.0.1:5180 for Vite.
python .../webapp-testing/scripts/with_server.py --server "npm --prefix client run dev -- --host 127.0.0.1 --port 5179" --port 5179 -- python server/test-818ps-ui.py
"""
import base64
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
GIF = bytes.fromhex("474946383961010001008000004c6971ff000021ff0b4e45545343415045322e30030100000021f904050a0000002c00000000010001000002024c010021f90405140000002c0000000001000100804c697100ff0002024c01003b")
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOwAAAABJRU5ErkJggg==")
ANIMATION_URL = "https://img.tuguaishou.com/fixture.gif?auth_key=fixture-only"
THUMB_URL = "https://img.tuguaishou.com/fixture-thumb.png"
record = {"id": 1, "originalUrl": "https://818ps.com/g/fixture", "platform": "818ps", "imageUrl": ANIMATION_URL, "animationUrl": ANIMATION_URL, "thumbnailUrl": THUMB_URL, "imageUrls": [ANIMATION_URL], "pages": [{"page": 1, "imageUrl": ANIMATION_URL}], "pageCount": 1, "expectedPageCount": 1, "collectedPageCount": 1, "completenessStatus": "complete", "isComplete": True, "isAnimated": True, "frameCount": 2, "durationMs": 300, "mediaType": "image/gif", "detectedFormat": "gif", "resourceRole": "animation_preview", "animationStatus": "verified_animated", "status": "success"}
old_record = {"id": 2, "original_url": "https://www.gaoding.com/fixture", "thumbnail_url": THUMB_URL, "platform": "Gaoding", "status": "success"}
partial = {"id": 3, "originalUrl": "https://818ps.com/partial", "platform": "818ps", "imageUrls": [THUMB_URL, THUMB_URL + "?page=2"], "pages": [{"page": 1, "imageUrl": THUMB_URL}, {"page": 3, "imageUrl": THUMB_URL + "?page=2"}], "pageCount": 2, "expectedPageCount": 3, "collectedPageCount": 2, "completenessStatus": "partial", "missingPages": [2], "status": "success"}
saved_requests = []
record.update({"originalResourceStatus": "preview_only", "downloadStatus": "preview_only", "hasVisibleWatermark": "unknown", "selectionReason": "validated_animation_original_not_confirmed"})
original_record = {**record, "id": 5, "originalResourceStatus": "original_verified", "downloadStatus": "original_verified", "resourceRole": "original_animation"}
export_record = {**record, "id": 6, "originalResourceStatus": "authorized_export_verified", "downloadStatus": "authorized_export_verified", "resourceRole": "authorized_export"}

def route_api(route):
    request = route.request
    if "/proxy-image" in request.url:
        route.continue_()
    elif "/history" in request.url:
        route.fulfill(json={"success": True, "data": [record, old_record, partial, original_record, export_record]})
    elif "/extract-image" in request.url:
        route.fulfill(json={"success": True, **record})
    elif "/parse" in request.url:
        data = request.post_data_json
        saved_requests.append(data)
        route.fulfill(json={"success": True, "data": {**data, "id": 4, "originalUrl": data["url"]}})
    else:
        route.fulfill(status=404, json={"success": False})

class MediaHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        animated = "fixture.gif" in self.path
        body = GIF if animated else PNG
        self.send_response(200)
        self.send_header("Content-Type", "image/gif" if animated else "image/png")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_):
        pass

media_server = ThreadingHTTPServer(("127.0.0.1", 5180), MediaHandler)
threading.Thread(target=media_server.serve_forever, daemon=True).start()
executable = os.environ.get("PUPPETEER_EXECUTABLE_PATH") or subprocess.check_output(["node", "-e", 'console.log(require("puppeteer").executablePath())'], cwd=ROOT / "server", text=True, encoding="utf-8").strip()
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=executable)
    context = browser.new_context(accept_downloads=True, viewport={"width": 1440, "height": 1000})
    context.route("**/api/**", route_api)
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto("http://127.0.0.1:5179")
    page.wait_for_load_state("networkidle")
    cards = page.locator(".history-item")
    assert cards.count() == 5, "old and new history must render"
    assert "动态预览" in cards.nth(0).inner_text()
    assert "尚未取得原始文件" in cards.nth(0).inner_text()
    assert "已验证原始动画资源" in cards.nth(3).inner_text()
    assert "已验证平台授权导出" in cards.nth(4).inner_text()
    assert "缺少第 2 页" in cards.nth(2).inner_text()
    cards.nth(0).get_by_role("button", name="查看结果").click()
    image = page.locator(".preview-image img")
    image.wait_for(state="visible")
    assert "尚未取得原始文件" in page.get_by_role("dialog", name="查看结果").inner_text()
    page.wait_for_function("document.querySelector('.preview-image img')?.naturalWidth > 0")
    assert "fixture.gif" in image.get_attribute("src"), "result must bind the animation, not thumbnail"
    # Sample rendered pixels: drawImage(animated img) can expose the first frame only.
    pixels = []
    for _ in range(12):
        pixels.append(image.screenshot())
        page.wait_for_timeout(70)
    assert len(set(pixels)) > 1, "browser must actually play different animation frames"
    output = ROOT / "server" / "test-artifacts"
    output.mkdir(exist_ok=True)
    page.screenshot(path=str(output / "818ps-animation-preview.png"))
    page.get_by_role("dialog", name="查看结果").get_by_role("button", name="Close this dialog").click()
    cards.nth(0).get_by_role("button", name="下载", exact=True).click()
    assert "下载保留预览内容" in page.get_by_role("dialog", name="下载选项").inner_text()
    assert page.get_by_role("link", name="前往官方分享页，按平台权限登录并下载").get_attribute("href") == record["originalUrl"]
    with page.expect_download() as event:
        page.get_by_role("button", name="确认下载", exact=True).click()
    downloaded = event.value
    assert downloaded.suggested_filename.endswith(".gif"), "animation must keep real extension"
    path = output / "downloaded-animation.gif"
    downloaded.save_as(path)
    assert path.read_bytes() == GIF, "download must preserve original fixture bytes"
    metadata = subprocess.check_output(["node", "-e", 'require("./extractors/818ps-animation").inspectMedia(require("fs").readFileSync(process.argv[1])).then(m=>console.log(JSON.stringify(m)))', str(path)], cwd=ROOT / "server", text=True, encoding="utf-8")
    assert json.loads(metadata)["frameCount"] == 2
    # Parse/save through the actual front-end actions and verify metadata survives.
    page.locator(".url-input textarea").fill("https://818ps.com/g/fixture")
    page.locator(".parse-btn").click()
    page.wait_for_function("document.querySelectorAll('.history-item').length === 6")
    assert saved_requests[-1]["animationUrl"] == ANIMATION_URL
    assert saved_requests[-1]["thumbnailUrl"] == THUMB_URL
    assert saved_requests[-1]["frameCount"] == 2
    assert saved_requests[-1]["imageUrls"] == [ANIMATION_URL]
    assert saved_requests[-1]["downloadStatus"] == "preview_only"
    assert saved_requests[-1]["originalResourceStatus"] == "preview_only"
    assert saved_requests[-1]["hasVisibleWatermark"] == "unknown"
    assert not errors, errors
    browser.close()
media_server.shutdown()
print("UI: 11 scenario checks passed (history/partial, preview status, original/export labels, preview dialog, official link, native animation, URL binding, byte-preserving download, GIF reparse, parse metadata, no runtime errors).")
