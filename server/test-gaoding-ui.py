"""Gaoding frontend regression with intercepted APIs and no database writes."""
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOwAAAABJRU5ErkJggg=='
URL = 'https://www.gaoding.com/dam/share/ui-fixture#我分享了「设计」'

with sync_playwright() as p:
    exe = subprocess.check_output(['node', '-e', 'console.log(require("puppeteer").executablePath())'], cwd=ROOT / 'server', text=True, encoding='utf-8').strip()
    browser = p.chromium.launch(headless=True, executable_path=exe)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    state = {'mode': 'unknown', 'saves': [], 'images': [], 'errors': []}
    page.on('pageerror', lambda error: state['errors'].append(str(error)))

    def route_api(route):
        url = route.request.url
        if '/extract-image' in url:
            if state['mode'] == 'unavailable':
                route.fulfill(json={'success': False, 'platform': 'Gaoding', 'status': 'preview_only', 'imageUrl': None, 'imageUrls': [], 'pageCount': 0, 'message': '未取得目标设计稿预览'})
            else:
                route.fulfill(json={'success': True, 'platform': 'Gaoding', 'source': 'share-api-preview', 'status': 'preview_image', 'imageUrl': PNG, 'thumbnailUrl': PNG, 'imageUrls': [PNG], 'pages': [{'page': 1, 'pageNumber': None, 'designId': 'file', 'imageUrl': PNG}], 'pageCount': 1, 'expectedPageCount': None, 'collectedPageCount': 1, 'isMultiPage': False, 'completenessStatus': 'unknown', 'isComplete': None})
        elif '/parse' in url:
            data = route.request.post_data_json
            state['saves'].append(data)
            route.fulfill(json={'success': True, 'data': {'id': len(state['saves']), 'originalUrl': URL, **data}})
        else:
            route.fulfill(json={'success': True, 'data': []})

    page.route('**/api/**', route_api)
    page.goto('http://127.0.0.1:5179', wait_until='networkidle')
    field, button = page.locator('.url-input textarea'), page.locator('.parse-btn')
    field.fill(URL)
    button.click()
    expect(button).to_be_enabled()
    page.wait_for_function("document.querySelector('.url-input textarea').value === ''")
    assert len(state['saves']) == 1
    saved = state['saves'][0]
    assert saved['imageUrl'] == PNG and saved['imageUrls'] == [PNG]
    assert saved['completenessStatus'] == 'unknown' and saved['isComplete'] is None
    assert saved['source'] == 'share-api-preview'
    assert saved['pages'][0]['designId'] == 'file'
    expect(page.locator('.el-message')).to_contain_text('尚无法确认')

    state['mode'] = 'unavailable'
    field.fill(URL)
    button.click()
    expect(button).to_be_enabled()
    expect(page.get_by_text('未取得目标设计稿预览', exact=False).first).to_be_visible()
    assert len(state['saves']) == 1, 'Unavailable design must not save a random placeholder'
    assert field.input_value() == URL
    assert not state['errors'], state['errors']
    page.screenshot(path=str(ROOT / 'server/test-artifacts/gaoding-ui.png'))
    browser.close()
    print('Gaoding UI: target preview and unknown metadata saved; unavailable result never saves placeholder; retry enabled; no runtime errors.')
