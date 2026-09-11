/* ═══════════════════════════════════════════════════════════
   تاني — طبقة البيانات
   بتتحمّل في الصفحات التلاتة قبل السكربت الأساسي.

   بتشتغل على وضعين:
     supabase → لو حطيت البيانات تحت
     local    → لو مش متظبطة، بترجع لـ localStorage عشان الموقع
                يفضل شغال أثناء التطوير
   ═══════════════════════════════════════════════════════════ */
(function (global) {
  'use strict';

  /* ── ١) الإعدادات ──────────────────────────────────────────
     بتتقرا من tani-config.js (متجاهَل في git).
     انسخ tani-config.example.js وسمّيه tani-config.js وحط بياناتك. */
  var EXT = global.TANI_CONFIG || {};
  var CONFIG = {
    url:     EXT.supabaseUrl     || 'https://YOUR-PROJECT.supabase.co',
    anonKey: EXT.supabaseAnonKey || 'YOUR-ANON-KEY'
  };
  /* ملاحظة: مفتاح anon معمول عشان يتحط في المتصفح — الحماية
     الحقيقية في سياسات RLS اللي في supabase-setup.sql، مش في
     إخفاء المفتاح. متحطش الـ service_role key هنا أبداً. */

  var CONFIGURED = CONFIG.url.indexOf('YOUR-PROJECT') === -1
                && CONFIG.anonKey.indexOf('YOUR-ANON') === -1
                && typeof global.supabase !== 'undefined';

  var sb = CONFIGURED ? global.supabase.createClient(CONFIG.url, CONFIG.anonKey) : null;

  /* ── ٢) تحويل بين شكل الجدول وشكل الواجهة ──────────────── */
  function fromRow(r) {
    return {
      id: r.id,
      title: r.title,
      cat: r.category,
      cond: r.condition,
      price: Number(r.price),
      was: r.was_price ? Number(r.was_price) : 0,
      city: r.city,
      market: r.market,
      sellerName: r.seller_name,
      sellerPhone: r.seller_phone,
      desc: r.description || '',
      photos: r.photos || [],
      verified: !!r.seller_verified,
      createdAt: new Date(r.created_at).getTime(),
      mine: !!(DB.userId && r.seller_id === DB.userId)
    };
  }
  function toRow(d, uid) {
    return {
      seller_id: uid,
      title: d.title,
      category: d.cat,
      condition: d.cond,
      price: d.price,
      was_price: d.was || null,
      city: d.city,
      market: d.market,
      seller_name: d.sellerName,
      seller_phone: d.sellerPhone,
      description: d.desc || null,
      photos: d.photos || []
    };
  }

  /* ── ٣) تخزين محلي (سلة + مفضلة + وضع local) ───────────── */
  function rd(k, f) { try { var r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch (e) { return f; } }
  function wr(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }

  /* ── ٤) واجهة البيانات ─────────────────────────────────── */
  var DB = {
    mode: CONFIGURED ? 'supabase' : 'local',
    listings: [],
    userId: null,
    error: null,
    ready: null,

    byId: function (id) {
      for (var i = 0; i < DB.listings.length; i++) if (DB.listings[i].id === id) return DB.listings[i];
      return null;
    },

    /* ── قراءة ── */
    refresh: function () {
      if (DB.mode === 'local') {
        DB.listings = rd('tani_listings', []);
        return Promise.resolve(DB.listings);
      }
      return sb.from('listings')
        .select('*')
        .eq('status', 'live')
        .order('created_at', { ascending: false })
        .limit(300)
        .then(function (res) {
          if (res.error) { DB.error = res.error.message; return DB.listings; }
          DB.error = null;
          DB.listings = res.data.map(fromRow);
          return DB.listings;
        });
    },

    /* ── رفع الصور ── */
    uploadPhotos: function (blobs) {
      if (DB.mode === 'local') return Promise.resolve(blobs);   // dataURLs زي ما هي
      var uid = DB.userId;
      var jobs = blobs.map(function (blob, i) {
        var name = uid + '/' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 8) + '.jpg';
        return sb.storage.from('listing-photos')
          .upload(name, blob, { contentType: 'image/jpeg', cacheControl: '31536000' })
          .then(function (res) {
            if (res.error) throw new Error(res.error.message);
            return sb.storage.from('listing-photos').getPublicUrl(name).data.publicUrl;
          });
      });
      return Promise.all(jobs);
    },

    /* ── إضافة إعلان ── */
    add: function (draft) {
      if (DB.mode === 'local') {
        var local = rd('tani_listings', []);
        draft.id = 'u' + Date.now() + Math.floor(Math.random() * 900);
        draft.createdAt = Date.now();
        draft.mine = true;
        local.unshift(draft);
        if (!wr('tani_listings', local)) return Promise.reject(new Error('QUOTA'));
        DB.listings = local;
        return Promise.resolve(draft);
      }
      return sb.from('listings').insert(toRow(draft, DB.userId)).select().single()
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          var row = fromRow(res.data);
          row.mine = true;
          DB.listings.unshift(row);
          return row;
        });
    },

    /* ── حذف إعلان ── */
    remove: function (id) {
      if (DB.mode === 'local') {
        var local = rd('tani_listings', []).filter(function (l) { return l.id !== id; });
        wr('tani_listings', local);
        DB.listings = local;
        return Promise.resolve();
      }
      return sb.from('listings').delete().eq('id', id)
        .then(function (res) {
          if (res.error) throw new Error(res.error.message);
          DB.listings = DB.listings.filter(function (l) { return l.id !== id; });
        });
    },

    /* ── جلب إعلانات بعينها (للسلة والدفع) ── */
    fetchByIds: function (ids) {
      if (!ids.length) return Promise.resolve([]);
      if (DB.mode === 'local') {
        var local = rd('tani_listings', []);
        DB.listings = local;
        return Promise.resolve(local.filter(function (l) { return ids.indexOf(l.id) > -1; }));
      }
      return sb.from('listings').select('*').in('id', ids)
        .then(function (res) {
          if (res.error) { DB.error = res.error.message; return []; }
          var rows = res.data.map(fromRow);
          rows.forEach(function (r) { if (!DB.byId(r.id)) DB.listings.push(r); });
          return rows;
        });
    },

    /* ── تحديث حي ── */
    onChange: function (cb) {
      if (DB.mode === 'local') {
        global.addEventListener('storage', function (e) {
          if (e.key === 'tani_listings') { DB.refresh().then(cb); }
        });
        return;
      }
      sb.channel('listings-live')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' },
            function () { DB.refresh().then(cb); })
        .subscribe();
    },

    /* ── السلة والمفضلة: محلية دايماً ── */
    cart:    function ()  { return rd('tani_cart', []); },
    setCart: function (v) { wr('tani_cart', v); },
    favs:    function ()  { return rd('tani_favs', []); },
    setFavs: function (v) { wr('tani_favs', v); }
  };


  /* ── ٦) التوثيق بـ OTP ─────────────────────────────────── */
  var pending = null;   /* { channel:'phone'|'email', value:'+20…' } */

  function normPhone(raw, market){
    var d = String(raw).replace(/[٠-٩]/g, function(x){ return '٠١٢٣٤٥٦٧٨٩'.indexOf(x); })
                       .replace(/[^\d+]/g,'');
    if (d.charAt(0) === '+') return d;
    if (market === 'EG'){
      if (d.indexOf('0020') === 0) return '+' + d.slice(2);
      if (d.indexOf('20')   === 0 && d.length === 12) return '+' + d;
      if (d.charAt(0) === '0') d = d.slice(1);
      return '+20' + d;
    }
    if (d.indexOf('00966') === 0) return '+' + d.slice(2);
    if (d.indexOf('966')   === 0 && d.length === 12) return '+' + d;
    if (d.charAt(0) === '0') d = d.slice(1);
    return '+966' + d;
  }

  function validPhone(e164, market){
    if (market === 'EG') return /^\+201[0-9]{9}$/.test(e164);
    return /^\+9665[0-9]{8}$/.test(e164);
  }

  DB.auth = {
    /* هل المستخدم موثّق؟ */
    verified: false,
    contact: null,

    normPhone: normPhone,
    validPhone: validPhone,

    /* إرسال الكود — بيحوّل الحساب المجهول لحساب دائم بنفس الـ uid
       فالإعلانات القديمة بتفضل مربوطة بيه */
    send: function (identifier, market) {
      if (DB.mode === 'local') {
        pending = { channel: identifier.indexOf('@') > -1 ? 'email' : 'phone', value: identifier, fake: true };
        return Promise.resolve({ demo: true });
      }
      var isEmail = identifier.indexOf('@') > -1;
      var value = isEmail ? identifier.trim() : normPhone(identifier, market);
      if (!isEmail && !validPhone(value, market)) {
        return Promise.reject(new Error('الرقم مش مظبوط — اكتبه زي ما هو في الموبايل'));
      }
      pending = { channel: isEmail ? 'email' : 'phone', value: value };

      var payload = isEmail ? { email: value } : { phone: value };
      return sb.auth.updateUser(payload).then(function (res) {
        if (res.error) {
          /* لو مفيش جلسة أصلاً، ابدأ واحدة جديدة بالـ OTP */
          if (/session|not authenticated/i.test(res.error.message)) {
            return sb.auth.signInWithOtp(payload).then(function (r2) {
              if (r2.error) throw new Error(r2.error.message);
              pending.fresh = true;
              return r2;
            });
          }
          throw new Error(res.error.message);
        }
        return res;
      });
    },

    /* تأكيد الكود */
    confirm: function (code) {
      if (!pending) return Promise.reject(new Error('ابعت الكود الأول'));
      if (DB.mode === 'local') {
        DB.auth.verified = true;
        DB.auth.contact = pending.value;
        return Promise.resolve({ demo: true });
      }
      var type = pending.fresh
        ? (pending.channel === 'email' ? 'email' : 'sms')
        : (pending.channel === 'email' ? 'email_change' : 'phone_change');
      var args = { token: String(code).trim(), type: type };
      args[pending.channel] = pending.value;

      return sb.auth.verifyOtp(args).then(function (res) {
        if (res.error) throw new Error(res.error.message);
        return sb.auth.getUser();
      }).then(function (res) {
        var u = res.data && res.data.user;
        DB.userId = u ? u.id : DB.userId;
        DB.auth.verified = !!(u && ((u.phone && u.phone_confirmed_at) || (u.email && u.email_confirmed_at)));
        DB.auth.contact = u ? (u.phone || u.email) : null;
        pending = null;
        return DB.refresh();
      });
    },

    pendingTo: function () { return pending ? pending.value : null; },
    channel:   function () { return pending ? pending.channel : null; }
  };

  /* ── ٥) الإقلاع: دخول مجهول ثم تحميل أول دفعة ──────────── */
  DB.ready = (function () {
    if (DB.mode === 'local') {
      return DB.refresh().then(function () { return DB; });
    }
    return sb.auth.getSession()
      .then(function (res) {
        if (res.data && res.data.session) return res.data.session;
        return sb.auth.signInAnonymously().then(function (r) {
          if (r.error) throw new Error(r.error.message);
          return r.data.session;
        });
      })
      .then(function (session) {
        var u = session && session.user;
        DB.userId = u ? u.id : null;
        DB.auth.verified = !!(u && ((u.phone && u.phone_confirmed_at) || (u.email && u.email_confirmed_at)));
        DB.auth.contact  = u ? (u.phone || u.email) : null;
        return DB.refresh();
      })
      .then(function () { return DB; })
      .catch(function (err) {
        /* لو Supabase وقع، كمّل محلي بدل ما الموقع يقف */
        DB.error = err.message;
        DB.mode = 'local';
        return DB.refresh().then(function () { return DB; });
      });
  })();

  global.TaniDB = DB;
})(window);
