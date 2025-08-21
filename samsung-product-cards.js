/**
 * Samsung Product Cards — v1.3.6 (SE)
 * ------------------------------------------------------------
 * Den här filen skapar ett Web Component (<samsung-product-cards>)
 * som hämtar produktdata från Samsung och visar kort med:
 * - Bild, titel, pris
 * - Energimärkning (A–G) + PDF-länkar (energietikett/produktblad)
 * - Knappar: "Visa produkt" (öppnar PDP i ny flik) och "Kopiera länk"
 *
 * VIKTIGT
 * - För pris använder vi "simple"-API:t via en WordPress-proxy för att
 *   undvika CORS: /wp-json/samsung/v1/simple?productCodes=...
 * - Övrig info (titel, bilder, energi) hämtas från "detail"-API:t direkt.
 * - Sätt window.__cardsDebug = true i konsolen för att se debug-loggar.
 * - Ingen extern beroende (ramverk), all CSS ligger i Shadow DOM.
 */

(() => {
  // === CSS-styling som injiceras i komponentens Shadow DOM
  // Vi lägger CSS i en sträng så vi kan skapa ett <style>-element i shadowRoot.
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

  // === API-endpoints (funktioner som bygger URL:er)
  // HYBRIS_SIMPLE: anropar vår WordPress-proxy för simple-API:t (pris), med flera SKU:er kommaseparerade.
  const HYBRIS_SIMPLE = (skus) =>
    `/wp-json/samsung/v1/simple?productCodes=${encodeURIComponent(skus.join(','))}`;

  // HYBRIS_DETAIL: anropar Samsungs sök-API direkt för detaljer (titel, bilder, energi).
  const HYBRIS_DETAIL = (skus) =>
    `https://searchapi.samsung.com/v6/front/b2c/product/card/detail/hybris?siteCode=se&modelList=${encodeURIComponent(skus.join(','))}&saleSkuYN=N&onlyRequestSkuYN=Y`;

  // === Hjälpfunktioner för att läsa säkert från djup JSON (utan att krascha)
  // getByPaths: prova flera "sökvägar" (arrays av nycklar) tills vi hittar ett värde.
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

  // deepFind: traverserar hela objektet rekursivt och returnerar första noden som matchar predicate.
  // path innehåller "stig" av nycklar till aktuell nod (bra när vi vill titta på fältnamnet).
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

  // === Hämta produkt-objekt för en given SKU i DETAIL-svaret (som kan ha varierande struktur)
  const findDetailProduct = (detailRes, sku) => {
    if (!detailRes) return null;
    // Vanliga nyckelvägar där en produktlista brukar ligga
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
        // matcha på flera möjliga fält: sku, modelCode eller code
        const hit = list.find(p => (p?.sku===sku) || (p?.modelCode===sku) || (p?.code===sku));
        if (hit) return hit;
      }
    }
    // Om listan inte hittades enligt "fastPaths", gör en generisk traversal
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
    // Ibland ligger svaret i ett objekt "keyed by sku"
    if (detailRes[sku] && typeof detailRes[sku] === 'object') return detailRes[sku];
    return null;
  };

  // === Hitta produkt-objekt för SKU i SIMPLE-svaret (kan vara map eller annan struktur)
  const findSimpleProduct = (simpleRes, sku) => {
    if (!simpleRes) return null;
    // Vanligast: simpleRes är en map där nyckeln är sku
    if (simpleRes[sku] && typeof simpleRes[sku] === 'object') return simpleRes[sku];

    // Annars försök hitta var listan kan ligga
    const carriers = [
      simpleRes,
      getByPaths(simpleRes, [['response','resultData'], ['resultData'], ['data']])
    ].filter(Boolean);

    for (const c of carriers) {
      if (Array.isArray(c)) {
        const hit = c.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
        if (hit) return hit;
      } else if (typeof c === 'object') {
        // Leta efter första arrayen med objekt i
        const arr = deepFind(c, (x)=> Array.isArray(x) && x.some(it => it && typeof it==='object'));
        if (Array.isArray(arr)) {
          const hit = arr.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
          if (hit) return hit;
        }
      }
    }
    return null;
  };

  // === Normalisera Samsung-bild-URL:er (många börjar med // eller korta /is/image/samsung/)
  const normalizeImageUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    if (u.startsWith('//')) return 'https:' + u; // lägg till https:
    if (u.startsWith('/is/image/samsung/')) return 'https://images.samsung.com' + u; // prefixa basdomän
    return u;
  };

  // === Försök plocka ut en representativ bild-URL från ett produktobjekt
  const pickImage = (o, sku) => {
    // 1) Vanliga fält
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
    // 2) Ibland finns path + filnamn separat
    const imagePath = getByPaths(o, [['imagePath']]);
    const imageName = getByPaths(o, [['imageName'], ['fileName']]);
    if (imagePath && imageName) {
      const out = normalizeImageUrl(String(imagePath).replace(/\/$/, '') + '/' + String(imageName).replace(/^\//,''));
      if (out) return out;
    }
    // 3) Sista utväg: scanna efter första sträng som ser ut som en bild-URL
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
    // Debug-hint: visa var vi letade om ingen bild hittas
    if (window.__cardsDebug) console.warn('Ingen bild hittad för', sku, o);
    return null;
  };

  // === Titel: prova flera fältnamn, fallback till SKU om allt failar
  const pickTitle = (o, fallbackSku) => {
    const title = getByPaths(o, [
      ['displayName'], ['name'], ['title'], ['modelName'], ['seoName']
    ]);
    return (typeof title === 'string' && title.trim().length > 1) ? title : (fallbackSku || 'Produkt');
  };

  // === PDP-URL: returnera absolut URL (prefixa samsung.com om det börjar med "/")
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

  // === Energi-relaterat (klass + PDF-länkar) ================================

  // coerceGrade: plocka första bokstaven A–G (case-insensitive) ur en sträng
  const coerceGrade = (s) => {
    if (!s) return null;
    const m = String(s).trim().match(/([A-G])/i);
    return m ? m[1].toUpperCase() : null;
  };

  // extractGradeFromAttributes: ibland ligger energiklass som "badge" eller attribut
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

  // energyPdfUrl: generera "gissade" PDF-länkar som sista fallback
  const energyPdfUrl = (sku, locale) => {
    const lower = String(sku||'').toLowerCase();
    const locs = [locale||'se','eu','uk'];
    return locs.map(l =>
      `https://images.samsung.com/is/content/samsung/p6/common/energylabel/${l}-energylabel-${lower}-energylabel.pdf`
    );
  };

  // pickEnergy: försök hitta energiklass och PDF-länkar i olika fält
  const pickEnergy = (o, sku, locale) => {
    // 1) Försök läsa klass direkt från vanliga fält
    const direct = getByPaths(o, [
      ['energyLabelGrade'],
      ['energyGrade'], ['energyClass'], ['energyEfficiencyClass'],
      ['euEnergyGrade'], ['euEnergyClass'],
      ['energy','grade'], ['energyLabel','grade'], ['euEnergy','grade']
    ]);
    let grade = coerceGrade(direct);

    // 2) Om klass saknas, kan den gömma sig i CSS-klassnamn (t.ex. badge-energy-label__badge--b)
    if (!grade) {
      const cls = getByPaths(o, [['energyLabelClass1'], ['energyLabelClass2']]);
      if (typeof cls === 'string') {
        const m = cls.match(/badge--([a-g])/i);
        if (m) grade = m[1].toUpperCase();
      }
    }

    // 3) Eller i "attributes"/"specs"/"badges"
    if (!grade) {
      const attrs = getByPaths(o, [
        ['attributes'], ['specs'], ['specifications'], ['keySpecs'], ['badges']
      ]);
      grade = extractGradeFromAttributes(attrs);
    }

    // 4) Sista försök: försök "gissa" klass från fallback-PDF-URL (om den råkar innehålla -a- / -b- etc.)
    if (!grade) {
      const pdfGuess = energyPdfUrl(sku, locale);
      for (const url of pdfGuess) {
        const m = url.match(/-([a-g])-(?:[^/]+)?energylabel\.pdf$/i);
        if (m) { grade = m[1].toUpperCase(); break; }
      }
    }

    // 5) Hitta textfält med "energy ... class X" som nödlösning
    if (!grade) {
      const anyText = deepFind(o, (node, path) => {
        if (typeof node !== 'string') return false;
        const last = (path[path.length-1] || '').toLowerCase();
        return /energy|efficiency|eu.?energy|label/.test(last) && /class\s*[A-G]/i.test(node);
      });
      grade = coerceGrade(anyText);
    }

    // 6) Hämta PDF-länkar om de finns explicit i svaret
    const energyFileUrl = getByPaths(o, [
      ['energyFileUrl'], ['euEnergyLabelUrl'], ['energyLabel','url']
    ]);
    const ficheFileUrl = getByPaths(o, [
      ['ficheFileUrl'], ['productFicheUrl']
    ]);

    // Lite extra-info om batteritid/IP/drops (inte alltid relevant för mobiler)
    const battery = deepFind(o, (x,p)=> typeof x==='string' && /\d+h/.test(x) && /battery|hours|playback|endurance/i.test((p[p.length-1]||'')));
    const ip = deepFind(o, (x)=> typeof x==='string' && /^IP\d{2}/.test(x));
    const drops = deepFind(o, (x,p)=> (typeof x==='string'||typeof x==='number') && /drop|drops|fall/i.test((p[p.length-1]||'')));

    // Bygg en PDF-lista: använd från API om finns, annars våra gissningar
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

  // === Pris-hjälpare ========================================================

  // pickPrice: plocka ut pris, helst ett redan formatterat värde ("9 990 kr")
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

    // försök matcha pris i en textsträng som "9 990 kr" eller "9990 SEK"
    const match = deepFind(o, (node) => {
      if (typeof node !== 'string') return false;
      return /(?:\d{1,3}([ .]\d{3})*|\d+)[,\.]\d{2}\s?(kr|SEK)/i.test(node);
    });
    if (typeof match === 'string') return { formatted: match };

    return null;
  };

  // pickListPrice: ordinarie pris, om det finns separat
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

  // formatPrice: gör om ett {value, currency} till "9 990,00 kr" med sv-SE, annars "—"
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

  // === Själva Web Component-klassen ========================================
  class SamsungProductCards extends HTMLElement {
    // observedAttributes: vilka HTML-attribut som ska trigga attributeChangedCallback när de ändras
    static get observedAttributes(){ return ['data-skus','data-locale']; }

    constructor(){
      super();
      // Skapa Shadow DOM (mode: 'open' gör att vi kan debugga via el.shadowRoot i devtools)
      this.attachShadow({mode:'open'});

      // root = wrapper-div för hela grid-layouten
      this.root = document.createElement('div');
      this.root.className = 'wrapper';

      // Injicera vår CSS
      const style = document.createElement('style');
      style.textContent = STYLE;

      // Lägg in style + wrapper i shadowRoot
      this.shadowRoot.append(style, this.root);

      // Läs in attributen från HTML-taggen
      this.locale = (this.getAttribute('data-locale')||'se').toLowerCase();
      this.skus = (this.getAttribute('data-skus')||'').split(',').map(s=>s.trim()).filter(Boolean);

      // Visa skeleton-kort direkt, så användaren ser "laddar..."
      this._renderSkeleton();
    }

    // Körs när ett observerat attribut ändras på elementet
    attributeChangedCallback(name, oldV, newV){
      if (name==='data-skus'){
        this.skus = (newV||'').split(',').map(s=>s.trim()).filter(Boolean);
        this.load(); // ladda om data
      }
      if (name==='data-locale'){
        this.locale = (newV||'se').toLowerCase();
        this.load(); // ladda om data
      }
    }

    // connectedCallback: triggas när elementet finns i DOM → vi hämtar data
    connectedCallback(){ this.load(); }

    // Huvudflödet: hämta data från båda API:erna och rendera
    async load(){
      // Om inga SKU:er angivna → visa felruta (vänligt för redaktörer)
      if (!this.skus || this.skus.length===0){
        this.root.innerHTML = `<div class="err">Inga SKU:er angivna. Lägg till attributet <code>data-skus</code>.</div>`;
        return;
      }

      // Visa skeletons medan vi väntar på fetch
      this._renderSkeleton();

      // Valfria overrides kan definieras av redaktör i ett script-tag med JSON
      const overridesEl = document.querySelector('script[data-samsung-product-overrides][type="application/json"]');
      let overrides = {};
      if (overridesEl){
        try{ overrides = JSON.parse(overridesEl.textContent||'{}'); } catch {}
      }

      try{
        // Hämta SIMPLE (pris) och DETAIL (bilder/titel/energi) parallellt
        const [simpleRes, detailRes] = await Promise.allSettled([
          fetch(HYBRIS_SIMPLE(this.skus), { credentials:'omit' }).then(r=>r.json()),
          fetch(HYBRIS_DETAIL(this.skus), { credentials:'omit' }).then(r=>r.json())
        ]);

        // Plocka ut JSON-värdena (eller null om något failade)
        const simple = simpleRes.status === 'fulfilled' ? simpleRes.value : null;
        const detail = detailRes.status === 'fulfilled' ? detailRes.value : null;

        // Debug-loggar om aktiverat
        if (window.__cardsDebug) {
          console.log('HYBRIS simple:', simple);
          console.log('HYBRIS detail:', detail);
        }

        // Bygg upp ett internt "result"-objekt per SKU som vi sedan renderar
        const results = this.skus.map(sku => {
          const detailItem = findDetailProduct(detail, sku) || {};
          const simpleItem = findSimpleProduct(simple, sku) || {};

          // Titel/Bild/URL: ta helst från DETAIL (bättre bilder), annars SIMPLE
          const title = (overrides[sku]?.title) || pickTitle(detailItem, sku);
          const image = (overrides[sku]?.image) || pickImage(detailItem, sku) || pickImage(simpleItem, sku) || '';
          const pdpUrl= (overrides[sku]?.url)   || pickPdpUrl(detailItem) || pickPdpUrl(simpleItem) || '#';

          // Pris: prova SIMPLE först (brukar vara källan), annars DETAIL
          const pricePrimary = overrides[sku]?.price || pickPrice(simpleItem) || pickPrice(detailItem);
          const listPrice    = overrides[sku]?.listPrice || pickListPrice(simpleItem) || pickListPrice(detailItem);

          // Energi (klass + pdf): samlas från DETAIL/SIMPLE
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

        // Rendera korten
        this._renderCards(results);
      } catch (e){
        // Visa felmeddelande om något går snett i hämtningen
        this.root.innerHTML = `<div class="err">Kunde inte hämta produktdata just nu. Kontrollera proxy/CORS eller nätverk. (${e?.message||e})</div>`;
      }
    }

    // Visa placeholders (skeleton) innan vi fått data (bra UX)
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

    // Bygg riktiga kort från data vi samlat i results[]
    _renderCards(items){
      this.root.innerHTML = '';
      items.forEach(p=>{
        const card = document.createElement('div'); card.className='card';

        // Bild (om ingen bild hittats visar vi skeleton)
        const media = document.createElement('div'); media.className='media';
        media.innerHTML = p.image ? `<img loading="lazy" src="${p.image}" alt="${this._esc(p.title)}">` : `<div class="skeleton" style="width:100%;height:100%"></div>`;

        // Kroppen av kortet innehåller titel, pris, energi och knappar
        const body = document.createElement('div'); body.className='body';

        // Titel
        const title = document.createElement('div'); title.className='title'; title.textContent = p.title;

        // Prisrad (nuvarande pris + ev. jämförpris)
        const priceRow = document.createElement('div'); priceRow.className='priceRow';
        const price = document.createElement('div'); price.className='price'; price.textContent = p.priceText || '—';
        priceRow.appendChild(price);
        if (p.listPriceText && p.listPriceText !== p.priceText){
          const cmp = document.createElement('div'); cmp.className='compare'; cmp.textContent = p.listPriceText;
          priceRow.appendChild(cmp);
        }

        // Energibox (A–G skala + metadata + PDF-länkar)
        const energy = this._renderEnergy(p.energy, p.sku);

        // Knappar: Visa produkt (öppnar PDP i ny flik) + Kopiera länk
        const ctaRow = document.createElement('div'); ctaRow.className='ctaRow';

        // "Visa produkt" är KNAPP (inte <a>) men öppnar ändå ny flik med window.open(...)
        const btn = document.createElement('button'); btn.type='button'; btn.className='cta'; btn.textContent='Visa produkt';
        btn.addEventListener('click', ()=>{
          if (p.pdpUrl && p.pdpUrl !== '#') {
            window.open(p.pdpUrl, '_blank', 'noopener');
          }
        });

        // "Kopiera länk" använder Clipboard API (fungerar i moderna webbläsare)
        const share = document.createElement('button'); share.type='button'; share.className='ghost'; share.textContent='Kopiera länk';
        share.addEventListener('click', async ()=>{
          try{
            await navigator.clipboard.writeText(p.pdpUrl || location.href);
            share.textContent='Kopierad!';
            setTimeout(()=>share.textContent='Kopiera länk', 1500);
          }catch{
            // Ignorera fel (kan hända om behörigheter saknas)
          }
        });

        ctaRow.append(btn, share);

        // Lägg ihop allting i kortet
        body.append(title, priceRow, energy, ctaRow);
        card.append(media, body);
        this.root.appendChild(card);
      });

      // OBS: Här lägger vi INTE någon "Tips:"-footer (borttagen enligt önskemål).
    }

    // Bygg energimarkeringen (skalan A–G + metadata + PDF-länkar)
    _renderEnergy(energy, sku){
      const box = document.createElement('div'); box.className='energy';

      // Rubrik
      const h = document.createElement('h4'); h.textContent='Energimärkning (EU)';

      // Skala A–G (vi markerar vald klass tydligt, övriga är nedtonade via CSS)
      const scale = document.createElement('div'); scale.className='scale';
      const classes = ['A','B','C','D','E','F','G'];
      classes.forEach(letter=>{
        const wrap = document.createElement('div');
        // Lägg på .active om det här är den valda klassen
        wrap.className = 'gradeWrap' + (energy.grade && letter===energy.grade ? ' active' : '');
        const bar = document.createElement('div'); bar.className='bar ' + letter.toLowerCase();
        const mark = document.createElement('div'); mark.className='mark'; mark.textContent=letter;
        wrap.append(bar, mark);
        scale.appendChild(wrap);
      });

      // Extra metadata (visas bara om vi hittat något)
      const details = document.createElement('div'); details.className='energyRow';
      if (energy.grade) details.appendChild(this._kv('Klass', energy.grade));
      if (energy.battery) details.appendChild(this._kv('Batteritid', energy.battery));
      if (energy.ip) details.appendChild(this._kv('IP‑klass', energy.ip));
      if (energy.drops) details.appendChild(this._kv('Tålighet', `${energy.drops} drops`));

      // PDF-länkar (energietikett + produktblad)
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

      // Om vi inte hade några PDF:er, gissa en etikett-URL baserat på SKU + locale
      if ((!energy.pdfs || energy.pdfs.length===0) && sku) {
        const guess = `https://images.samsung.com/is/content/samsung/p6/common/energylabel/se-energylabel-${sku.toLowerCase()}-energylabel.pdf`;
        const a = document.createElement('a');
        a.className='pdfLink'; a.href = guess; a.target='_blank'; a.rel='noopener noreferrer';
        a.textContent = 'Energietikett (PDF)';
        pdfRow.appendChild(a);
      }

      if (pdfRow.children.length) details.appendChild(pdfRow);

      // Lägg in rubrik, skala och detaljer i boxen
      box.append(h, scale, details);
      return box;
    }

    // Liten hjälpare för "nyckel: värde" etiketter i energiboxen
    _kv(k,v){
      const el = document.createElement('div'); el.className='kv'; el.textContent = `${k}: ${v}`;
      return el;
    }

    // HTML-escape (så att vi inte riskerar injicera otillåten HTML i t.ex. alt-text)
    _esc(s){
      return (s||'').replace(/[&<>"']/g, m=>({
        '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
      }[m]));
    }
  }

  // Registrera custom elementet (gör det en gång – om skript laddas två gånger, undvik error)
  if (!customElements.get('samsung-product-cards')) {
    customElements.define('samsung-product-cards', SamsungProductCards);
  }
})();
