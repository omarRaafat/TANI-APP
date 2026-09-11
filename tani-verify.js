/* ═══════════════════════════════════════════════════════════
   تاني — طبقة التحقق البشري (Human Verification)
   بتتحمّل في الصفحات قبل السكربت الأساسي.

   بتشتغل على وضعين:
     turnstile → لو حطيت مفتاح Cloudflare Turnstile تحت
     local     → تحدي بسيط في المتصفح (رجوع تلقائي)

   الاستخدام:
     TaniVerify.require('publish').then(function(ok){ ... })
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── ١) الإعدادات ──────────────────────────────────────── */
  var CONFIG = {
    /* مفتاح الموقع من Cloudflare Turnstile — مجاني وبيشتغل في مصر.
       من dash.cloudflare.com → Turnstile → Add site
       سيبه زي ما هو وهيشتغل بالتحدي المحلي. */
    turnstileSiteKey: (global.TANI_CONFIG && global.TANI_CONFIG.turnstileSiteKey)
                      || 'YOUR-TURNSTILE-SITE-KEY',

    /* كل عملية ناجحة بتفضل موثّقة كام دقيقة قبل ما نسأل تاني */
    trustMinutes: {
      publish: 30,
      order:   30,
      otp:     10
    },

    /* بعد كام محاولة على نفس العملية نطلب تحقق تاني فوراً */
    attemptsBeforeRecheck: 3
  };

  var TURNSTILE_ON = CONFIG.turnstileSiteKey.indexOf('YOUR-TURNSTILE') === -1;
  var TS_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  /* ── ٢) حالة الثقة ─────────────────────────────────────── */
  var KEY = 'tani.verify.v1';

  function loadState() {
    try {
      var raw = global.localStorage.getItem(KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) { return {}; }
  }
  function saveState(s) {
    try { global.localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }

  /* بيرجّع true لو العملية دي لسه موثّقة ومحاولاتها ما خلصتش */
  function stillTrusted(action) {
    var s = loadState()[action];
    if (!s) return false;
    var mins = CONFIG.trustMinutes[action] || 15;
    if (Date.now() - s.at > mins * 60000) return false;
    if ((s.uses || 0) >= CONFIG.attemptsBeforeRecheck) return false;
    return true;
  }

  function markTrusted(action, token) {
    var all = loadState();
    /* uses=1 لإن التحقق ده نفسه بيتصرف على عملية واحدة */
    all[action] = { at: Date.now(), uses: 1, token: token || null };
    saveState(all);
  }

  function countUse(action) {
    var all = loadState();
    if (all[action]) { all[action].uses = (all[action].uses || 0) + 1; saveState(all); }
  }

  /* ── ٣) تحميل سكربت Turnstile عند الحاجة ───────────────── */
  var tsLoading = null;
  function loadTurnstile() {
    if (global.turnstile) return Promise.resolve(global.turnstile);
    if (tsLoading) return tsLoading;
    tsLoading = new Promise(function (resolve, reject) {
      var t = setTimeout(function () { reject(new Error('turnstile-timeout')); }, 8000);
      var el = document.createElement('script');
      el.src = TS_SRC; el.async = true; el.defer = true;
      el.onload = function () { clearTimeout(t); resolve(global.turnstile); };
      el.onerror = function () { clearTimeout(t); reject(new Error('turnstile-failed')); };
      document.head.appendChild(el);
    });
    return tsLoading;
  }

  /* ── ٤) التحدي المحلي — أرقام عربية ────────────────────── */
  var AR = ['٠','١','٢','٣','٤','٥','٦','٧','٨','٩'];
  function toAr(n) {
    return String(n).replace(/\d/g, function (d) { return AR[+d]; });
  }
  /* بيحوّل أي أرقام عربية أو إنجليزية لرقم */
  function parseNum(v) {
    var s = String(v).trim().replace(/[٠-٩]/g, function (d) {
      return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));
    });
    return /^-?\d+$/.test(s) ? parseInt(s, 10) : NaN;
  }

  function makeChallenge() {
    var kind = Math.random() < 0.5 ? 'add' : 'pick';
    if (kind === 'add') {
      var a = 2 + Math.floor(Math.random() * 8);
      var b = 2 + Math.floor(Math.random() * 8);
      return {
        kind: 'add',
        q: 'كام يساوي ' + toAr(a) + ' + ' + toAr(b) + ' ؟',
        check: function (v) { return parseNum(v) === a + b; }
      };
    }
    /* اختار الأكبر — سهل على الإنسان، مش مباشر للبوت البدائي */
    var x = 3 + Math.floor(Math.random() * 30);
    var y = 3 + Math.floor(Math.random() * 30);
    while (y === x) { y = 3 + Math.floor(Math.random() * 30); }
    return {
      kind: 'pick',
      q: 'اكتب الرقم الأكبر: ' + toAr(x) + ' ولا ' + toAr(y) + ' ؟',
      check: function (v) { return parseNum(v) === Math.max(x, y); }
    };
  }

  /* ── ٥) واجهة النافذة ──────────────────────────────────── */
  var CSS = [
    '.tv-ovl{position:fixed;inset:0;background:rgba(6,26,21,.72);z-index:400;display:none;',
      'align-items:center;justify-content:center;padding:1rem}',
    '.tv-ovl.on{display:flex}',
    '.tv-box{background:#fff;border-radius:14px;max-width:400px;width:100%;padding:1.75rem;',
      'box-shadow:0 20px 50px -20px rgba(6,26,21,.6);position:relative;',
      "font-family:'Tajawal',system-ui,sans-serif;text-align:start}",
    '.tv-box h3{font-family:\'Changa\',sans-serif;font-size:1.05rem;margin:0 0 .4rem;color:#12171A}',
    '.tv-box p{font-size:.85rem;color:#4B5159;line-height:1.7;margin:0 0 1.25rem}',
    '.tv-x{position:absolute;top:.75rem;inset-inline-end:.75rem;width:30px;height:30px;border:1px solid #E6E2D9;',
      'background:#fff;border-radius:999px;cursor:pointer;display:grid;place-items:center;font-size:1rem;',
      'color:#4B5159;line-height:1;padding:0}',
    '.tv-x:hover{border-color:#BE4420;color:#BE4420}',
    '.tv-q{background:#FBFAF7;border:1px solid #E6E2D9;border-radius:8px;padding:.9rem 1rem;margin-bottom:.75rem}',
    '.tv-q b{display:block;font-size:1rem;color:#12171A;font-weight:500;margin-bottom:.6rem}',
    '.tv-in{width:100%;border:1px solid #D3CDC0;border-radius:6px;padding:.6rem .75rem;font-size:1.05rem;',
      "font-family:'Changa',sans-serif;text-align:center;letter-spacing:.1em;outline:0;background:#fff}",
    '.tv-in:focus{border-color:#155044;box-shadow:0 0 0 3px rgba(217,84,43,.18)}',
    '.tv-err{display:none;background:#FDEFE9;border:1px solid #EBC4B8;color:#9C3517;border-radius:6px;',
      'padding:.6rem .75rem;font-size:.8rem;margin-bottom:.75rem;line-height:1.6}',
    '.tv-err.on{display:block}',
    '.tv-go{width:100%;background:linear-gradient(135deg,#E0602F 0%,#C8461F 100%);color:#fff;border:0;',
      'border-radius:6px;padding:.7rem 1rem;font-size:.9rem;font-weight:500;cursor:pointer;',
      "font-family:'Tajawal',system-ui,sans-serif}",
    '.tv-go:disabled{opacity:.55;cursor:default}',
    '.tv-ts{min-height:65px;display:grid;place-items:center;margin-bottom:.75rem}',
    '.tv-note{font-size:.7rem;color:#7F868F;margin-top:.85rem;line-height:1.6;text-align:center}'
  ].join('');

  var styled = false;
  function injectCSS() {
    if (styled) return;
    styled = true;
    var s = document.createElement('style');
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  var REASONS = {
    publish: 'قبل ما ننشر إعلانك، بنتأكد إنك مش روبوت — ده بيحمي السوق من الإعلانات الوهمية.',
    order:   'قبل ما نسجّل طلبك، بنتأكد إنك مش روبوت — ده بيحمي الباعة من الطلبات الوهمية.',
    otp:     'قبل ما نبعت الكود، بنتأكد إنك مش روبوت — ده بيمنع استنزاف الرسايل.'
  };

  var ovl, box, current = null;

  function buildUI() {
    injectCSS();
    if (ovl) return;
    ovl = document.createElement('div');
    ovl.className = 'tv-ovl';
    ovl.setAttribute('role', 'dialog');
    ovl.setAttribute('aria-modal', 'true');
    ovl.innerHTML =
      '<div class="tv-box">' +
        '<button class="tv-x" type="button" aria-label="إغلاق">&#10005;</button>' +
        '<h3>تأكيد إنك إنسان</h3>' +
        '<p class="tv-why"></p>' +
        '<div class="tv-slot"></div>' +
        '<div class="tv-err" role="alert"></div>' +
        '<button class="tv-go" type="button">تأكيد</button>' +
        '<div class="tv-note"></div>' +
      '</div>';
    document.body.appendChild(ovl);
    box = ovl.querySelector('.tv-box');

    ovl.querySelector('.tv-x').addEventListener('click', function () { finish(false); });
    ovl.addEventListener('click', function (e) { if (e.target === ovl) finish(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ovl.classList.contains('on')) finish(false);
    });
  }

  function showErr(msg) {
    var e = ovl.querySelector('.tv-err');
    e.textContent = msg;
    e.classList.add('on');
  }
  function clearErr() { ovl.querySelector('.tv-err').classList.remove('on'); }

  function finish(ok, token) {
    if (!current) return;
    var c = current; current = null;
    ovl.classList.remove('on');
    document.body.style.overflow = '';
    if (ok) markTrusted(c.action, token);
    c.resolve(!!ok);
  }

  /* ── ٦) الواجهة العامة ─────────────────────────────────── */
  var API = {
    mode: TURNSTILE_ON ? 'turnstile' : 'local',

    /* بيرجّع Promise<boolean> — true يعني عدّى */
    require: function (action) {
      action = action || 'publish';

      if (stillTrusted(action)) {
        countUse(action);
        return Promise.resolve(true);
      }

      buildUI();
      return new Promise(function (resolve) {
        current = { action: action, resolve: resolve };

        ovl.querySelector('.tv-why').textContent = REASONS[action] || REASONS.publish;
        clearErr();
        var slot = ovl.querySelector('.tv-slot');
        slot.innerHTML = '';
        var go = ovl.querySelector('.tv-go');
        var note = ovl.querySelector('.tv-note');

        ovl.classList.add('on');
        document.body.style.overflow = 'hidden';

        if (TURNSTILE_ON) {
          note.textContent = 'محمي بواسطة Cloudflare Turnstile';
          slot.innerHTML = '<div class="tv-ts"></div>';
          go.disabled = true;
          go.textContent = 'بنتأكد...';

          loadTurnstile().then(function (ts) {
            ts.render(slot.firstChild, {
              sitekey: CONFIG.turnstileSiteKey,
              language: 'ar',
              callback: function (token) { finish(true, token); },
              'error-callback': function () { fallbackLocal(slot, go, note); },
              'expired-callback': function () { showErr('انتهت صلاحية التأكيد — جرّب تاني'); }
            });
          })['catch'](function () {
            /* الشبكة أو الخدمة واقعة — منوقفش المستخدم */
            fallbackLocal(slot, go, note);
          });
        } else {
          localChallenge(slot, go, note);
        }
      });
    },

    /* بيصفّي الثقة — مفيدة لو حبيت تجبر تحقق جديد */
    reset: function (action) {
      if (!action) { saveState({}); return; }
      var all = loadState(); delete all[action]; saveState(all);
    },

    trusted: stillTrusted
  };

  function fallbackLocal(slot, go, note) {
    slot.innerHTML = '';
    localChallenge(slot, go, note);
  }

  function localChallenge(slot, go, note) {
    var ch = makeChallenge();
    var tries = 0;
    note.textContent = 'سؤال بسيط عشان نتأكد إنك مش روبوت';
    slot.innerHTML =
      '<div class="tv-q"><b></b><input class="tv-in" type="text" inputmode="numeric" ' +
      'autocomplete="off" aria-label="إجابتك" /></div>';
    slot.querySelector('b').textContent = ch.q;
    var input = slot.querySelector('.tv-in');
    go.disabled = false;
    go.textContent = 'تأكيد';

    setTimeout(function () { input.focus(); }, 60);

    function attempt() {
      clearErr();
      if (ch.check(input.value)) { finish(true, 'local'); return; }
      tries++;
      input.value = '';
      if (tries >= 3) {
        ch = makeChallenge();
        slot.querySelector('b').textContent = ch.q;
        tries = 0;
        showErr('مش مظبوط — جرّب السؤال الجديد ده');
      } else {
        showErr('الإجابة مش مظبوطة — جرّب تاني');
      }
      input.focus();
    }

    go.onclick = attempt;
    input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); attempt(); } };
  }

  global.TaniVerify = API;
})(window);
