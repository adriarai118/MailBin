// نمایش پیوست در تب کامل: فایل با همان ورود کروم از جیمیل گرفته می‌شود
(async () => {
  const q = new URLSearchParams(location.search);
  const url = q.get('u');
  const name = q.get('n') || 'attachment';
  const msg = document.getElementById('msg');
  document.title = name;
  if (!url || !/^https:\/\/mail\.google\.com\//.test(url)) { msg.textContent = 'آدرس پیوست نامعتبر است'; return; }
  try {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error(r.status);
    const ct = (r.headers.get('content-type') || '').split(';')[0];
    const buf = await r.arrayBuffer();
    const isPdf = /pdf/.test(ct) || /\.pdf$/i.test(name);
    const isImg = ct.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
    const blobUrl = URL.createObjectURL(new Blob([buf], { type: isPdf ? 'application/pdf' : ct || 'application/octet-stream' }));
    msg.remove();
    if (isImg) {
      const d = document.createElement('div'); d.className = 'img';
      const im = document.createElement('img'); im.src = blobUrl; im.alt = name;
      d.append(im); document.body.append(d);
    } else if (isPdf) {
      const f = document.createElement('iframe'); f.src = blobUrl; document.body.append(f);
    } else {
      const a = document.createElement('a'); a.href = blobUrl; a.download = name; a.click();
      document.body.append(Object.assign(document.createElement('div'), { id: 'msg', textContent: 'فایل دانلود شد.' }));
    }
  } catch (e) {
    msg.textContent = 'دریافت پیوست ناموفق بود (' + e.message + ')';
  }
})();
