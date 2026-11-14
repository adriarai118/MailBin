const $ = (s) => document.querySelector(s);
const log = (t, cls) => {
  $('#logCard').hidden = false;
  const d = document.createElement('div');
  if (cls) d.className = cls;
  d.dir = 'auto';
  d.textContent = t;
  $('#log').append(d);
  $('#log').scrollTop = 1e9;
};

// ---------- نگهداری دسترسی پوشه در IndexedDB ----------
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('mailbin-update', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function kvGet(k) {
  const db = await idb();
  return new Promise((res) => { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(null); });
}
async function kvSet(k, v) {
  const db = await idb();
  return new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; });
}

async function readLocalManifest(dir) {
  try {
    const f = await (await dir.getFileHandle('manifest.json')).getFile();
    return JSON.parse(await f.text());
  } catch { return null; }
}

async function pickFolder() {
  const dir = await window.showDirectoryPicker({ id: 'mailbin', mode: 'readwrite' });
  const m = await readLocalManifest(dir);
  if (!m || m.short_name !== chrome.runtime.getManifest().short_name) {
    alert('این پوشه، پوشه اکستنشن جیمیل‌بین نیست. پوشه‌ای را انتخاب کنید که manifest.json داخلش است.');
    return null;
  }
  await kvSet('dir', dir);
  showFolder(dir);
  return dir;
}

function showFolder(dir) { $('#folder').textContent = dir ? dir.name : 'انتخاب نشده'; }

async function getDir() {
  let dir = await kvGet('dir');
  if (!dir) dir = await pickFolder();
  if (!dir) return null;
  // دسترسی نوشتن (نیاز به کلیک کاربر دارد؛ این تابع فقط بعد از کلیک صدا زده می‌شود)
  let p = await dir.queryPermission({ mode: 'readwrite' });
  if (p !== 'granted') p = await dir.requestPermission({ mode: 'readwrite' });
  if (p !== 'granted') { log('دسترسی به پوشه داده نشد', 'bad'); return null; }
  const m = await readLocalManifest(dir);
  if (!m || m.short_name !== chrome.runtime.getManifest().short_name) {
    log('پوشه ذخیره‌شده معتبر نیست؛ دوباره انتخاب کنید', 'bad');
    return pickFolder();
  }
  return dir;
}

async function writeFile(root, path, data) {
  const parts = path.split('/');
  let dir = root;
  for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p, { create: true });
  const fh = await dir.getFileHandle(parts.at(-1), { create: true });
  const w = await fh.createWritable();
  await w.write(data);
  await w.close();
}

const SKIP = /^(\.git|\.github\/|README|LICENSE|\.gitignore)/i;

async function doUpdate() {
  $('#updBtn').disabled = true;
  try {
    const dir = await getDir();
    if (!dir) return;
    const repo = await updRepo();
    log(`دریافت فهرست فایل‌ها از ${repo} …`);
    const r = await fetch(`https://api.github.com/repos/${repo}/git/trees/${UPD_BRANCH}?recursive=1`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    const tree = await r.json();
    const files = tree.tree.filter((t) => t.type === 'blob' && !SKIP.test(t.path));
    if (!files.some((f) => f.path === 'manifest.json')) throw new Error('manifest.json در ریشه ریپازیتوری نیست');

    // اول همه فایل‌ها دانلود شوند، بعد نوشته شوند (تا آپدیت نیمه‌کاره نماند)
    const data = [];
    for (const f of files) {
      const res = await fetch(rawUrl(repo, f.path) + `?t=${Date.now()}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${f.path}: ${res.status}`);
      data.push([f.path, await res.arrayBuffer()]);
      log(`↓ ${f.path}`);
    }
    // manifest.json آخر نوشته شود
    data.sort((a, b) => (a[0] === 'manifest.json') - (b[0] === 'manifest.json'));
    for (const [path, buf] of data) await writeFile(dir, path, buf);
    log(`✓ ${data.length} فایل نوشته شد`, 'ok');

    log('بارگذاری دوباره اکستنشن…', 'ok');
    $('#status').textContent = 'آپدیت انجام شد. اکستنشن دوباره بارگذاری می‌شود (این صفحه بسته می‌شود).';
    $('#status').className = 'ok';
    await chrome.storage.local.set({ update: null });
    setTimeout(() => chrome.runtime.reload(), 1500);
  } catch (e) {
    log('خطا: ' + e.message, 'bad');
    $('#updBtn').disabled = false;
  }
}

async function refresh() {
  $('#status').textContent = 'در حال بررسی…';
  $('#status').className = 'muted';
  try {
    const info = await checkUpdate();
    $('#latest').textContent = info.latest;
    $('#updBtn').disabled = false;
    $('#updBtn').textContent = info.has ? `آپدیت به نسخه ${info.latest}` : 'نصب دوباره همین نسخه';
    $('#status').textContent = info.has ? 'نسخه جدید آماده است.' : 'نسخه شما به‌روز است.';
    $('#status').className = info.has ? 'bad' : 'ok';
  } catch (e) {
    $('#status').textContent = 'بررسی ناموفق بود: ' + e.message;
    $('#status').className = 'bad';
  }
}

$('#cur').textContent = chrome.runtime.getManifest().version;
$('#checkBtn').onclick = refresh;
$('#updBtn').onclick = doUpdate;
$('#pickBtn').onclick = () => pickFolder().catch(() => {});
updRepo().then((r) => { $('#repo').value = r; });
$('#repo').addEventListener('change', async () => {
  await chrome.storage.sync.set({ updRepo: $('#repo').value.trim() });
  refresh();
});
kvGet('dir').then(showFolder);
refresh();
