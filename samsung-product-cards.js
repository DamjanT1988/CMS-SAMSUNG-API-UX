/**
 * Samsung Product Cards — v1.3.6 (SE)
 * - WP-proxy för simple: /wp-json/samsung/v1/simple?productCodes=...
 * - Robust parsing för DETAIL + SIMPLE
 * - Bild: fler fältnamn + auto-prefix av Samsung-URL:er
 * - Pris: tolerant formatering
 * - Energi: energyLabelGrade + energyLabelClass1/2 + PDF-fallback
 * - PDF-länkar: använder energyFileUrl/ficheFileUrl från API
 * - CTA: "Visa produkt" är knapp med hover och öppnar p.pdpUrl i ny flik
 * - UI: Hover på knappar, vald energiklass extra tydlig, övriga nedtonade
 * - Debug: window.__cardsDebug = true
 */
(() => {
  const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
.wrapper{
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  color: #0b0b0b;
  display:grid; gap:16px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
}
.card{
  border:1px solid #e6e6e6; border-radius:16px; overflow:hidden; background:#fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
  display:flex; flex-direction:column;
}
.media{
  width:100%; aspect-ratio: 1/1; background:#fafafa; display:flex; align-items:center; justify-content:center;
}
.media img{ max-width:90%; max-height:90%; object-fit:contain; }
.body{ padding:16px; display:flex; flex-direction:column; gap:8px; }
.title{ font-size:16px; font-weight:600; line-height:1.3; min-height:40px; }
.priceRow{ display:flex; align-items:baseline; gap:8px; }
.price{ font-size:18px; font-weight:700; }
.compare{ font-size:13px; color:#6b7280; text-decoration:line-through; }

.ctaRow{ margin-top:8px; display:flex; gap:8px; }
button.cta, button.ghost{
  appearance:none; border-radius:999px; padding:10px 14px; cursor:pointer;
  border:1px solid #0b0b0b; font-weight:600; font-size:14px; transition:all .18s ease;
}
button.cta{ background:#0b0b0b; color:#fff; }
button.cta:hover{ background:#2a2a2a; transform:translateY(-1px); box-shadow:0 4px 10px rgba(0,0,0,.08); }
button.cta:active{ transform:translateY(0); box-shadow:none; }
button.ghost{ background:transparent; color:#0b0b0b; }
button.ghost:hover{ background:#f5f5f5; transform:translateY(-1px); }
button.ghost:active{ transform:translateY(0); }

.energy{
  margin-top:10px; padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:#f9fafb;
}
.energy h4{ margin:0 0 6px 0; font-size:12px; font-weight:700; color:#374151; letter-spacing:.02em; text-transform:uppercase; }
.scale{ display:grid; grid-template-columns: repeat(7, 1fr); gap:8px; align-items:end; }
.gradeWrap{ display:grid; gap:4px; justify-items:center; transition:all .18s ease; opacity:.25; filter:grayscale(60%); }
.gradeWrap .bar{ height:8px; width:100%; border-radius:4px; background:#22c55e; transition:all .18s ease; }
.gradeWrap .mark{ font-size:12px; color:#111827; font-weight:700; transition:all .18s ease; }

.gradeWrap.active{ opacity:1; filter:none; transform:scale(1.03); }
.gradeWrap.active .bar{ height:12px; box-shadow: inset 0 0 0 2px rgba(0,0,0,.05); }
.gradeWrap.active .mark{ text-decoration:underline; font-weight:800; }

.bar.b{ background:#84cc16; }
.bar.c{ background:#a3e635; }
.bar.d{ background:#facc15; }
.bar.e{ background:#fb923c; }
.bar.f{ background:#f97316; }
.bar.g{ background:#ef4444; }

.energyRow{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:8px; }
.kv{ font-size:12px; color:#374151; background:#fff; border:1px solid #e5e7eb; padding:6px 8px; border-radius:8px; }
.pdfRow{ margin-left:auto; display:flex; gap:12px; align-items:center; }
.pdfLink{ font-size:12px; text-decoration:none; color:#0b0b0b; border-bottom:1px dotted #0b0b0b; }

.skeleton{ background:linear-gradient(90deg, #f4f4f5, #ffffff, #f4f4f5); background-size:200% 100%; animation:s 1.2s ease-in-out infinite; }
@keyframes s{ 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.media.skeleton{ aspect-ratio:1/1; }
.title.skeleton{ height:18px; width:70%; border-radius:6px; }
.price.skeleton{ height:16px; width:40%; border-radius:6px; }

.err{ border:1px dashed #ef4444; background:#fff7f7; color:#991b1b; padding:10px; border-radius:12px; font-size:13px; }
  `;

  // -- Endpoints
  const HYBRIS_SIMPLE = (skus) =>
    `/wp-json/samsung/v1/simple?productCodes=${encodeURIComponent(skus.join(','))}`;
  const HYBRIS_DETAIL = (skus) =>
    `https://searchapi.samsung.com/v6/front/b2c/product/card/detail/hybris?siteCode=se&modelList=${encodeURIComponent(skus.join(','))}&saleSkuYN=N&onlyRequestSkuYN=Y`;

  // ---- helpers
  const getByPaths = (root, paths) => {
    for (const path of paths) {
      let node = root;
      let ok = true;
      for (const key of path) {
        if (!node || typeof node !== 'object' || !(key in node)) { ok = false; break; }
        node = node[key];
      }
      if (ok && node != null && node !== '') return node;
    }
    return null;
  };

  const deepFind = (obj, predicate, path = []) => {
    if (!obj || typeof obj !== 'object') return null;
    if (predicate(obj, path)) return obj;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const r = deepFind(v, predicate, path.concat(k));
      if (r) return r;
    }
    return null;
  };

  // --- DETAIL: find product object for SKU
  const findDetailProduct = (detailRes, sku) => {
    if (!detailRes) return null;
    const fastPaths = [
      ['response','resultData','products'],
      ['response','resultData','productList'],
      ['response','resultData','productCardList'],
      ['resultData','products'],
      ['products'],
      ['data','products']
    ];
    for (const path of fastPaths) {
      const list = getByPaths(detailRes, [path]);
      if (Array.isArray(list)) {
        const hit = list.find(p => (p?.sku===sku) || (p?.modelCode===sku) || (p?.code===sku));
        if (hit) return hit;
      }
    }
    const seen = new WeakSet();
    const stack = [detailRes];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== 'object' || seen.has(cur)) continue;
      seen.add(cur);
      if (Array.isArray(cur)) {
        for (const item of cur) {
          if (item && typeof item === 'object') {
            if (item.sku === sku || item.modelCode === sku || item.code === sku) return item;
          }
        }
      }
      for (const k of Object.keys(cur)) {
        const v = cur[k];
        if (v && typeof v === 'object') stack.push(v);
      }
    }
    if (detailRes[sku] && typeof detailRes[sku] === 'object') return detailRes[sku];
    return null;
  };

  // --- SIMPLE: find product object for SKU
  const findSimpleProduct = (simpleRes, sku) => {
    if (!simpleRes) return null;
    if (simpleRes[sku] && typeof simpleRes[sku] === 'object') return simpleRes[sku];
    const carriers = [
      simpleRes,
      getByPaths(simpleRes, [['response','resultData'], ['resultData'], ['data']])
    ].filter(Boolean);
    for (const c of carriers) {
      if (Array.isArray(c)) {
        const hit = c.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
        if (hit) return hit;
      } else if (typeof c === 'object') {
        const arr = deepFind(c, (x)=> Array.isArray(x) && x.some(it => it && typeof it==='object'));
        if (Array.isArray(arr)) {
          const hit = arr.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
          if (hit) return hit;
        }
      }
    }
    return null;
  };

  // --- URL normalizer for Samsung CDN paths
  const normalizeImageUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/is/image/samsung/')) return 'https://images.samsung.com' + u;
    return u;
  };

  // --- Bildplockare (tolerant)
  const pickImage = (o, sku) => {
    const direct = getByPaths(o, [
      ['representativeImageUrl'], ['productImageUrl'], ['imageUrl'],
      ['image','url'], ['thumbnailUrl'], ['thumbUrl'],
      ['media','thumbnailUrl'], ['media','imageUrl'], ['media','url'],
      ['images','0','url'], ['assets','0','url'], ['imagePath']
    ]);
    if (typeof direct === 'string') {
      const out = normalizeImageUrl(direct);
      if (out) return out;
    }
    const imagePath = getByPaths(o, [['imagePath']]);
    const imageName = getByPaths(o, [['imageName'], ['fileName']]);
    if (imagePath && imageName) {
      const out = normalizeImageUrl(String(imagePath).replace(/\/$/, '') + '/' + String(imageName).replace(/^\//,''));
      if (out) return out;
    }
    const found = deepFind(o, (node) => {
      if (typeof node !== 'string') return false;
      return /^https?:\/\/.+\.(png|jpe?g|webp|gif)$/i.test(node)
          || /^https?:\/\/images\.samsung\.com\//i.test(node)
          || node.startsWith('//images.samsung.com')
          || node.startsWith('/is/image/samsung/');
    });
    if (typeof found === 'string') {
      const out = normalizeImageUrl(found);
      if (out) return out;
    }
    if (window.__cardsDebug) console.warn('Ingen bild hittad för', sku, o);
    return null;
  };

  const pickTitle = (o, fallbackSku) => {
    const title = getByPaths(o, [
      ['displayName'], ['name'], ['title'], ['modelName'], ['seoName']
    ]);
    return (typeof title === 'string' && title.trim().length > 1) ? title : (fallbackSku || 'Produkt');
  };

  const pickPdpUrl = (o) => {
    const url = getByPaths(o, [
      ['pdpUrl'], ['canonicalUrl'], ['url'], ['detailUrl']
    ]);
    if (typeof url === 'string') {
      if (/^https?:\/\//.test(url)) return url;
      if (url.startsWith('/')) return 'https://www.samsung.com' + url;
    }
    return '#';
  };

  // --- Energi & PDF-länkar
  const coerceGrade = (s) => {
    if (!s) return null;
    const m = String(s).trim().match(/([A-G])/i);
    return m ? m[1].toUpperCase() : null;
  };

  const extractGradeFromAttributes = (attrs) => {
    if (!Array.isArray(attrs)) return null;
    for (const a of attrs) {
      const key = (a?.code || a?.name || a?.key || '').toString().toLowerCase();
      const val = (a?.value || a?.displayValue || a?.text || '').toString();
      if (/energy|efficiency|eu.?energy|label/.test(key)) {
        const g = coerceGrade(val);
        if (g) return g;
      }
    }
    return null;
  };

  const energyPdfUrl = (sku, locale) => {
    // Generiska “gissa”-URL:er, används ENDAST som sista fallback
    const lower = String(sku||'').toLowerCase();
    const locs = [locale||'se','eu','uk'];
    return locs.map(l =>
      `https://images.samsung.com/is/content/samsung/p6/common/energylabel/${l}-energylabel-${lower}-energylabel.pdf`
    );
  };

  const pickEnergy = (o, sku, locale) => {
    // 1) Energi-klass
    const direct = getByPaths(o, [
      ['energyLabelGrade'],
      ['energyGrade'], ['energyClass'], ['energyEfficiencyClass'],
      ['euEnergyGrade'], ['euEnergyClass'],
      ['energy','grade'], ['energyLabel','grade'], ['euEnergy','grade']
    ]);
    let grade = coerceGrade(direct);

    if (!grade) {
      const cls = getByPaths(o, [['energyLabelClass1'], ['energyLabelClass2']]);
      if (typeof cls === 'string') {
        const m = cls.match(/badge--([a-g])/i);
        if (m) grade = m[1].toUpperCase();
      }
    }

    if (!grade) {
      const attrs = getByPaths(o, [
        ['attributes'], ['specs'], ['specifications'], ['keySpecs'], ['badges']
      ]);
      grade = extractGradeFromAttributes(attrs);
    }

    if (!grade) {
      const pdfGuess = energyPdfUrl(sku, locale);
      for (const url of pdfGuess) {
        const m = url.match(/-([a-g])-(?:[^/]+)?energylabel\.pdf$/i);
        if (m) { grade = m[1].toUpperCase(); break; }
      }
    }

    if (!grade) {
      const anyText = deepFind(o, (node, path) => {
        if (typeof node !== 'string') return false;
        const last = (path[path.length-1] || '').toLowerCase();
        return /energy|efficiency|eu.?energy|label/.test(last) && /class\s*[A-G]/i.test(node);
      });
      grade = coerceGrade(anyText);
    }

    // 2) PDF-länkar från API
    const energyFileUrl = getByPaths(o, [
      ['energyFileUrl'], ['euEnergyLabelUrl'], ['energyLabel','url']
    ]);
    const ficheFileUrl = getByPaths(o, [
      ['ficheFileUrl'], ['productFicheUrl']
    ]);

    // 3) Övrig metadata
    const battery = deepFind(o, (x,p)=> typeof x==='string' && /\d+h/.test(x) && /battery|hours|playback|endurance/i.test((p[p.length-1]||'')));
    const ip = deepFind(o, (x)=> typeof x==='string' && /^IP\d{2}/.test(x));
    const drops = deepFind(o, (x,p)=> (typeof x==='string'||typeof x==='number') && /drop|drops|fall/i.test((p[p.length-1]||'')));

    // 4) PDF-lista
    const pdfs = [];
    if (typeof energyFileUrl === 'string') pdfs.push(energyFileUrl);
    if (typeof ficheFileUrl === 'string') pdfs.push(ficheFileUrl);
    if (pdfs.length === 0) pdfs.push(...energyPdfUrl(sku, locale));

    return {
      grade: grade || null,
      battery: typeof battery==='string'?battery:null,
      ip: typeof ip==='string'?ip:null,
      drops: (typeof drops==='string'||typeof drops==='number')?String(drops):null,
      pdfs
    };
  };

  const pickPrice = (o) => {
    const formatted = getByPaths(o, [
      ['price','formattedValue'], ['price','formatted'], ['priceDisplay'],
      ['sellingPrice','formatted'], ['finalPrice','formatted'], ['offerPrice','formatted'],
      ['formattedPrice']
    ]);
    if (typeof formatted === 'string') return { formatted };

    const value = getByPaths(o, [
      ['price','value'], ['sellingPrice','amount'], ['finalPrice','amount'],
      ['offerPrice','amount'], ['priceValue']
    ]);
    if (typeof value === 'number') return { value, currency: 'SEK' };

    const match = deepFind(o, (node) => {
      if (typeof node !== 'string') return false;
      return /(?:\d{1,3}([ .]\d{3})*|\d+)[,\.]\d{2}\s?(kr|SEK)/i.test(node);
    });
    if (typeof match === 'string') return { formatted: match };

    return null;
  };

  const pickListPrice = (o) => {
    const formatted = getByPaths(o, [
      ['listPrice','formatted'], ['originalPrice','formatted'], ['wasPrice','formatted']
    ]);
    if (typeof formatted === 'string') return { formatted };

    const value = getByPaths(o, [
      ['listPrice','value'], ['originalPrice','value'], ['wasPrice','value']
    ]);
    if (typeof value === 'number') return { value, currency: 'SEK' };
    return null;
  };

  const formatPrice = (p) => {
    if (!p) return '—';
    if (p.formatted) return p.formatted;
    try {
      const v = Number(p.value);
      if (Number.isFinite(v)) {
        return new Intl.NumberFormat('sv-SE', { style:'currency', currency: (p.currency||'SEK') }).format(v);
      }
    } catch {}
    return '—';
  };

  class SamsungProductCards extends HTMLElement {
    static get observedAttributes(){ return ['data-skus','data-locale']; }
    constructor(){
      super();
      this.attachShadow({mode:'open'});
      this.root = document.createElement('div');
      this.root.className = 'wrapper';
      const style = document.createElement('style');
      style.textContent = STYLE;
      this.shadowRoot.append(style, this.root);
      this.locale = (this.getAttribute('data-locale')||'se').toLowerCase();
      this.skus = (this.getAttribute('data-skus')||'').split(',').map(s=>s.trim()).filter(Boolean);
      this._renderSkeleton();
    }
    attributeChangedCallback(name, oldV, newV){
      if (name==='data-skus'){
        this.skus = (newV||'').split(',').map(s=>s.trim()).filter(Boolean);
        this.load();
      }
      if (name==='data-locale'){
        this.locale = (newV||'se').toLowerCase();
        this.load();
      }
    }
    connectedCallback(){ this.load(); }

    async load(){
      if (!this.skus || this.skus.length===0){
        this.root.innerHTML = `<div class="err">Inga SKU:er angivna. Lägg till attributet <code>data-skus</code>.</div>`;
        return;
      }
      this._renderSkeleton();

      const overridesEl = document.querySelector('script[data-samsung-product-overrides][type="application/json"]');
      let overrides = {};
      if (overridesEl){
        try{ overrides = JSON.parse(overridesEl.textContent||'{}'); } catch {}
      }

      try{
        const [simpleRes, detailRes] = await Promise.allSettled([
          fetch(HYBRIS_SIMPLE(this.skus), { credentials:'omit' }).then(r=>r.json()),
          fetch(HYBRIS_DETAIL(this.skus), { credentials:'omit' }).then(r=>r.json())
        ]);

        const simple = simpleRes.status === 'fulfilled' ? simpleRes.value : null;
        const detail = detailRes.status === 'fulfilled' ? detailRes.value : null;

        if (window.__cardsDebug) {
          console.log('HYBRIS simple:', simple);
          console.log('HYBRIS detail:', detail);
        }

        const results = this.skus.map(sku => {
          const detailItem = findDetailProduct(detail, sku) || {};
          const simpleItem = findSimpleProduct(simple, sku) || {};

          const title = (overrides[sku]?.title) || pickTitle(detailItem, sku);
          const image = (overrides[sku]?.image) || pickImage(detailItem, sku) || pickImage(simpleItem, sku) || '';
          const pdpUrl= (overrides[sku]?.url)   || pickPdpUrl(detailItem) || pickPdpUrl(simpleItem) || '#';

          const pricePrimary = overrides[sku]?.price || pickPrice(simpleItem) || pickPrice(detailItem);
          const listPrice    = overrides[sku]?.listPrice || pickListPrice(simpleItem) || pickListPrice(detailItem);

          const energyFromApi = pickEnergy(detailItem || simpleItem || {}, sku, this.locale);
          const energyGrade = (overrides[sku]?.energyGrade || energyFromApi.grade || '').toUpperCase();
          const battery = overrides[sku]?.battery || energyFromApi.battery || null;
          const ip      = overrides[sku]?.ip || energyFromApi.ip || null;
          const drops   = overrides[sku]?.drops || energyFromApi.drops || null;
          const pdfs    = (energyFromApi.pdfs && energyFromApi.pdfs.length ? energyFromApi.pdfs : []);

          if (window.__cardsDebug) {
            console.log('SKU', sku, { title, image, pdpUrl, pricePrimary, listPrice, energyGrade, pdfs });
          }

          return {
            sku, title, image, pdpUrl,
            priceText: formatPrice(pricePrimary),
            listPriceText: listPrice ? formatPrice(listPrice) : null,
            energy: { grade: /^[A-G]$/.test(energyGrade) ? energyGrade : null, battery, ip, drops, pdfs }
          };
        });

        this._renderCards(results);
      } catch (e){
        this.root.innerHTML = `<div class="err">Kunde inte hämta produktdata just nu. Kontrollera proxy/CORS eller nätverk. (${e?.message||e})</div>`;
      }
    }

    _renderSkeleton(){
      this.root.innerHTML = '';
      for (let i=0;i<Math.max(1, this.skus.length);i++){
        const card = document.createElement('div'); card.className='card';
        card.innerHTML = `
          <div class="media skeleton"></div>
          <div class="body">
            <div class="title skeleton"></div>
            <div class="price skeleton"></div>
          </div>`;
        this.root.appendChild(card);
      }
    }

    _renderCards(items){
      this.root.innerHTML = '';
      items.forEach(p=>{
        const card = document.createElement('div'); card.className='card';

        const media = document.createElement('div'); media.className='media';
        media.innerHTML = p.image ? `<img loading="lazy" src="${p.image}" alt="${this._esc(p.title)}">` : `<div class="skeleton" style="width:100%;height:100%"></div>`;

        const body = document.createElement('div'); body.className='body';

        const title = document.createElement('div'); title.className='title'; title.textContent = p.title;

        const priceRow = document.createElement('div'); priceRow.className='priceRow';
        const price = document.createElement('div'); price.className='price'; price.textContent = p.priceText || '—';
        priceRow.appendChild(price);
        if (p.listPriceText && p.listPriceText !== p.priceText){
          const cmp = document.createElement('div'); cmp.className='compare'; cmp.textContent = p.listPriceText;
          priceRow.appendChild(cmp);
        }

        const energy = this._renderEnergy(p.energy, p.sku);

        const ctaRow = document.createElement('div'); ctaRow.className='ctaRow';
        // "Visa produkt" som KNAPP som öppnar p.pdpUrl i ny flik
        const btn = document.createElement('button'); btn.type='button'; btn.className='cta'; btn.textContent='Visa produkt';
        btn.addEventListener('click', ()=>{
          if (p.pdpUrl && p.pdpUrl !== '#') {
            window.open(p.pdpUrl, '_blank', 'noopener');
          }
        });
        const share = document.createElement('button'); share.type='button'; share.className='ghost'; share.textContent='Kopiera länk';
        share.addEventListener('click', async ()=>{
          try{ await navigator.clipboard.writeText(p.pdpUrl || location.href); share.textContent='Kopierad!'; setTimeout(()=>share.textContent='Kopiera länk', 1500); }catch{}
        });
        ctaRow.append(btn, share);

        body.append(title, priceRow, energy, ctaRow);
        card.append(media, body);
        this.root.appendChild(card);
      });
      // Ingen footerNote här längre
    }

    _renderEnergy(energy, sku){
      const box = document.createElement('div'); box.className='energy';
      const h = document.createElement('h4'); h.textContent='Energimärkning (EU)';
      const scale = document.createElement('div'); scale.className='scale';

      const classes = ['A','B','C','D','E','F','G'];
      classes.forEach(letter=>{
        const wrap = document.createElement('div');
        wrap.className = 'gradeWrap' + (energy.grade && letter===energy.grade ? ' active' : '');
        const bar = document.createElement('div'); bar.className='bar ' + letter.toLowerCase();
        const mark = document.createElement('div'); mark.className='mark'; mark.textContent=letter;
        wrap.append(bar, mark);
        scale.appendChild(wrap);
      });

      const details = document.createElement('div'); details.className='energyRow';
      if (energy.grade) details.appendChild(this._kv('Klass', energy.grade));
      if (energy.battery) details.appendChild(this._kv('Batteritid', energy.battery));
      if (energy.ip) details.appendChild(this._kv('IP‑klass', energy.ip));
      if (energy.drops) details.appendChild(this._kv('Tålighet', `${energy.drops} drops`));

      // PDF-länkar
      const pdfRow = document.createElement('div'); pdfRow.className='pdfRow';
      const [labelPdf, fichePdf] = energy.pdfs || [];
      if (labelPdf) {
        const a = document.createElement('a');
        a.className='pdfLink'; a.href = labelPdf; a.target='_blank'; a.rel='noopener noreferrer';
        a.textContent = 'Energietikett (PDF)';
        pdfRow.appendChild(a);
      }
      if (fichePdf) {
        const b = document.createElement('a');
        b.className='pdfLink'; b.href = fichePdf; b.target='_blank'; b.rel='noopener noreferrer';
        b.textContent = 'Produktblad (PDF)';
        pdfRow.appendChild(b);
      }
      if ((!energy.pdfs || energy.pdfs.length===0) && sku) {
        const guess = `https://images.samsung.com/is/content/samsung/p6/common/energylabel/se-energylabel-${sku.toLowerCase()}-energylabel.pdf`;
        const a = document.createElement('a');
        a.className='pdfLink'; a.href = guess; a.target='_blank'; a.rel='noopener noreferrer';
        a.textContent = 'Energietikett (PDF)';
        pdfRow.appendChild(a);
      }

      if (pdfRow.children.length) details.appendChild(pdfRow);

      box.append(h, scale, details);
      return box;
    }

    _kv(k,v){
      const el = document.createElement('div'); el.className='kv'; el.textContent = `${k}: ${v}`;
      return el;
    }

    _esc(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
  }

  if (!customElements.get('samsung-product-cards')) {
    customElements.define('samsung-product-cards', SamsungProductCards);
  }
})();
