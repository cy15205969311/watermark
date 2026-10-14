"""Gaoding frontend regression with intercepted APIs and no database writes."""
import subprocess
import json
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOwAAAABJRU5ErkJggg=='
URL = 'https://www.gaoding.com/dam/share/ui-fixture#我分享了「设计」'
live_result = None
if '--live-fixture' in sys.argv:
    live_result = json.loads(Path(sys.argv[sys.argv.index('--live-fixture') + 1]).read_text(encoding='utf-8'))

with sync_playwright() as p:
    exe = subprocess.check_output(['node', '-e', 'console.log(require("puppeteer").executablePath())'], cwd=ROOT / 'server', text=True, encoding='utf-8').strip()
    browser = p.chromium.launch(headless=True, executable_path=exe)
    page = browser.new_page(viewport={'width': 1440, 'height': 1000})
    state = {'mode': 'unknown', 'saves': [], 'images': [], 'errors': [], 'downloads': []}
    page.on('pageerror', lambda error: state['errors'].append(str(error)))
    page.on('download', lambda download: state['downloads'].append(download.suggested_filename))

    def route_api(route):
        url = route.request.url
        if '/extract-image' in url:
            if state['mode'] == 'unavailable':
                route.fulfill(json={'success': False, 'platform': 'Gaoding', 'status': 'preview_only', 'imageUrl': None, 'imageUrls': [], 'pageCount': 0, 'message': '未取得目标设计稿预览'})
            elif state['mode'] == 'live':
                route.fulfill(json=live_result)
            elif state['mode'] in ('multi', 'three'):
                count = 5 if state['mode'] == 'multi' else 3
                pages = [{'page': n, 'pageNumber': n, 'pageId': f'p{n}', 'shareId': 'ui-fixture', 'designId': 'file', 'imageUrl': PNG} for n in range(1, count + 1)]
                route.fulfill(json={'success': True, 'platform': 'Gaoding', 'source': 'design-json-pages', 'status': 'success', 'imageUrl': PNG, 'thumbnailUrl': PNG, 'imageUrls': [PNG] * count, 'pages': pages, 'pageCount': count, 'expectedPageCount': count, 'collectedPageCount': count, 'isMultiPage': True, 'completenessStatus': 'complete', 'isComplete': True})
            else:
                route.fulfill(json={'success': True, 'platform': 'Gaoding', 'source': 'share-api-preview', 'status': 'preview_image', 'imageUrl': PNG, 'thumbnailUrl': PNG, 'imageUrls': [PNG], 'pages': [{'page': 1, 'pageNumber': None, 'designId': 'file', 'imageUrl': PNG}], 'pageCount': 1, 'expectedPageCount': None, 'collectedPageCount': 1, 'isMultiPage': False, 'completenessStatus': 'unknown', 'isComplete': None})
        elif '/parse' in url:
            data = route.request.post_data_json
            state['saves'].append(data)
            route.fulfill(json={'success': True, 'data': {'id': len(state['saves']), 'originalUrl': URL, **data}})
        else:
            route.fulfill(json={'success': True, 'data': []})

    page.route('**/api/**', route_api)
    if live_result:
        def route_live_image(route):
            if route.request.url in live_result['imageUrls']:
                index = live_result['imageUrls'].index(route.request.url) + 1
                route.fulfill(content_type='image/png', body=(ROOT / f'server/test-artifacts/gaoding-artboards-page-{index}.png').read_bytes())
            else:
                route.fulfill(status=404)
        page.route('https://gdesign-dam-hw.dancf.com/**', route_live_image)
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

    state['mode'] = 'multi'
    field.fill(URL)
    button.click()
    page.wait_for_function("document.querySelector('.url-input textarea').value === ''")
    assert len(state['saves']) == 2
    saved = state['saves'][1]
    assert len(saved['pages']) == len(saved['imageUrls']) == saved['pageCount'] == 5
    assert [p['pageId'] for p in saved['pages']] == ['p1', 'p2', 'p3', 'p4', 'p5']
    assert saved['isComplete'] is True and saved['completenessStatus'] == 'complete'
    page.get_by_role('button', name='查看结果').first.click()
    page.locator('.preview-image .el-image__inner').click()
    expect(page.locator('.el-image-viewer__next')).to_be_visible()
    for _ in range(4):
        page.locator('.el-image-viewer__next').click()
    expect(page.locator('.el-image-viewer__img')).to_be_visible()
    page.locator('.el-image-viewer__close').click()
    page.locator('.el-dialog:visible .el-dialog__headerbtn').first.click()

    page.get_by_role('button', name='下载', exact=True).first.click()
    page.get_by_role('button', name='确认下载').click()
    page.wait_for_timeout(1800)
    assert state['downloads'] == [f'download-2-p{n}.png' for n in range(1, 6)], state['downloads']

    state['mode'] = 'three'
    field.fill(URL)
    button.click()
    page.wait_for_function("document.querySelector('.url-input textarea').value === ''")
    assert len(state['saves']) == 3
    assert len(state['saves'][2]['pages']) == len(state['saves'][2]['imageUrls']) == 3
    page.get_by_role('button', name='下载', exact=True).first.click()
    page.get_by_role('button', name='确认下载').click()
    page.wait_for_timeout(1300)
    assert state['downloads'][-3:] == [f'download-3-p{n}.png' for n in range(1, 4)], state['downloads']

    if live_result:
        state['mode'] = 'live'
        field.fill(live_result['metadata']['normalizedUrl'])
        button.click()
        page.wait_for_function("document.querySelector('.url-input textarea').value === ''")
        saved = state['saves'][-1]
        assert saved['pages'] == live_result['pages'] and saved['imageUrls'] == live_result['imageUrls']
        assert saved['pageCount'] == 3 and saved['isComplete'] is True
        page.get_by_role('button', name='查看结果').first.click()
        page.locator('.preview-image .el-image__inner').click()
        for index in range(3):
            image = page.locator('.el-image-viewer__img')
            page.wait_for_function("expected => { const img = document.querySelector('.el-image-viewer__img'); return img?.src === expected && img.complete && img.naturalWidth > 0 }", arg=live_result['imageUrls'][index])
            assert image.get_attribute('src') == live_result['imageUrls'][index]
            if index < 2:
                page.locator('.el-image-viewer__next').click()
        page.locator('.el-image-viewer__close').click()
        page.locator('.el-dialog:visible .el-dialog__headerbtn').first.click()
        page.evaluate("""() => {
            window.__gaodingDownloadLinks = [];
            HTMLAnchorElement.prototype.click = function() { window.__gaodingDownloadLinks.push({url: this.href, filename: this.download}) };
            window.open = () => null;
        }""")
        page.get_by_role('button', name='下载', exact=True).first.click()
        page.get_by_role('button', name='确认下载').click()
        page.wait_for_timeout(1300)
        links = page.evaluate('window.__gaodingDownloadLinks')
        assert [link['url'] for link in links] == live_result['imageUrls']
        assert [link['filename'] for link in links] == [f'download-4-p{n}.png' for n in range(1, 4)]
        print('Live captured API fixture: three exact page URLs saved, previewed with local image responses, and mapped to ordered download links.')

    state['mode'] = 'unavailable'
    field.fill(URL)
    button.click()
    expect(button).to_be_enabled()
    expect(page.get_by_text('未取得目标设计稿预览', exact=False).first).to_be_visible()
    assert len(state['saves']) == (4 if live_result else 3), 'Unavailable design must not save a random placeholder'
    assert field.input_value() == URL
    assert not state['errors'], state['errors']
    page.screenshot(path=str(ROOT / 'server/test-artifacts/gaoding-ui.png'))
    browser.close()
    print('Gaoding UI: unknown preview; five and three identified pages saved and downloaded in order; unavailable result passed; no runtime errors.')
