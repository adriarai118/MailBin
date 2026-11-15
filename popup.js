const $ = (s) => document.querySelector(s);
const fa = (n) => Number(n).toLocaleString('fa-IR');
const rtf = new Intl.RelativeTimeFormat('fa', { numeric: 'auto' });
const GMAIL = 'https://mail.google.com/mail/u/';
const SHOW = 8; // تعداد ایمیل نمایش‌داده‌شده برای هر حساب پیش از «بیشتر»

function ago(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const sec = (d - Date.now()) / 1000;
  const abs = Math.abs(sec);
  if (abs < 60) return 'همین الان';
  if (abs < 3600) return rtf.format(Math.round(sec / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(sec / 3600), 'hour');
  if (abs < 86400 * 7) return rtf.format(Math.round(sec / 86400), 'day');
  return d.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' });
}

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k != null) n.append(k);
  return n;
}

function open(url) {
  chrome.runtime.sendMessage({ type: 'open', url });
  window.close();
}

function emptyState(big, small, btnText, btnUrl) {
  return el('div', { class: 'empty' },
    el('div', { class: 'big' }, big),
    el('div', {}, small),
    btnText ? el('button', { onclick: () => open(btnUrl) }, btnText) : null);
}

function render(state) {
  lastState = state;
  if (document.body.classList.contains('reading')) return;
  const list = $('#list');
  list.replaceChildren();
  const total = $('#total');

  if (!state) {
    list.append(emptyState('در حال بررسی…', 'چند لحظه صبر کنید'));
    return;
  }

  if (state.status === 'loggedout') {
    total.hidden = true;
    list.append(emptyState('وارد جیمیل نشده‌اید', 'در همین مرورگر وارد حساب گوگل شوید؛ جیمیل‌بین خودکار ایمیل‌ها را نشان می‌دهد.', 'ورود به جیمیل', 'https://mail.google.com/'));
  } else if (state.status === 'offline' && !state.accounts?.length) {
    total.hidden = true;
    list.append(emptyState('اتصال برقرار نیست', 'اینترنت یا دسترسی به جیمیل را بررسی کنید.'));
  } else {
    const accts = state.accounts || [];
    total.hidden = !state.total;
    total.textContent = fa(state.total || 0);

    if (accts.every((a) => !a.entries.length)) {
      list.append(emptyState('صندوق تمیز است ✓', 'ایمیل خوانده‌نشده‌ای ندارید.'));
      if (accts.length < 2) { footer(state); return; }
    }

    for (const a of accts) {
      list.append(el('div', { class: 'acct' },
        el('span', { class: 'addr', title: 'باز کردن این حساب', onclick: () => open(`${GMAIL}${a.index}/#inbox`) }, a.email),
        el('span', { class: 'count' }, a.fullcount ? `${fa(a.fullcount)} خوانده‌نشده` : '')));

      if (!a.entries.length) {
        if (accts.length > 1) list.append(el('div', { class: 'acct-empty' }, 'ایمیل جدیدی نیست'));
        continue;
      }

      const box = el('div');
      const draw = (n) => {
        box.replaceChildren();
        a.entries.slice(0, n).forEach((m) => box.append(mailRow(m)));
        const rest = a.entries.length - n;
        if (rest > 0) box.append(el('button', { class: 'more', onclick: () => draw(a.entries.length) }, `نمایش ${fa(rest)} ایمیل دیگر`));
        else if (a.fullcount > a.entries.length) box.append(el('button', { class: 'more', onclick: () => open(`${GMAIL}${a.index}/#search/is%3Aunread+in%3Ainbox`) }, 'همه خوانده‌نشده‌ها در جیمیل'));
      };
      draw(SHOW);
      list.append(box);
    }
  }
  footer(state);
}

function mailRow(m) {
  const row = el('div', { class: 'mail', role: 'button', tabindex: '0', title: m.fromEmail || '', onclick: () => showMail(m),
    onkeydown: (e) => { if (e.key === 'Enter') showMail(m); } },
    el('div', { class: 'top' },
      el('span', { class: 'from', dir: 'auto' }, m.from),
      el('span', { class: 'time' }, ago(m.issued)),
      el('button', { class: 'mk', title: 'علامت خوانده‌شده', onclick: async (e) => {
        e.stopPropagation();
        row.classList.add('gone');
        await markRead(m);
        row.remove();
      } }, svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'))),
    el('div', { class: 'subj', dir: 'auto' }, m.subject),
    m.summary ? el('div', { class: 'snip', dir: 'auto' }, m.summary) : null);
  return row;
}

// ---------- نمایش ایمیل داخل پاپ‌آپ ----------
let lastState = null;
const docCache = new Map();

function markRead(m) {
  return chrome.runtime.sendMessage({ type: 'markRead', index: acctIndex(m), messageId: m.messageId, id: m.id });
}

function acctIndex(m) { return Number((m.url.match(/\/mail\/u\/(\d+)\//) || [0, 0])[1]); }

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

async function fetchPrint(i, id, ik) {
  const u = `${GMAIL}${i}/?${ik ? `ik=${ik}&` : ''}view=pt&search=all&th=${id}`;
  const r = await fetch(u, { credentials: 'include', cache: 'no-store' });
  if (!r.ok || !r.url.startsWith('https://mail.google.com/')) return null;
  const html = await r.text();
  if (!/class=["']?(message|maincontent)/i.test(html)) return null;
  return new DOMParser().parseFromString(html, 'text/html');
}

async function loadMail(m) {
  if (docCache.has(m.id)) return docCache.get(m.id);
  const i = acctIndex(m);
  const { iks = {} } = await chrome.storage.local.get('iks');
  let doc = await fetchPrint(i, m.messageId, iks[i]);
  if (!doc && iks[i]) doc = await fetchPrint(i, m.messageId, null);
  if (!doc) { const ik = await getIk(i, true); if (ik) doc = await fetchPrint(i, m.messageId, ik); }
  if (!doc) return null;

  // پیوست‌ها: لینک‌هایی که attid دارند
  const atts = [];
  const seenAtt = new Set();
  doc.querySelectorAll('a[href*="attid="]').forEach((a) => {
    let u;
    try { u = new URL(a.getAttribute('href'), `${GMAIL}${i}/`); } catch { return; }
    const attid = u.searchParams.get('attid');
    if (!attid || seenAtt.has(attid)) return;
    seenAtt.add(attid);
    u.searchParams.set('disp', 'safe');
    // متن گره‌ها با فاصله جدا شود (<br> در textContent فاصله نمی‌گذارد)
    const host = a.closest('td, div, p') || a;
    const tw = doc.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const parts = []; while (tw.nextNode()) parts.push(tw.currentNode.nodeValue);
    const near = parts.join(' ');
    const nm = (a.textContent.match(/[^\s\/\\]+\.[a-z0-9]{2,5}\b/i) || near.match(/[^\s\/\\]+\.[a-z0-9]{2,5}\b/i) || [''])[0];
    atts.push({ url: u.href, name: nm, attid });
  });

  // پاک‌سازی: اسکریپت‌ها و سربرگ (لوگو، نام حساب، موضوع تکراری) حذف شوند
  doc.querySelectorAll('script, noscript, iframe, object, embed').forEach((n) => n.remove());
  doc.querySelectorAll('[onload],[onclick],[onerror]').forEach((n) => { n.removeAttribute('onload'); n.removeAttribute('onclick'); n.removeAttribute('onerror'); });
  const logo = doc.querySelector('img[src*="logo"]');
  const logoTable = logo && logo.closest('table');
  if (logoTable) { const hr = logoTable.nextElementSibling; if (hr && hr.tagName === 'HR') hr.remove(); logoTable.remove(); }
  const main = doc.querySelector('.maincontent');
  const first = main && main.firstElementChild;
  if (first && first.tagName === 'TABLE' && !first.classList.contains('message')) {
    const hr = first.nextElementSibling; if (hr && hr.tagName === 'HR') hr.remove(); first.remove();
  }

  const head = doc.head || doc.documentElement.insertBefore(doc.createElement('head'), doc.body);
  head.insertAdjacentHTML('afterbegin', `<meta charset="utf-8"><base href="${GMAIL}${i}/" target="_blank">`);
  head.insertAdjacentHTML('beforeend', `<style>
    body{margin:0;padding:12px 14px;font:13px/1.7 Vazirmatn,"Segoe UI",Tahoma,sans-serif;color:#1f2328;background:#fff;word-wrap:break-word}
    img{max-width:100%;height:auto} table{max-width:100%} pre{white-space:pre-wrap}
    a{color:#1a73e8} hr{border:0;border-top:1px solid #e3e6ea;margin:12px 0}
  </style>`);
  doc.body.setAttribute('dir', 'auto');
  const html = '<!doctype html>' + doc.documentElement.outerHTML;
  const out = { html, atts };
  docCache.set(m.id, out);
  return out;
}

// ---------- پیوست‌ها ----------
function decodeWord(str) {
  // =?UTF-8?B?...?= یا =?UTF-8?Q?...?=
  return str.replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (m, cs, enc, txt) => {
    try {
      const bytes = enc.toUpperCase() === 'B'
        ? Uint8Array.from(atob(txt), (c) => c.charCodeAt(0))
        : Uint8Array.from(txt.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (x, h) => String.fromCharCode(parseInt(h, 16))), (c) => c.charCodeAt(0));
      return new TextDecoder(cs).decode(bytes);
    } catch { return m; }
  });
}

function nameFromDisposition(cd) {
  if (!cd) return '';
  let m = cd.match(/filename\*\s*=\s*([^']*)''([^;]+)/i);
  if (m) { try { return decodeURIComponent(m[2].trim().replace(/^"|"$/g, '')); } catch {} }
  m = cd.match(/filename\s*=\s*"([^"]*)"/i) || cd.match(/filename\s*=\s*([^;]+)/i);
  if (!m) return '';
  let n = decodeWord(m[1].trim());
  // نام UTF-8 که به‌صورت latin1 خوانده شده
  if (/[\u00c0-\u00ff]/.test(n)) { try { n = new TextDecoder().decode(Uint8Array.from(n, (c) => c.charCodeAt(0))); } catch {} }
  return n;
}

// اگر در نسخه چاپی لینکی نبود، پیوست‌ها را با attid=0.1, 0.2, … پیدا کن (فقط هدر خوانده می‌شود)
async function probeAtts(m) {
  const i = acctIndex(m);
  const { iks = {} } = await chrome.storage.local.get('iks');
  const ik = iks[i] || (await getIk(i));
  if (!ik) return [];
  const out = [];
  for (let n = 1; n <= 12; n++) {
    const url = `${GMAIL}${i}/?ui=2&ik=${ik}&view=att&th=${m.messageId}&attid=0.${n}&disp=safe&zw`;
    const ctl = new AbortController();
    try {
      const r = await fetch(url, { credentials: 'include', signal: ctl.signal });
      const cd = r.headers.get('content-disposition');
      const ct = r.headers.get('content-type') || '';
      ctl.abort();
      if (!r.ok || (!cd && /text\/html/i.test(ct))) break;
      out.push({ url, name: nameFromDisposition(cd) || `پیوست ${n}`, size: Number(r.headers.get('content-length')) || 0, type: ct });
    } catch { break; }
  }
  return out;
}

function fmtSize(b) {
  if (!b) return '';
  if (b < 1024) return `${fa(b)} بایت`;
  if (b < 1048576) return `${fa(Math.round(b / 1024))} KB`;
  return `${(b / 1048576).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} MB`;
}

function kindOf(name, type) {
  const n = (name || '').toLowerCase();
  if (/pdf/.test(type) || n.endsWith('.pdf')) return 'pdf';
  if (/^image\//.test(type) || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return 'img';
  return 'file';
}

const blobCache = new Map();
async function fetchAtt(att) {
  if (blobCache.has(att.url)) return blobCache.get(att.url);
  const r = await fetch(att.url, { credentials: 'include' });
  if (!r.ok) throw new Error(r.status);
  const ct = r.headers.get('content-type') || '';
  const name = nameFromDisposition(r.headers.get('content-disposition')) || att.name || 'attachment';
  const kind = kindOf(name, ct);
  const buf = await r.arrayBuffer();
  const mime = kind === 'pdf' ? 'application/pdf' : kind === 'img' ? (ct.startsWith('image/') ? ct.split(';')[0] : 'image/png') : (ct.split(';')[0] || 'application/octet-stream');
  const res = { name, kind, size: buf.byteLength, url: URL.createObjectURL(new Blob([buf], { type: mime })) };
  blobCache.set(att.url, res);
  return res;
}

function download(blobUrl, name) {
  const a = el('a', { href: blobUrl, download: name || 'attachment' });
  document.body.append(a); a.click(); a.remove();
}

const ICONS = {
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14h6M9 17h4"/>',
  img: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 17l-5-5-9 8"/>',
  file: '<path d="M21 11.5l-8.5 8.5a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3L15 7.5"/>',
};

function renderAtts(box, atts, m, bodyBox, mailFrame) {
  box.replaceChildren();
  if (!atts.length) { box.hidden = true; return; }
  box.hidden = false;
  for (const att of atts) {
    const kind = kindOf(att.name, att.type);
    const chip = el('button', { class: `att ${kind}`, title: att.name },
      svg(ICONS[kind]),
      el('span', { class: 'aname', dir: 'ltr' }, att.name || 'پیوست'),
      att.size ? el('span', { class: 'asize' }, fmtSize(att.size)) : null);
    chip.addEventListener('click', () => openAtt(att, chip, bodyBox, mailFrame));
    box.append(chip);
  }
}

async function openAtt(att, chip, bodyBox, mailFrame) {
  chip.classList.add('busy');
  let f;
  try { f = await fetchAtt(att); } catch (e) {
    chip.classList.remove('busy'); chip.classList.add('err'); chip.title = 'دریافت پیوست ناموفق بود';
    return;
  }
  chip.classList.remove('busy');
  document.querySelectorAll('.att.on').forEach((c) => c.classList.remove('on'));
  if (f.kind === 'file') { download(f.url, f.name); return; }
  chip.classList.add('on');

  const viewer = f.kind === 'pdf'
    ? el('iframe', { class: 'pdfview', src: f.url + '#view=FitH' })
    : el('div', { class: 'imgview' }, el('img', { src: f.url, alt: f.name }));
  const bar = el('div', { class: 'vbar' },
    el('button', { onclick: () => { document.querySelectorAll('.att.on').forEach((c) => c.classList.remove('on')); bodyBox.replaceChildren(mailFrame); } }, '→ متن ایمیل'),
    el('span', { class: 'vname', dir: 'ltr' }, f.name),
    el('button', { title: 'نمایش در تب جدید', onclick: () => {
      chrome.tabs.create({ url: chrome.runtime.getURL(`viewer.html?u=${encodeURIComponent(att.url)}&n=${encodeURIComponent(f.name)}`) });
    } }, 'تب جدید'),
    el('button', { onclick: () => download(f.url, f.name) }, 'دانلود'));
  bodyBox.replaceChildren(el('div', { class: 'vwrap' }, bar, viewer));
}

async function showMail(m) {
  document.body.classList.add('reading');
  const list = $('#list');
  const bodyBox = el('div', { class: 'rbody' }, el('div', { class: 'loading' }, 'در حال بارگذاری ایمیل…'));
  list.replaceChildren(el('div', { class: 'reader' },
    el('div', { class: 'rhead' },
      el('button', { class: 'icon', title: 'بازگشت', onclick: back },
        svg('<path d="M9 6l6 6-6 6"/>')),
      el('div', { class: 'rsubj', dir: 'auto' }, m.subject),
      el('button', { class: 'icon', title: 'باز کردن در جیمیل', onclick: () => open(m.url) },
        svg('<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'))),
    el('div', { class: 'rmeta' },
      el('span', { class: 'from', dir: 'auto' }, m.from),
      m.fromEmail ? el('span', { class: 'addr' }, m.fromEmail) : null,
      el('span', { class: 'time' }, ago(m.issued)),
      el('span', { class: 'rstat', id: 'rstat' })),
    el('div', { class: 'atts', id: 'atts', hidden: '' }),
    bodyBox));

  let res = null;
  try { res = await loadMail(m); } catch (e) { /* شبکه */ }
  if (!document.body.classList.contains('reading')) return;
  if (res) {
    const f = el('iframe', { sandbox: 'allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer' });
    f.srcdoc = res.html;
    bodyBox.replaceChildren(f);
    const attBox = $('#atts');
    (async () => {
      let atts = res.atts;
      if (!atts.length && !res.probed) { res.atts = atts = await probeAtts(m).catch(() => []); res.probed = true; }
      if (attBox.isConnected) renderAtts(attBox, atts, m, bodyBox, f);
    })();
  } else {
    bodyBox.replaceChildren(el('div', { class: 'fallback' },
      el('div', { class: 'note' }, 'متن کامل ایمیل دریافت نشد؛ پیش‌نمایش کوتاه:'),
      el('div', { class: 'snipfull', dir: 'auto' }, m.summary || '—'),
      el('button', { onclick: () => open(m.url) }, 'باز کردن در جیمیل')));
  }

  // «خوانده‌شده» در خود اکستنشن
  const { settings } = await chrome.storage.sync.get('settings');
  if (!settings || settings.markOnOpen !== false) {
    await markRead(m);
    const st = $('#rstat');
    if (!st) return;
    const undo = el('a', { href: '#', class: 'diaglink', onclick: async (e) => {
      e.preventDefault();
      await chrome.runtime.sendMessage({ type: 'markUnread', id: m.id });
      st.replaceChildren('برگشت به خوانده‌نشده');
    } }, 'بازگردانی');
    st.replaceChildren('✓ خوانده شد — ', undo);
  }
}

function svg(inner) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.innerHTML = inner;
  return s;
}

function back() {
  document.body.classList.remove('reading');
  render(lastState);
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('reading')) { e.preventDefault(); back(); } });

function footer(state) {
  const t = state?.updated ? new Date(state.updated).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' }) : '';
  $('#updated').textContent = (state?.status === 'offline' ? 'آفلاین — ' : '') + (t ? `آخرین بررسی: ${t}` : '');
}

async function refresh() {
  const b = $('#refresh');
  b.classList.add('spin');
  const state = await chrome.runtime.sendMessage({ type: 'refresh' });
  b.classList.remove('spin');
  render(state);
}

$('#refresh').addEventListener('click', refresh);
$('#gmail').addEventListener('click', () => open(`${GMAIL}0/#inbox`));
$('#compose').addEventListener('click', async () => {
  const { state } = await chrome.storage.local.get('state');
  const i = state?.accounts?.[0]?.index ?? 0;
  open(`${GMAIL}${i}/#inbox?compose=new`);
});
$('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());

chrome.storage.local.get('state').then(({ state }) => {
  render(state);
  refresh();
});

// نوار «نسخه جدید»
chrome.storage.local.get('update').then(({ update }) => {
  if (!update || !update.has || update.latest === chrome.runtime.getManifest().version) return;
  const b = $('#updbar');
  b.textContent = `نسخه جدید ${update.latest} آماده است — آپدیت`;
  b.hidden = false;
  b.onclick = () => { chrome.tabs.create({ url: chrome.runtime.getURL('update.html') }); window.close(); };
});
