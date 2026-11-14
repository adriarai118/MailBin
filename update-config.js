// تنظیمات آپدیت از GitHub (بین background و صفحه آپدیت مشترک است)
const UPD_DEFAULT_REPO = 'adriarai118/mailbin';
const UPD_BRANCH = 'main';

async function updRepo() {
  const { updRepo } = await chrome.storage.sync.get('updRepo');
  return (updRepo || UPD_DEFAULT_REPO).trim();
}
function rawUrl(repo, path) {
  return `https://raw.githubusercontent.com/${repo}/${UPD_BRANCH}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}
async function checkUpdate() {
  const repo = await updRepo();
  const r = await fetch(rawUrl(repo, 'manifest.json') + `?t=${Date.now()}`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  const latest = (await r.json()).version;
  const current = chrome.runtime.getManifest().version;
  const info = { latest, current, has: cmpVer(latest, current) > 0, checked: Date.now(), repo };
  await chrome.storage.local.set({ update: info });
  return info;
}
