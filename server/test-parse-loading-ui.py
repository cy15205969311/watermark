"""Browser regression for the parse operation; all HTTP responses are fixtures.
Run using webapp-testing/scripts/with_server.py and the Vite server on port 5179.
"""
import base64
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOwAAAABJRU5ErkJggg=='
GIF = 'data:image/gif;base64,' + base64.b64encode(bytes.fromhex('474946383961010001008000004c6971ff000021ff0b4e45545343415045322e30030100000021f904050a0000002c00000000010001000002024c010021f90405140000002c0000000001000100804c697100ff0002024c01003b')).decode()
URL = 'https://818ps.com/g/loading-fixture'
RECORD = {'id': 1, 'originalUrl': URL, 'platform': '818ps', 'thumbnailUrl': PNG, 'imageUrl': GIF, 'animationUrl': GIF, 'imageUrls': [GIF, PNG], 'pages': [{'page': 1, 'imageUrl': GIF}, {'page': 2, 'imageUrl': PNG}], 'pageCount': 2, 'isMultiPage': True, 'isAnimated': True, 'frameCount': 2, 'detectedFormat': 'gif', 'animationStatus': 'verified_animated', 'resourceRole': 'animation_preview', 'downloadStatus': 'preview_only', 'originalResourceStatus': 'preview_only', 'status': 'success'}

# Invoke the actual script-setup handler so the JS lock is tested independently
# of native disabled behavior and Element Plus's event guard. No test API in app.
INVOKE = '''count => {
  let component = document.querySelector('.parse-btn').__vueParentComponent;
  while (component && !component.type.__file?.endsWith('App.vue')) component = component.parent;
  if (!component?.setupState.handleParse) throw new Error('App handler not found');
  for (let i = 0; i < count; i++) component.setupState.handleParse();
}'''

with sync_playwright() as p:
    exe = subprocess.check_output(['node', '-e', 'console.log(require("puppeteer").executablePath())'], cwd=ROOT / 'server', text=True, encoding='utf-8').strip()
    browser = p.chromium.launch(headless=True, executable_path=exe)
    context = browser.new_context(viewport={'width': 1440, 'height': 1100})
    page = context.new_page()
    pending = {'history': [], 'extract': [], 'save': []}
    counts = {'history': 0, 'extract': 0, 'save': 0}
    requests = []
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))

    def route_api(route):
        url = route.request.url
        kind = 'extract' if '/extract-image' in url else 'save' if '/parse' in url else 'history'
        counts[kind] += 1
        pending[kind].append(route)
        if kind == 'save':
            requests.append(route.request.post_data_json)

    context.route('**/api/**', route_api)
    page.goto('http://127.0.0.1:5179', wait_until='domcontentloaded')
    button = page.locator('.parse-btn')
    field = page.locator('.url-input textarea')
    expect(button).to_be_enabled()
    expect(button).to_have_text('解析链接')
    page.wait_for_function('document.querySelector(".url-input textarea") !== null')

    def wait_pending(kind):
        for _ in range(200):
            if pending[kind]:
                return pending[kind].pop(0)
            page.wait_for_timeout(25)
        raise AssertionError(f'{kind} request not received')

    def ready():
        expect(button).to_be_enabled()
        expect(button).to_have_text('解析链接')
        assert page.locator('.extract-loading-spinner').count() == 0
        assert button.get_attribute('aria-busy') == 'false'

    def busy():
        expect(button).to_be_disabled()
        expect(button).to_have_text('解析中，请稍候…')
        assert button.get_attribute('aria-busy') == 'true'
        expect(page.locator('.extract-loading-spinner')).to_be_visible()
        assert button.evaluate('(e) => getComputedStyle(e).cursor') == 'wait'

    # A/B/F: first synchronous call plus 20 duplicates before DOM can update.
    field.fill(URL)
    width = button.bounding_box()['width']
    page.evaluate(INVOKE, 21)
    extracting = wait_pending('extract')
    busy()
    assert abs(button.bounding_box()['width'] - width) < 0.5
    assert page.locator('.extract-loading-spinner').evaluate('(e)=>getComputedStyle(e).animationName').startswith('extract-spin')
    assert page.locator('.extract-loading-spinner').evaluate('(e)=>getComputedStyle(e).animationDuration') == '0.7s'
    page.locator('.parse-btn').evaluate('(e)=>{for(let i=0;i<20;i++)e.click()}')
    field.press('Enter')
    page.evaluate(INVOKE, 20)
    assert counts['extract'] == 1 and counts['save'] == 0

    # Late history completion must not release the parse lock.
    wait_pending('history').fulfill(json={'success': True, 'data': []})
    page.wait_for_timeout(100)
    busy()
    assert page.locator('.upload-btn').is_enabled() and page.locator('.help-btn').is_enabled()
    artifact = ROOT / 'server' / 'test-artifacts'
    artifact.mkdir(exist_ok=True)
    page.screenshot(path=str(artifact / 'parse-loading-desktop.png'))
    extracting.fulfill(json={'success': True, **RECORD})
    saving = wait_pending('save')
    busy()
    page.evaluate(INVOKE, 20)
    assert counts['extract'] == 1 and counts['save'] == 1
    assert requests[-1]['imageUrls'] == [GIF, PNG] and requests[-1]['frameCount'] == 2
    saving.fulfill(json={'success': True, 'data': RECORD})
    ready()
    expect(field).to_have_value('')
    expect(page.locator('.history-item')).to_have_count(1)

    # C/G: existing result, both preview pages, and native GIF still work.
    page.locator('.history-item').get_by_role('button', name='查看结果').click()
    img = page.locator('.preview-image img')
    expect(img).to_have_attribute('src', GIF)
    page.wait_for_function("document.querySelector('.preview-image img').naturalWidth > 0")
    frames = []
    for _ in range(8):
        frames.append(img.screenshot())
        page.wait_for_timeout(75)
    assert len(set(frames)) > 1
    assert page.locator('.preview-image').evaluate('(e)=>e.__vueParentComponent.props.previewSrcList.length') == 2
    page.get_by_role('dialog', name='查看结果').get_by_role('button', name='Close this dialog').click()
    page.locator('.search-input input').fill('loading-fixture')
    expect(page.locator('.history-item')).to_have_count(1)
    page.locator('.search-input input').fill('missing')
    expect(page.locator('.history-item')).to_have_count(0)
    page.locator('.search-input input').fill('')
    page.locator('.upload-btn').click()
    expect(page.get_by_role('dialog', name='本地图片去水印')).to_be_visible()
    page.get_by_role('dialog', name='本地图片去水印').get_by_role('button', name='Close this dialog').click()
    page.locator('.help-btn').click()
    expect(page.get_by_role('dialog', name='使用教程')).to_be_visible()
    page.get_by_role('dialog', name='使用教程').get_by_role('button', name='Close this dialog').click()

    # D: failed extraction must preserve input and the earlier successful result.
    for failure in ['http', 'network', 'json']:
        field.fill(URL)
        button.click()
        req = wait_pending('extract')
        busy()
        saves_before = counts['save']
        if failure == 'http':
            req.fulfill(status=500, json={'success': False, 'message': 'fixture HTTP failure'})
        elif failure == 'network':
            req.abort('failed')
        else:
            req.fulfill(content_type='application/json', body='{broken')
        ready()
        expect(field).to_have_value(URL)
        expect(page.locator('.error-alert')).to_be_visible()
        expect(page.locator('.history-item')).to_have_count(1)
        assert counts['save'] == saves_before

    # Timeout exercises the real AbortController, accelerating only its timer.
    page.evaluate('''() => { window.realSetTimeout = window.setTimeout;
        window.setTimeout = (fn, delay, ...args) => window.realSetTimeout(fn, delay === 120000 ? 150 : delay, ...args); }''')
    field.fill(URL)
    button.click()
    timeout_request = wait_pending('extract')
    ready()
    expect(page.locator('.error-alert')).to_contain_text('解析请求超时')
    expect(field).to_have_value(URL)
    timeout_request.abort('aborted')
    page.evaluate('window.setTimeout = window.realSetTimeout')

    # Failure during saving is also inside the operation's lifecycle.
    for failure in ['business', 'http', 'json', 'array']:
        field.fill(URL)
        button.click()
        wait_pending('extract').fulfill(json={'success': True, **RECORD})
        req = wait_pending('save')
        busy()
        if failure == 'business':
            req.fulfill(json={'success': False, 'message': 'fixture save failure'})
        elif failure == 'http':
            req.fulfill(status=500, json={'success': False, 'message': 'fixture save HTTP failure'})
        elif failure == 'json':
            req.fulfill(json={'success': True, 'data': None})
        else:
            req.fulfill(json={'success': True, 'data': []})
        ready()
        expect(field).to_have_value(URL)
        expect(page.locator('.history-item')).to_have_count(1)

    # E: invalid text and unsupported schemes never reach either API.
    before = dict(counts)
    for value in ['', 'not-a-url', 'javascript:alert(1)', 'ftp://example.com/file']:
        field.fill(value)
        button.click()
        ready()
    assert counts == before

    # Early return for a public explanation without an image also releases lock.
    field.fill(URL)
    button.click()
    wait_pending('extract').fulfill(json={'success': True, 'status': 'preview_only', 'imageUrls': []})
    ready()
    expect(field).to_have_value(URL)

    # A background history request can also complete AFTER saving a new record.
    page.evaluate('''() => { let c = document.querySelector('.parse-btn').__vueParentComponent;
      while(c && !c.type.__file?.endsWith('App.vue')) c = c.parent;
      c.appContext.config.globalProperties.$store.dispatch('fetchHistory'); }''')
    late_history = wait_pending('history')

    # Mobile size and reduced-motion preference keep the loading state readable.
    page.set_viewport_size({'width': 375, 'height': 1000})
    field.fill(URL)
    page.wait_for_timeout(300)  # Existing button transition after viewport resize.
    width = button.bounding_box()['width']
    button.click()
    req = wait_pending('extract')
    busy()
    assert abs(button.bounding_box()['width'] - width) < 0.5, (width, button.bounding_box())
    page.emulate_media(reduced_motion='reduce')
    assert page.locator('.extract-loading-spinner').evaluate('(e)=>getComputedStyle(e).animationName') == 'none'
    page.screenshot(path=str(artifact / 'parse-loading-mobile.png'))
    req.fulfill(json={'success': True, **RECORD})
    wait_pending('save').fulfill(json={'success': True, 'data': {**RECORD, 'id': 2}})
    ready()
    expect(page.locator('.history-item')).to_have_count(2)
    late_history.fulfill(json={'success': True, 'data': [RECORD]})
    page.wait_for_timeout(100)
    expect(page.locator('.history-item')).to_have_count(2)
    assert not errors, errors
    browser.close()

print('Parse loading: 17 scenario checks passed, 0 failed (immediate loading, JS lock, mouse/keyboard, delayed history, save lock, success, HTTP/network/JSON errors, timeout, save failures, input validation, retry, stable widths, reduced motion, GIF/pages and other controls, early return, stale history).')
