/* ═══════════════════════════════════════════════════════════
   تاني — إعدادات المشروع (نموذج)

   انسخ الملف ده باسم tani-config.js وحط بياناتك فيه.
   ملف tani-config.js متجاهَل في git، فمفاتيحك مش هتترفع.

     cp tani-config.example.js tani-config.js
   ═══════════════════════════════════════════════════════════ */
window.TANI_CONFIG = {
  /* من Project Settings → API */
  supabaseUrl:     'https://YOUR-PROJECT.supabase.co',
  supabaseAnonKey: 'YOUR-ANON-KEY',

  /* من dash.cloudflare.com → Turnstile (اختياري)
     سيبه زي ما هو وهيشتغل بالتحدي المحلي */
  turnstileSiteKey: 'YOUR-TURNSTILE-SITE-KEY'
};
