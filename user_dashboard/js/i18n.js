(function(){
  const I18N = {
    dict: {},
    lang: 'en',
    async init(defaultLang){
      const saved = localStorage.getItem('lang');
      const browser = (navigator.language || 'en').slice(0,2);
      this.lang = saved || defaultLang || browser || 'en';
      await this.load(this.lang);
      this.apply();
      this.bindSelector();
    },
    async load(lang){
      try {
        const res = await fetch(`/i18n/${lang}.json`);
        this.dict = await res.json();
        this.lang = lang;
        localStorage.setItem('lang', lang);
      } catch (e) { console.warn('i18n load failed', e); }
    },
    t(path){
      const parts = path.split('.');
      let cur = this.dict;
      for (const p of parts) { if (!cur) return ''; cur = cur[p]; }
      return typeof cur === 'string' ? cur : '';
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



