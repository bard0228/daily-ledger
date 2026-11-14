import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert } from './verify-runner.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DEFAULT_BUNDLE =
  process.env.PUPPETEER_BUNDLE ||
  '/usr/local/lib/node_modules/chrome-devtools-mcp/build/src/third_party/index.js';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function findChromeExecutable() {
  for (const bin of [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(Boolean)) {
    if (fs.existsSync(bin)) return bin;
  }
  throw new Error('No headless Chrome/Chromium binary found in VM.');
}

function getTaipeiToday() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function buildSampleCSV() {
  const today = getTaipeiToday();
  const ym = today.slice(0, 7);
  const [y, m] = ym.split('-').map(Number);
  const prevDate = new Date(Date.UTC(y, m - 2, 15));
  const prevYm = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`;

  return [
    '日期,收支,大類,小類,品名,金額',
    `${ym}-01,收入,薪資,月薪,薪資入帳,50000`,
    `${ym}-02,支出,飲食,午餐,金蓉越南料理,175`,
    `${ym}-03,支出,交通,加油,汽車加油錢,1195`,
    `${ym}-04,支出,醫療,掛號與藥品,中國醫掛號費+藥物,580`,
    `${prevYm}-10,支出,交通,停車費,汽車停車費,75`,
    `${prevYm}-20,支出,娛樂,玩具模型,長頭娃娃,140`,
    '2099-12-31,支出,訂閱,影音會員,Netflix 預約扣款,390',
  ].join('\n');
}

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const reqPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const relPath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '');
    const safePath = path.resolve(ROOT, relPath);
    if (!safePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    if (!fs.existsSync(safePath) || fs.statSync(safePath).isDirectory()) {
      res.writeHead(404).end('Not Found');
      return;
    }
    const ext = path.extname(safePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(safePath).pipe(res);
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function verifyStaticArtifacts() {
  const indexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const swJs = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const codeGs = fs.readFileSync(path.join(ROOT, 'Code.gs'), 'utf8');

  // Business logic & Google Sheet schema integrity checks
  assert(
    indexHtml.includes('1hdZuk6u1XQvevxlKiYhbFhK0lj3DMIn6JjcGY1HiWVk'),
    'Missing preserved SHEET_ID in index.html'
  );
  assert(
    indexHtml.includes('https://bard0228.github.io/3d-sushi-portal/index.html'),
    'Missing preserved sushi-portal back link URL'
  );
  assert(!indexHtml.includes('id="reload"'), 'Top reload button (#reload) must remain removed');
  assert(
    indexHtml.includes('Asia/Taipei') && indexHtml.includes('r.d <= TODAY'),
    'Missing Asia/Taipei TODAY date filter protecting future scheduled rows'
  );
  assert(
    codeGs.includes('insertRecordByDate') && codeGs.includes('定期扣款設定'),
    'Code.gs core scheduling/insertion logic must remain intact'
  );

  // Liquid Glass UI assets & theme-color sync
  assert(
    fs.existsSync(path.join(ROOT, 'liquid-glass-kit.css')),
    'Missing liquid-glass-kit.css in project root'
  );
  assert(
    fs.existsSync(path.join(ROOT, 'android-overscroll.js')),
    'Missing android-overscroll.js in project root'
  );
  assert(
    indexHtml.includes('liquid-glass-kit.css') && indexHtml.includes('android-overscroll.js'),
    'index.html must load liquid-glass-kit.css and android-overscroll.js'
  );
  assert(
    manifest.theme_color === '#f0f3f8' && manifest.background_color === '#f0f3f8',
    `manifest.json theme/background color must be #f0f3f8 (got ${manifest.theme_color}/${manifest.background_color})`
  );
  assert(
    indexHtml.includes('<meta name="theme-color" content="#f0f3f8">'),
    'index.html meta theme-color must be #f0f3f8'
  );
  assert(
    swJs.includes('./liquid-glass-kit.css') && swJs.includes('./android-overscroll.js'),
    'sw.js ASSETS must cache liquid-glass-kit.css and android-overscroll.js'
  );
  assert(!swJs.includes("'daily-ledger-v1'"), 'sw.js CACHE_NAME must be bumped beyond v1');

  // Verify Google Fonts import & CSS motion rules on disk
  const kitCss = fs.readFileSync(path.join(ROOT, 'liquid-glass-kit.css'), 'utf8');
  assert(
    kitCss.includes('Plus Jakarta Sans') && kitCss.includes('Noto Sans TC'),
    'liquid-glass-kit.css must load Plus Jakarta Sans and Noto Sans TC'
  );
  assert(
    kitCss.includes('scale(0.96)') && kitCss.includes('0.08s'),
    'liquid-glass-kit.css must define 0.08s scale(0.96) active press'
  );
  assert(
    kitCss.includes('0.42s') && kitCss.includes('grid-template-rows'),
    'liquid-glass-kit.css must define 0.42s grid-template-rows accordion'
  );

  // Zero-Noise source checks (no emojis in index.html, no tips)
  const emojiRe = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
  assert(!emojiRe.test(indexHtml), 'index.html must contain zero Unicode Emoji');
  assert(!indexHtml.includes('例如：'), 'index.html must not contain search usage hints ("例如：")');
  assert(!indexHtml.includes('請確認試算表'), 'index.html must not contain reminder tips ("請確認試算表")');
}

async function runBrowserSuite(baseUrl) {
  const { puppeteer } = await import(DEFAULT_BUNDLE);
  const browser = await puppeteer.launch({
    executablePath: findChromeExecutable(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });

  const sampleCsv = buildSampleCSV();
  const todayYm = getTaipeiToday().slice(0, 7);

  try {
    // ------------------------------------------------------------------
    // Case 1: Pixel 10 Pro (412x915) Full Interactive UI Verification
    // ------------------------------------------------------------------
    {
      const page = await browser.newPage();
      page.setDefaultTimeout(15000);
      await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });

      const consoleErrors = [];
      const pageErrors = [];
      const sameOriginNetErrors = [];

      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          const txt = msg.text();
          const locUrl = msg.location()?.url || '';
          if (locUrl.endsWith('/favicon.ico') && txt.includes('404')) return;
          if (locUrl && !locUrl.startsWith(baseUrl) && txt.startsWith('Failed to load resource:')) return;
          consoleErrors.push(locUrl ? `${txt} (${locUrl})` : txt);
        }
      });
      page.on('pageerror', (err) => pageErrors.push(err?.message || String(err)));
      page.on('response', (res) => {
        if (res.status() >= 400 && res.url().startsWith(baseUrl) && !res.url().endsWith('/favicon.ico')) {
          sameOriginNetErrors.push(`${res.status()} ${res.url()}`);
        }
      });

      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const u = req.url();
        if (u.startsWith('https://docs.google.com/spreadsheets/')) {
          req.respond({
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'text/csv; charset=utf-8',
            body: sampleCsv,
          });
          return;
        }
        req.continue();
      });

      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main#app:not([hidden])');
      await new Promise((r) => setTimeout(r, 300));

      // 1) Design system tokens, fonts, smoothing, tabular-nums, zero-noise
      const styleAudit = await page.evaluate(() => {
        const bodyStyle = getComputedStyle(document.body);
        const tabEl = document.querySelector('.tabular-nums');
        const tabStyle = tabEl ? getComputedStyle(tabEl) : null;
        const ddPanel = document.getElementById('ddPanel');
        const bodyText = document.body.innerText || '';
        const hasAmbient = Boolean(document.querySelector('.lg-ambient-bg'));
        const hasAppShell = Boolean(document.getElementById('app-shell'));
        const hasSub = Boolean(document.querySelector('.brand-text .sub, #asof'));
        const hasFontsLink = [...document.querySelectorAll('link[rel="stylesheet"]')].some(
          (l) => l.href.includes('Plus+Jakarta+Sans') && l.href.includes('Noto+Sans+TC')
        );
        const svgs = [...document.querySelectorAll('svg:not(.pie)')];
        const invalidSvgs = svgs.filter((s) => {
          const fill = s.getAttribute('fill');
          const sw = s.getAttribute('stroke-width');
          return fill !== 'none' || sw !== '2';
        }).length;

        return {
          bgColor: bodyStyle.backgroundColor,
          fontFamily: bodyStyle.fontFamily,
          smoothing: bodyStyle.webkitFontSmoothing || bodyStyle.getPropertyValue('-webkit-font-smoothing'),
          letterSpacing: bodyStyle.letterSpacing,
          tabFont: tabStyle?.fontFamily || '',
          tabVariant: tabStyle?.fontVariantNumeric || '',
          tabFeature: tabStyle?.fontFeatureSettings || '',
          ddParentIsBody: ddPanel ? ddPanel.parentElement === document.body : false,
          ddHasIceFrame: ddPanel ? ddPanel.classList.contains('lg-ice-frame') : false,
          ddHasInnerGlass: ddPanel ? Boolean(ddPanel.querySelector('.lg-inner-glass')) : false,
          ddBackdrop: ddPanel ? getComputedStyle(ddPanel).backdropFilter || getComputedStyle(ddPanel).webkitBackdropFilter : '',
          ddTransition: ddPanel ? getComputedStyle(ddPanel).transition : '',
          hasAmbient,
          hasAppShell,
          hasSub,
          hasFontsLink,
          invalidSvgs,
          bodyText,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });

      assert(styleAudit.bgColor === 'rgb(240, 243, 248)', `Expected #f0f3f8 body bg, got ${styleAudit.bgColor}`);
      assert(styleAudit.hasAmbient, 'Missing .lg-ambient-bg element');
      assert(styleAudit.hasAppShell, 'Missing #app-shell container for Android edge stretch');
      assert(!styleAudit.hasSub, 'Subtitle (.sub / #asof) must be removed per Zero-Noise rule');
      assert(styleAudit.hasFontsLink, 'Missing Google Fonts stylesheet link in <head>');
      assert(
        styleAudit.fontFamily.includes('Plus Jakarta Sans') && styleAudit.fontFamily.includes('Noto Sans TC'),
        `Unexpected body font-family: ${styleAudit.fontFamily}`
      );
      assert(styleAudit.smoothing === 'antialiased', `Expected antialiased smoothing, got ${styleAudit.smoothing}`);
      assert(styleAudit.tabFont.includes('Plus Jakarta Sans'), `Expected Plus Jakarta Sans on .tabular-nums, got ${styleAudit.tabFont}`);
      assert(styleAudit.tabVariant.includes('tabular-nums'), `Expected tabular-nums variant, got ${styleAudit.tabVariant}`);
      assert(styleAudit.tabFeature.includes('tnum'), `Expected tnum font-feature, got ${styleAudit.tabFeature}`);
      assert(styleAudit.invalidSvgs === 0, `All UI icon SVGs must use fill="none" stroke-width="2" (found ${styleAudit.invalidSvgs} violations)`);
      assert(!styleAudit.bodyText.includes('Netflix 預約扣款'), 'Future row (2099-12-31) must be hidden by TODAY filter');
      assert(styleAudit.scrollWidth <= styleAudit.clientWidth, `Horizontal overflow at 412px: ${styleAudit.scrollWidth} > ${styleAudit.clientWidth}`);

      // 2) Portal & Dual-layer Ice Crystal & 0.42s Accordion checks on Dropdown
      assert(styleAudit.ddParentIsBody, '#ddPanel must be mounted directly on document.body (Portal rule)');
      assert(styleAudit.ddHasIceFrame && styleAudit.ddHasInnerGlass, '#ddPanel must use .lg-ice-frame wrapping .lg-inner-glass');
      assert(styleAudit.ddBackdrop.includes('blur('), `Missing backdrop-filter blur on #ddPanel: ${styleAudit.ddBackdrop}`);
      assert(styleAudit.ddTransition.includes('0.42s') && styleAudit.ddTransition.includes('grid-template-rows'), `#ddPanel must use 0.42s grid-template-rows accordion: ${styleAudit.ddTransition}`);

      // 3) Check touch targets (>= 48px) and unoccluded clickability
      const touchCheck = await page.evaluate(() => {
        const ids = ['ddBtn', 'q', 'clr', 'liquid-back-btn', 'liquid-refresh-btn'];
        const bad = [];
        for (const id of ids) {
          const el = document.getElementById(id);
          if (!el) { bad.push(`${id}: missing`); continue; }
          const r = el.getBoundingClientRect();
          if (r.height < 48 || (id !== 'q' && r.width < 48)) {
            bad.push(`${id}: ${Math.round(r.width)}x${Math.round(r.height)}px`);
          }
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          const topEl = document.elementFromPoint(cx, cy);
          if (!topEl || (topEl !== el && !el.contains(topEl))) {
            bad.push(`${id}: occluded by ${topEl?.tagName}#${topEl?.id}`);
          }
        }
        return bad;
      });
      assert(touchCheck.length === 0, `Touch target / occlusion failure: ${touchCheck.join(', ')}`);

      // 4) Open month dropdown, verify bounds inside 412px & >= 48px option height, switch month
      await page.click('#ddBtn');
      await new Promise((r) => setTimeout(r, 480));
      const ddOpenAudit = await page.evaluate(() => {
        const panel = document.getElementById('ddPanel');
        const r = panel.getBoundingClientRect();
        const opt = panel.querySelector('.dd-opt:not([aria-selected="true"])');
        const optRect = opt ? opt.getBoundingClientRect() : null;
        return {
          openClass: panel.classList.contains('is-open'),
          rect: { left: r.left, right: r.right, width: r.width, height: r.height },
          optHeight: optRect ? optRect.height : 0,
          hasPrevOpt: Boolean(opt),
          overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        };
      });
      assert(ddOpenAudit.openClass && ddOpenAudit.rect.height > 80, '#ddPanel failed to expand open');
      assert(ddOpenAudit.rect.left >= 8 && ddOpenAudit.rect.right <= 404, `#ddPanel clipped outside 412px viewport: left=${ddOpenAudit.rect.left}, right=${ddOpenAudit.rect.right}`);
      assert(ddOpenAudit.optHeight >= 48, `.dd-opt height must be >= 48px (got ${ddOpenAudit.optHeight})`);
      assert(!ddOpenAudit.overflowX, 'Horizontal overflow while dropdown open');
      assert(ddOpenAudit.hasPrevOpt, 'Missing second month option in sample data');

      await page.click('#ddPanel .dd-opt:not([aria-selected="true"])');
      await new Promise((r) => setTimeout(r, 480));
      const switchedText = await page.evaluate(() => document.body.innerText);
      assert(switchedText.includes('汽車停車費') && switchedText.includes('長頭娃娃'), 'Month switch did not render previous month rows');

      // Switch back to current month
      await page.click('#ddBtn');
      await new Promise((r) => setTimeout(r, 480));
      await page.click(`#ddPanel .dd-opt[data-m="${todayYm}"]`);
      await new Promise((r) => setTimeout(r, 480));

      // 5) Search input + 0.42s accordion + clear button
      await page.type('#q', '越南');
      await new Promise((r) => setTimeout(r, 480));
      const searchOpen = await page.evaluate(() => {
        const sBox = document.getElementById('sBox');
        const dur = getComputedStyle(sBox).transitionDuration;
        const txt = document.getElementById('sResult').innerText;
        return { isOpen: sBox.classList.contains('is-open'), dur, txt };
      });
      assert(searchOpen.isOpen, 'Search accordion #sBox did not open with .is-open');
      assert(searchOpen.dur.includes('0.42s'), `Search accordion #sBox must use 0.42s transition (got ${searchOpen.dur})`);
      assert(searchOpen.txt.includes('金蓉越南料理'), 'Search results missing matching item');

      await page.click('#clr');
      await new Promise((r) => setTimeout(r, 480));
      const searchClosed = await page.evaluate(() => !document.getElementById('sBox').classList.contains('is-open'));
      assert(searchClosed, '#clr did not collapse #sBox');

      // 6) Interactive Ledger Detail Modal Portal (dual-layer ice crystal + bounce-in / shrink-out)
      await page.click('#ledger tr[data-rec-id]');
      await new Promise((r) => setTimeout(r, 400));
      const modalOpen = await page.evaluate(() => {
        const dlg = document.querySelector('dialog[open], [role="dialog"]:not([hidden])');
        if (!dlg) return { found: false };
        const frame = dlg.querySelector('.lg-ice-frame');
        const inner = frame ? frame.querySelector('.lg-inner-glass') : null;
        const closeBtn = dlg.querySelector('[aria-label="關閉"]');
        const cr = closeBtn ? closeBtn.getBoundingClientRect() : null;
        return {
          found: true,
          parentIsBody: dlg.parentElement === document.body,
          hasIceFrame: Boolean(frame),
          hasInnerGlass: Boolean(inner),
          hasEnterClass: frame ? frame.classList.contains('lg-pop-enter') || dlg.classList.contains('lg-pop-enter') : false,
          closeSizeOk: Boolean(cr && cr.width >= 48 && cr.height >= 48),
          text: dlg.innerText,
        };
      });
      assert(modalOpen.found, 'Clicking ledger row must open Detail Modal Portal');
      assert(modalOpen.parentIsBody, 'Detail Modal must be mounted directly on document.body');
      assert(modalOpen.hasIceFrame && modalOpen.hasInnerGlass, 'Detail Modal must use dual-layer .lg-ice-frame > .lg-inner-glass');
      assert(modalOpen.hasEnterClass, 'Detail Modal must apply .lg-pop-enter bounce-in class');
      assert(modalOpen.closeSizeOk, 'Modal close button must be >= 48x48px');
      assert(modalOpen.text.includes('小類'), 'Detail Modal must reveal full fields including 小類 on mobile');

      await page.click('dialog [aria-label="關閉"], [role="dialog"] [aria-label="關閉"]');
      await new Promise((r) => setTimeout(r, 320));
      const modalClosed = await page.evaluate(() => !document.querySelector('dialog[open], [role="dialog"]:not([hidden])'));
      assert(modalClosed, 'Detail Modal did not close cleanly after clicking close button');

      // 7) Android 12 Edge Overscroll stretch behavior test
      const overscrollOk = await page.evaluate(async () => {
        const shell = document.getElementById('app-shell');
        if (!shell) return { ok: false, reason: 'no #app-shell' };
        window.scrollTo(0, 0);
        const mkTouch = (y) => new Touch({ identifier: 1, target: shell, clientX: 200, clientY: y });
        window.dispatchEvent(new TouchEvent('touchstart', { touches: [mkTouch(100)] }));
        window.dispatchEvent(new TouchEvent('touchmove', { touches: [mkTouch(220)] }));
        const stretchedTransform = shell.style.transform;
        const stretchedOrigin = shell.style.transformOrigin;
        window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
        await new Promise((r) => setTimeout(r, 450));
        return {
          ok: stretchedTransform.startsWith('scaleY(') && stretchedOrigin.includes('top'),
          stretchedTransform,
          stretchedOrigin,
        };
      });
      assert(overscrollOk.ok, `Android edge stretch failed: ${JSON.stringify(overscrollOk)}`);

      assert(pageErrors.length === 0, `Case 1 pageerrors: ${pageErrors.join(' | ')}`);
      assert(consoleErrors.length === 0, `Case 1 consoleErrors: ${consoleErrors.join(' | ')}`);
      assert(sameOriginNetErrors.length === 0, `Case 1 networkErrors: ${sameOriginNetErrors.join(' | ')}`);
      await page.close();
    }

    // ------------------------------------------------------------------
    // Case 2: Network Failure Floating Notification Portal (Zero-Noise)
    // ------------------------------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().startsWith('https://docs.google.com/spreadsheets/')) {
          req.abort('failed');
          return;
        }
        req.continue();
      });

      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
      await new Promise((r) => setTimeout(r, 450));

      const toastAudit = await page.evaluate(() => {
        const toastRoot = document.getElementById('lgToastRoot');
        const toastCard = toastRoot?.querySelector('.lg-ice-frame');
        const toastInner = toastCard?.querySelector('.lg-inner-glass');
        const txt = document.body.innerText || '';
        return {
          rootParentIsBody: toastRoot ? toastRoot.parentElement === document.body : false,
          hasCard: Boolean(toastCard),
          hasInner: Boolean(toastInner),
          hasEnter: toastCard ? toastCard.classList.contains('lg-pop-enter') : false,
          hasTipText: txt.includes('請確認試算表') || txt.includes('例如：'),
        };
      });
      assert(toastAudit.rootParentIsBody, 'Floating toast container (#lgToastRoot) must mount on document.body');
      assert(toastAudit.hasCard && toastAudit.hasInner, 'Error notification toast must use dual-layer .lg-ice-frame > .lg-inner-glass');
      assert(toastAudit.hasEnter, 'Error notification toast must use .lg-pop-enter bounce-in');
      assert(!toastAudit.hasTipText, 'Error notification must not display usage tips or instructions');
      await page.close();
    }

    // ------------------------------------------------------------------
    // Case 3: Desktop (1280x800) & Embedded Dock Guard Check
    // ------------------------------------------------------------------
    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 800, isMobile: false, hasTouch: false });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (req.url().startsWith('https://docs.google.com/spreadsheets/')) {
          req.respond({
            status: 200,
            headers: { 'Access-Control-Allow-Origin': '*' },
            contentType: 'text/csv; charset=utf-8',
            body: sampleCsv,
          });
          return;
        }
        req.continue();
      });

      await page.goto(`${baseUrl}/index.html`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('main#app:not([hidden])');
      await new Promise((r) => setTimeout(r, 300));

      const desktopOk = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert(
        desktopOk.scrollWidth <= desktopOk.clientWidth,
        `Desktop overflow at 1280px: ${desktopOk.scrollWidth} > ${desktopOk.clientWidth}`
      );

      // Verify sushi-portal-dock--embedded hides dock when hosted inside same-origin iframe
      await page.evaluate((srcUrl) => {
        document.body.innerHTML = '';
        const f = document.createElement('iframe');
        f.id = 'f';
        f.src = srcUrl;
        f.style.cssText = 'width:412px;height:915px;border:0';
        document.body.appendChild(f);
      }, `${baseUrl}/index.html`);
      await page.waitForFunction(() => {
        const f = document.getElementById('f');
        const doc = f?.contentDocument;
        const dock = doc?.querySelector('.bottom-left-dock');
        return dock && getComputedStyle(dock).display === 'none';
      });
      await page.close();
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  verifyStaticArtifacts();
  const { server, baseUrl } = await startStaticServer();
  try {
    await runBrowserSuite(baseUrl);
    console.log('PASS verify-ui (Pixel 10 Pro 412x915 + Desktop 1280x800, Liquid Glass UI, Zero-Noise, Portals, consoleErrors=0)');
    process.exit(0);
  } finally {
    await new Promise((r) => server.close(r));
  }
})().catch((err) => {
  console.error(`FAIL verify-ui: ${err.message}`);
  process.exit(1);
});
