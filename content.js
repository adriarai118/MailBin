// جیمیل‌بین — تشخیص فیلد کد تایید در صفحه و جاگذاری کد
(() => {
  if (window.__mailbinOtp) return;
  window.__mailbinOtp = true;

  const HINT = /otp|one.?time|verif|passcode|\bpin\b|code|token|2fa|mfa|totp|sms|security.?key|کد|رمز|تایید|تأیید|یکبار/i;
  const NOT = /zip|postal|post.?code|promo|coupon|gift|captcha|country|area|phone|mobile|email|search|discount|referral|invite|کدپستی|کد.?پستی|تخفیف|کد.?ملی|موبایل|تلفن|جستجو/i;
  const TYPES = new Set(['text', 'number', 'tel', 'password', '']);

  const visible = (el) => {
    if (el.disabled || el.readOnly) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return false;
    const st = getComputedStyle(el);
    return st.visibility !== 'hidden' && st.display !== 'none' && st.opacity !== '0';
  };

  const labelOf = (el) => {
    let t = '';
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l) t += l.textContent; }
    const p = el.closest('label'); if (p) t += ' ' + p.textContent;
    return t;
  };

  function isOtp(el) {
    if (!(el instanceof HTMLInputElement) || !TYPES.has(el.type)) return false;
    if (el.autocomplete === 'one-time-code') return true;
    const s = [el.name, el.id, el.placeholder, el.getAttribute('aria-label'), el.getAttribute('data-testid'), labelOf(el)].join(' ');
    if (NOT.test(s)) return false;
    if (el.type === 'password' && !/otp|code|pin|کد|totp|2fa/i.test(s)) return false;
    return HINT.test(s);
  }

  // جعبه‌های جداگانه (۴ تا ۸ فیلد تک‌رقمی کنار هم)
  function splitBoxes() {
    const singles = [...document.querySelectorAll('input')].filter((i) => TYPES.has(i.type) && i.maxLength === 1 && visible(i));
    if (singles.length < 4 || singles.length > 8) return null;
    // همه در یک والد مشترک نزدیک باشند
    const parent = singles[0].parentElement?.parentElement?.parentElement;
    return parent && singles.every((i) => parent.contains(i)) ? singles : null;
  }

  function findTarget() {
    const boxes = splitBoxes();
    if (boxes) return { boxes };
    const ins = [...document.querySelectorAll('input')].filter(visible);
    const el = ins.find((i) => i.autocomplete === 'one-time-code') || ins.find(isOtp);
    return el ? { el } : null;
  }

  // تنظیم مقدار طوری که React/Vue/Angular هم متوجه شوند
  function setValue(el, v) {
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(el, v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: v.slice(-1) }));
  }

  function fill(code) {
    const t = findTarget();
    if (!t) return false;
    if (t.boxes) {
      // اول امتحان «پیست» روی جعبه اول (بیشتر سایت‌ها پشتیبانی می‌کنند)
      try {
        const dt = new DataTransfer();
        dt.setData('text/plain', code);
        t.boxes[0].focus();
        t.boxes[0].dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
      } catch { /* */ }
      const joined = () => t.boxes.map((b) => b.value).join('');
      if (joined() !== code.slice(0, t.boxes.length)) {
        t.boxes.forEach((b, i) => { if (code[i] != null) setValue(b, code[i]); });
      }
      t.boxes[Math.min(code.length, t.boxes.length) - 1].focus();
    } else {
      setValue(t.el, code);
    }
    flash(t.boxes ? t.boxes : [t.el]);
    return true;
  }

  function flash(els) {
    for (const el of els) {
      const old = el.style.boxShadow;
      el.style.boxShadow = '0 0 0 3px rgba(24,128,56,.55)';
      setTimeout(() => { el.style.boxShadow = old; }, 1600);
    }
  }

  // اعلام به پس‌زمینه که این صفحه کد تایید می‌خواهد (برای بررسی سریع ایمیل)
  let lastSent = 0;
  function announce() {
    if (Date.now() - lastSent < 60e3) return;
    if (!findTarget()) return;
    lastSent = Date.now();
    try { chrome.runtime.sendMessage({ type: 'otpWanted', host: location.hostname }); } catch { /* اکستنشن reload شده */ }
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (el instanceof HTMLInputElement && (isOtp(el) || el.maxLength === 1)) announce();
  }, true);
  setTimeout(announce, 1200);
  setTimeout(announce, 5000);

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type !== 'fillOtp') return;
    if (fill(String(msg.code))) reply({ ok: true });
    // فریم‌هایی که فیلد ندارند جواب نمی‌دهند تا جواب فریم درست برسد
  });
})();
