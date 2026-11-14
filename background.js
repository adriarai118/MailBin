importScripts('update-config.js');

// جیمیل‌بین — سرویس پس‌زمینه
// ایمیل‌ها را از فید Atom جیمیل می‌خواند (با همان ورودی که در کروم لاگین هستید؛ نیازی به رمز یا API نیست).

const DEFAULTS = { interval: 1, notify: true, maxAccounts: 5, label: '', scope: 'inbox', markOnOpen: true };
const GMAIL = 'https://mail.google.com/mail/u/';

// ---------- راه‌اندازی و زمان‌بندی ----------
chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

async function setup() {
  chrome.alarms.create('update', { delayInMinutes: 1, periodInMinutes: 360 });
  const s = await getSettings();
  await chrome.alarms.clear('check');
  chrome.alarms.create('check', { periodInMinutes: Math.max(0.5, Number(s.interval) || 1) });
  check();
}

chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === 'check') check();
  if (a.name === 'update') autoCheckUpdate();
});

// ---------- بررسی نسخه جدید در GitHub ----------
async function autoCheckUpdate() {
  try {
    const info = await checkUpdate();
    const { updNotified } = await chrome.storage.local.get('updNotified');
    if (info.has && updNotified !== info.latest) {
      chrome.notifications.create('update', {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'نسخه جدید جیمیل‌بین',
        message: `نسخه ${info.latest} آماده است — برای آپدیت کلیک کنید.`,
        priority: 1,
      });
      await chrome.storage.local.set({ updNotified: info.latest });
    }
  } catch (e) { console.warn('update check failed', e); }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.settings) setup();
});

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

// ---------- تجزیه فید Atom (DOMParser در service worker در دسترس نیست) ----------
function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      const k = e.toLowerCase();
      if (k === 'amp') return '&';
      if (k === 'lt') return '<';
      if (k === 'gt') return '>';
      if (k === 'quot') return '"';
      if (k === 'apos') return "'";
      if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
      if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
      return m;
    });
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`));
  return m ? decode(m[1].trim()) : '';
}

function parseFeed(xml, index) {
  const parts = xml.split('<entry>');
  const head = parts[0];
  const title = tag(head, 'title');
  const email = (title.match(/[\w.+-]+@[\w-]+(\.[\w-]+)+/) || [''])[0].toLowerCase();
  const fullcount = parseInt(tag(head, 'fullcount'), 10) || 0;

  const entries = parts.slice(1).map((raw) => {
    const e = raw.split('</entry>')[0];
    const authorBlock = (e.match(/<author>([\s\S]*?)<\/author>/) || ['', ''])[1];
    const linkRaw = (e.match(/<link[^>]*href="([^"]+)"/) || ['', ''])[1];
    const link = decode(linkRaw);
    const messageId = (link.match(/message_id=([0-9a-f]+)/i) || ['', ''])[1];
    return {
      id: tag(e, 'id') || messageId,
      messageId,
      subject: tag(e, 'title') || '(بدون موضوع)',
      summary: tag(e, 'summary'),
      from: tag(authorBlock, 'name') || tag(authorBlock, 'email'),
      fromEmail: tag(authorBlock, 'email'),
      issued: tag(e, 'issued') || tag(e, 'modified'),
      url: messageId ? `${GMAIL}${index}/#inbox/${messageId}` : `${GMAIL}${index}/#inbox`,
    };
  });

  return { email, fullcount, entries };
}

// ---------- بررسی ایمیل‌ها ----------
let running = null;
function check() {
  if (!running) running = doCheck().finally(() => { running = null; });
  return running;
}

async function doCheck() {
  const s = await getSettings();
  const accounts = [];
  const seen = new Set();
  let status = 'ok';

  for (let i = 0; i < Math.min(10, Number(s.maxAccounts) || 5); i++) {
    const label = (s.label || '').trim() || (s.scope === 'primary' ? '^smartlabel_personal' : '');
    const url = `${GMAIL}${i}/feed/atom/${label ? encodeURIComponent(label) : ''}`;
    let res;
    try {
      res = await fetch(url, { credentials: 'include', cache: 'no-store' });
    } catch (err) {
      if (i === 0) status = 'offline';
      break;
    }
    if (!res.ok) { if (i === 0) status = 'loggedout'; break; }
    const xml = await res.text();
    if (!xml.includes('<feed')) { if (i === 0) status = 'loggedout'; break; }
    const feed = parseFeed(xml, i);
    if (!feed.email || seen.has(feed.email)) break; // ایندکس نامعتبر معمولاً به حساب اول برمی‌گردد
    seen.add(feed.email);
    accounts.push({ index: i, ...feed });
  }

  // اگر شبکه قطع بود، داده قبلی را نگه داریم
  if (status === 'offline') {
    const { state } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...(state || {}), status, updated: Date.now() } });
    setBadge(null, status);
    return;
  }

  const total = accounts.reduce((n, a) => n + a.fullcount, 0);
  await notifyNew(accounts, s);
  await chrome.storage.local.set({ state: { accounts, status, total, updated: Date.now() } });
  setBadge(total, status);
}

function setBadge(total, status) {
  if (status !== 'ok') {
    chrome.action.setBadgeBackgroundColor({ color: '#8a8f98' });
    chrome.action.setBadgeText({ text: status === 'loggedout' ? '?' : '!' });
    chrome.action.setTitle({ title: status === 'loggedout' ? 'جیمیل‌بین — وارد جیمیل نشده‌اید' : 'جیمیل‌بین — اتصال برقرار نیست' });
    return;
  }
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeText({ text: total ? (total > 999 ? '999+' : String(total)) : '' });
  chrome.action.setTitle({ title: total ? `جیمیل‌بین — ${total} ایمیل خوانده‌نشده` : 'جیمیل‌بین — ایمیل جدیدی نیست' });
}

// ---------- اعلان ----------
async function notifyNew(accounts, s) {
  const { knownIds } = await chrome.storage.local.get('knownIds');
  const firstRun = !Array.isArray(knownIds);
  const known = new Set(knownIds || []);
  const current = [];
  const fresh = [];

  for (const a of accounts) {
    for (const e of a.entries) {
      current.push(e.id);
      if (!known.has(e.id)) fresh.push({ a, e });
    }
  }
  await chrome.storage.local.set({ knownIds: [...new Set([...current, ...known])].slice(-500) });
  if (firstRun || !s.notify || !fresh.length) return;

  if (fresh.length > 3) {
    chrome.notifications.create(`multi|${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: `${fresh.length} ایمیل جدید`,
      message: fresh.slice(0, 3).map(({ e }) => `${e.from}: ${e.subject}`).join('\n'),
      priority: 1,
    });
    return;
  }
  for (const { a, e } of fresh) {
    chrome.notifications.create(`mail|${e.url}|${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon128.png',
      title: e.from || 'ایمیل جدید',
      message: e.subject,
      contextMessage: a.email,
      priority: 1,
    });
  }
}

chrome.notifications.onClicked.addListener((id) => {
  if (id === 'update') {
    chrome.tabs.create({ url: chrome.runtime.getURL('update.html') });
    chrome.notifications.clear(id);
    return;
  }
  const [kind, url] = id.split('|');
  openUrl(kind === 'mail' ? url : `${GMAIL}0/#inbox`);
  chrome.notifications.clear(id);
});

// ---------- باز کردن جیمیل (استفاده دوباره از تب باز همان حساب) ----------
async function openUrl(url) {
  const m = url.match(/\/mail\/u\/(\d+)\//);
  if (m) {
    const tabs = await chrome.tabs.query({ url: `https://mail.google.com/mail/u/${m[1]}/*` });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { url, active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  }
  chrome.tabs.create({ url });
}

// ---------- بروزرسانی سریع وقتی در تب جیمیل ایمیلی باز/خوانده می‌شود ----------
let tabTimer1, tabTimer2;
chrome.tabs.onUpdated.addListener((id, info) => {
  if (!info.url || !info.url.startsWith('https://mail.google.com/mail/')) return;
  clearTimeout(tabTimer1); clearTimeout(tabTimer2);
  tabTimer1 = setTimeout(check, 3000);   // جیمیل چند ثانیه بعد وضعیت را ثبت می‌کند
  tabTimer2 = setTimeout(check, 15000);  // فید Atom گاهی کمی دیرتر بروز می‌شود
});

// ---------- خوانده‌شده کردن ایمیل در خود جیمیل ----------
async function getIk(i, fresh) {
  const { iks = {} } = await chrome.storage.local.get('iks');
  if (iks[i] && !fresh) return iks[i];
  const r = await fetch(`${GMAIL}${i}/`, { credentials: 'include', cache: 'no-store' });
  const t = await r.text();
  const m = t.match(/GLOBALS=\[(?:(?:"[^"]*"|[^,\]]*),){9}"([0-9a-f]{6,})"/)
         || t.match(/["']?\bik["']?\s*[:=]\s*["']([0-9a-f]{6,})["']/);
  if (!m) return null;
  iks[i] = m[1];
  await chrome.storage.local.set({ iks });
  return m[1];
}

async function getAt(i) {
  const cs = await chrome.cookies.getAll({ url: `${GMAIL}${i}/`, name: 'GMAIL_AT' });
  return cs.length ? cs[0].value : null;
}

async function gmailAct(i, id, act, freshIk) {
  const ik = await getIk(i, freshIk);
  const at = await getAt(i);
  if (!ik || !at) return false;
  const u = `${GMAIL}${i}/?ui=2&ik=${ik}&at=${encodeURIComponent(at)}&view=up&act=${act}&rt=j&th=${id}`;
  try {
    const r = await fetch(u, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: `at=${encodeURIComponent(at)}` });
    return r.ok;
  } catch { return false; }
}

async function markRead(index, messageId, entryId) {
  // حذف فوری از لیست و شمارنده (تا کاربر منتظر نماند)
  const { state } = await chrome.storage.local.get('state');
  if (state && state.accounts) {
    for (const a of state.accounts) {
      if (a.index !== index) continue;
      const before = a.entries.length;
      a.entries = a.entries.filter((e) => e.id !== entryId);
      if (a.entries.length < before) a.fullcount = Math.max(0, a.fullcount - 1);
    }
    state.total = state.accounts.reduce((n, a) => n + a.fullcount, 0);
    await chrome.storage.local.set({ state });
    setBadge(state.total, state.status);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const stillUnread = async () => {
    await check();
    const { state: st } = await chrome.storage.local.get('state');
    return (st?.accounts || []).some((a) => a.index === index && a.entries.some((e) => e.id === entryId));
  };

  // روش ۱: درخواست مستقیم (سریع، ولی غیررسمی). اگر قبلاً جواب نداده، تا ۲۴ ساعت امتحان نمی‌شود.
  const { apiBrokenAt = 0 } = await chrome.storage.local.get('apiBrokenAt');
  if (Date.now() - apiBrokenAt > 86400000) {
    let ok = await gmailAct(index, messageId, 'rd', false);
    if (!ok) ok = await gmailAct(index, messageId, 'rd', true);
    if (ok) { await sleep(1500); if (!(await stillUnread())) return { ok: true, via: 'api' }; }
    await chrome.storage.local.set({ apiBrokenAt: Date.now() });
  }

  // روش ۲: باز کردن ایمیل در یک صفحه نامرئی داخل اکستنشن (بدون تب) — خود جیمیل آن را خوانده‌شده می‌کند
  return { ok: await markReadViaFrame(index, messageId, stillUnread), via: 'frame' };
}

// جیمیل اجازه نمایش در iframe نمی‌دهد؛ فقط برای فریم‌های نامرئی خود اکستنشن (tabId = -1) این محدودیت برداشته می‌شود
async function ensureFrameRules() {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [{
      id: 1,
      priority: 1,
      action: {
        type: 'modifyHeaders',
        responseHeaders: [
          { header: 'x-frame-options', operation: 'remove' },
          { header: 'content-security-policy', operation: 'remove' },
        ],
      },
      condition: { urlFilter: '||mail.google.com/', resourceTypes: ['sub_frame'], tabIds: [-1] },
    }],
  });
}

async function markReadViaFrame(index, messageId, stillUnread) {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    await ensureFrameRules();
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['IFRAME_SCRIPTING'],
        justification: 'باز کردن نامرئی ایمیل در جیمیل تا خوانده‌شده ثبت شود',
      });
    }
    await chrome.runtime.sendMessage({ target: 'offscreen', type: 'gframe', url: `${GMAIL}${index}/#inbox/${messageId}` });
  } catch (e) {
    console.warn('frame method failed to start', e);
    return false;
  }
  // اولین بار بارگذاری جیمیل چند ثانیه طول می‌کشد؛ دفعات بعد سریع است
  let done = false;
  for (let t = 0; t < 12 && !done; t++) {
    await sleep(2500);
    done = !(await stillUnread());
  }
  // صفحه نامرئی یک دقیقه بعد از آخرین استفاده بسته می‌شود تا حافظه آزاد شود
  chrome.alarms.create('closeFrame', { delayInMinutes: 1 });
  return done;
}

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'closeFrame') return;
  if (await chrome.offscreen.hasDocument()) chrome.offscreen.closeDocument().catch(() => {});
});

// ---------- پیام‌ها از پاپ‌آپ ----------
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === 'refresh') {
    check().then(() => chrome.storage.local.get('state')).then(({ state }) => reply(state));
    return true;
  }
  if (msg.type === 'markRead') {
    markRead(msg.index, msg.messageId, msg.id).then(reply);
    return true;
  }
  if (msg.type === 'open') {
    openUrl(msg.url).then(() => reply(true));
    return true;
  }
});
