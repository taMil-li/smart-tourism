(function(){
  const I18N = {
    dict: {},
    lang: 'en',
    async init(defaultLang){
      const saved = localStorage.getItem('lang');
      const browser = (navigator.language || 'en').slice(0,2);
      this.lang = saved || defaultLang || browser || 'en';

      // Start loading translations immediately
      const loadPromise = this.load(this.lang);

      // Wait for DOM ready before applying translations and binding selector
      const domReady = (document.readyState === 'loading')
        ? new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }))
        : Promise.resolve();

      await Promise.all([loadPromise, domReady]);

      // Apply translations and bind selector after both JSON is loaded and DOM is ready
      this.apply();
      this.bindSelector();
    },
    async load(lang){
      // Build a list of candidate URLs based on current script location and document
      const scriptSrc = (document.currentScript && document.currentScript.src) || window.location.href;
      const scriptBase = scriptSrc.replace(/\/[^\/]*$/, '/'); // directory of script
      const docBase = window.location.href.replace(/[^\/]*$/, '');
      const candidates = [
        // common server-root locations
        `${location.origin}/public/i18n/${lang}.json`,
        `${location.origin}/i18n/${lang}.json`,
        // relative to the script file (e.g. if script served from /public/js/)
        new URL(`../i18n/${lang}.json`, scriptBase).href,
        new URL(`./i18n/${lang}.json`, scriptBase).href,
        // relative to current document
        new URL(`./i18n/${lang}.json`, docBase).href,
        new URL(`../i18n/${lang}.json`, docBase).href
      ];

      let lastError = null;
      for (const url of candidates) {
        try {
          const res = await fetch(url);
          if (!res.ok) {
            lastError = `HTTP ${res.status} ${res.statusText} for ${url}`;
            continue;
          }
          this.dict = await res.json();
          this.lang = lang;
          localStorage.setItem('lang', lang);
          console.info('i18n loaded', lang, 'from', url);
          // ensure English fallback is available
          await this._ensureFallback();
          return;
        } catch (e) {
          lastError = e;
        }
      }
      console.warn('i18n load failed for', lang, 'lastError:', lastError);
    },
    t(path){
      const parts = path.split('.');
      let cur = this.dict;
      for (const p of parts) { if (!cur) return ''; cur = cur[p]; }
      if (typeof cur === 'string') return cur;
      // fallback to English if available
      if (this.fallbackDict) {
        let f = this.fallbackDict;
        for (const p of parts) { if (!f) break; f = f[p]; }
        if (typeof f === 'string') return f;
      }
      return '';
    },

    async _ensureFallback(){
      if (this.fallbackDict) return;
      try {
        const candidates = [
          `${location.origin}/i18n/en.json`,
          `${location.origin}/public/i18n/en.json`,
          new URL(`../i18n/en.json`, (document.currentScript && document.currentScript.src) || window.location.href).href,
          new URL(`./i18n/en.json`, window.location.href).href
        ];
        let ok = false;
        for (const url of candidates) {
          try {
            const res = await fetch(url);
            if (!res.ok) continue;
            this.fallbackDict = await res.json();
            ok = true;
            break;
          } catch (e) { continue; }
        }
        if (!ok) this.fallbackDict = this.dict; // fallback to current
      } catch (e) {
        this.fallbackDict = this.dict;
      }
    },
    apply(root=document){
      const nodes = root.querySelectorAll('[data-i18n]');
      nodes.forEach(el => {
        const key = el.getAttribute('data-i18n');
        const text = this.t(key);
        if (text) el.textContent = text;
      });
      const attrNodes = root.querySelectorAll('[data-i18n-attr]');
      attrNodes.forEach(el => {
        const pairs = (el.getAttribute('data-i18n-attr')||'').split(',');
        pairs.forEach(pair => {
          const [attr, key] = pair.split(':').map(s=>s && s.trim());
          if (!attr || !key) return;
          const val = this.t(key);
          if (val) el.setAttribute(attr, val);
        });
      });
    },
    async setLanguage(lang){
      await this.load(lang);
      this.apply();
      const select = document.getElementById('langSelect');
      if (select) select.value = this.lang;
    },
    bindSelector(){
      const select = document.getElementById('langSelect');
      if (!select) return;
      select.value = this.lang;
      select.addEventListener('change', (e)=>{
        this.setLanguage(e.target.value);
      });
    }
  };
  window.I18N = I18N;
})();



