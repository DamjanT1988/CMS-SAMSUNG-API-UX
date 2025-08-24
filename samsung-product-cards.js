/**
 * Samsung Product Cards — v1.3.7 (SE)
 * -----------------------------------------------------------------------------
 * VAD ÄR DETTA?
 * Ett fristående Web Component (<samsung-product-cards>) som visar produktkort
 * för Samsung-modeller (t.ex. S25-serien) med bild, titel, pris och
 * energimärkning. Ingen extern JS-ram krävs.
 *
 * HUR ANVÄNDER JAG DET?
 * 1) Se till att denna fil laddas in en gång (enqueue via tema/MU-plugin).
 * 2) Lägg in i HTML/WordPress:
 *      <samsung-product-cards
 *        data-skus="SM-S931BLBDEUB,SM-S937BLBDEUB,SM-S936BDBDEUB"
 *        data-locale="se"></samsung-product-cards>
 * 3) (Valfritt) Lägg overrides i sidan:
 *      <script type="application/json" data-samsung-product-overrides>
 *      { "SM-S931BLBDEUB": { "title": "Min titel", "price": { "formatted":"9 990 kr" } } }
 *      </script>
 *
 * VAD HÄNDER UNDER HUSET?
 * - Hämtar pris från en WP-proxy (CORS-safe):  /wp-json/samsung/v1/simple?productCodes=...
 * - Hämtar detaljer/bilder/energi direkt från Samsungs "searchapi" DETAIL-endpoint.
 * - Normaliserar bild-URL:er, väljer rätt fält (tolerant parsning) och bygger UI.
 * - Markerar vald energiklass tydligt; andra klasser nedtonas.
 * - Knapp "Visa produkt" öppnar PDP i ny flik. "Kopiera länk" kopierar PDP-URL.
 * - Coalescing + in-memory cache för att undvika onödiga nätverksanrop.
 *
 * DEBUG?
 * Skriv i konsolen:  window.__cardsDebug = true;  för att se rådata/loggar.
 * -----------------------------------------------------------------------------
 */
(() => {
  /* ===========================================================================
   *                                STYLES (CSS)
   *  - All CSS ligger i en template-string och injiceras i komponentens Shadow DOM
   *  - Shadow DOM skyddar stilar från att blandas med sidans övriga CSS
   * =========================================================================== */
  const STYLE = `
:host { all: initial; }                 /* "Nollställer" ärvda stilar från sidan */
* { box-sizing: border-box; }           /* Förutsägbar layout för padding/border */

.wrapper{
  font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  color: #0b0b0b;
  display:grid; gap:16px;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); /* Responsivt grid */
}
.card{
  border:1px solid #e6e6e6; border-radius:16px; overflow:hidden; background:#fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 4%);
  display:flex; flex-direction:column;
}
.media{                                      /* Bildyta med kvadratisk ratio */
  width:100%; aspect-ratio: 1/1; background:#fafafa; display:flex; align-items:center; justify-content:center;
}
.media img{ max-width:90%; max-height:90%; object-fit:contain; }  /* Bilden skalas in */
.body{ padding:16px; display:flex; flex-direction:column; gap:8px; }
.title{ font-size:16px; font-weight:600; line-height:1.3; min-height:40px; } /* Min-höjd för jämn Höjd */
.priceRow{ display:flex; align-items:baseline; gap:8px; }
.price{ font-size:18px; font-weight:700; }             /* Pris tydligt */
.compare{ font-size:13px; color:#6b7280; text-decoration:line-through; } /* Tidigare pris */

.ctaRow{ margin-top:8px; display:flex; gap:8px; }      /* Knapprad */
button.cta, button.ghost{
  appearance:none; border-radius:999px; padding:10px 14px; cursor:pointer;
  border:1px solid #0b0b0b; font-weight:600; font-size:14px; transition:all .18s ease;
}
button.cta{ background:#0b0b0b; color:#fff; }          /* Primärknapp (svart) */
button.cta:hover{ background:#2a2a2a; transform:translateY(-1px); box-shadow:0 4px 10px rgba(0,0,0,.08); }
button.cta:active{ transform:translateY(0); box-shadow:none; }
button.ghost{ background:transparent; color:#0b0b0b; } /* Sekundärknapp (transparent) */
button.ghost:hover{ background:#f5f5f5; transform:translateY(-1px); }
button.ghost:active{ transform:translateY(0); }

.energy{                                               /* Energisektionen */
  margin-top:10px; padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:#f9fafb;
}
.energy h4{ margin:0 0 6px 0; font-size:12px; font-weight:700; color:#374151; letter-spacing:.02em; text-transform:uppercase; }
.scale{ display:grid; grid-template-columns: repeat(7, 1fr); gap:8px; align-items:end; }

/* Alla grader nedtonade som default, så vi kan lyfta fram den valda */
.gradeWrap{ display:grid; gap:4px; justify-items:center; transition:all .18s ease; opacity:.25; filter:grayscale(60%); }
.gradeWrap .bar{ height:8px; width:100%; border-radius:4px; background:#22c55e; transition:all .18s ease; }
.gradeWrap .mark{ font-size:12px; color:#111827; font-weight:700; transition:all .18s ease; }

/* Den valda energiklassen (A–G) blir tydligare */
.gradeWrap.active{ opacity:1; filter:none; transform:scale(1.03); }
.gradeWrap.active .bar{ height:12px; box-shadow: inset 0 0 0 2px rgba(0,0,0,.05); }
.gradeWrap.active .mark{ text-decoration:underline; font-weight:800; }

/* Färgskala för A–G (grön -> röd) */
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

  /* ===========================================================================
   *                              ENDPOINTS (URL:er)
   *  - HYBRIS_SIMPLE: WP-proxy till shop.samsung.com (löser CORS)
   *  - HYBRIS_DETAIL: direkt mot searchapi.samsung.com (har CORS: *)
   * =========================================================================== */
  const HYBRIS_SIMPLE = (skus) =>
    `/wp-json/samsung/v1/simple?productCodes=${encodeURIComponent(skus.join(','))}`;
  const HYBRIS_DETAIL = (skus) =>
    `https://searchapi.samsung.com/v6/front/b2c/product/card/detail/hybris?siteCode=se&modelList=${encodeURIComponent(skus.join(','))}&saleSkuYN=N&onlyRequestSkuYN=Y`;

  /* ===========================================================================
   *                                 HJÄLPFUNKTIONER
   *  - getByPaths: prova flera tänkbara stigar i ett JSON-objekt
   *  - deepFind:   generisk rekursiv sökning m.h.a. predicate
   * =========================================================================== */

  /**
   * Försök läsa ut ett fält via flera alternativa "paths".
   * Exempel: getByPaths(obj, [['price','formatted'], ['priceDisplay']])
   * @param {object} root - JSON-rot
   * @param {string[][]} paths - lista av nyckelstigar att försöka i ordning
   * @returns {any|null}
   */
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

  /**
   * Rekursiv sökning i ett objekt.
   * @param {any} obj - rot
   * @param {(node:any, path:string[])=>boolean} predicate - villkor
   * @param {string[]} path - används internt för att hålla koll på nyckelstigen
   * @returns {any|null}
   */
  const deepFind = (obj, predicate, path = []) => {
    if (!obj || typeof obj !== 'object') return null;
    if (predicate(obj, path)) return obj;     // Om hela noden matchar
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const r = deepFind(v, predicate, path.concat(k)); // Gå djupare
      if (r) return r;
    }
    return null;
  };

  /* ===========================================================================
   *                 SÖK PRODUKT I DETAIL-SVARET (searchapi)
   *  - Först snabba "kända" vägar (bästa fall)
   *  - Annars generisk traversering
   * =========================================================================== */

  /**
   * Hitta rätt produkt-objekt i DETAIL-svaret för en given SKU.
   * @param {object} detailRes - Rått DETAIL-JSON
   * @param {string} sku
   * @returns {object|null}
   */
  const findDetailProduct = (detailRes, sku) => {
    if (!detailRes) return null;
    // Vanliga stigar i olika varianter av searchapi-svar
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
        if (hit) return hit; // Tidig retur om träff
      }
    }
    // Generisk genomgång om inte hittad
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
    // En del svar kan vara "objekt indexerat på sku"
    if (detailRes[sku] && typeof detailRes[sku] === 'object') return detailRes[sku];
    return null;
  };

  /* ===========================================================================
   *                 SÖK PRODUKT I SIMPLE-SVARET (via WP-proxy)
   *  - Tar höjd för flera datastrukturer
   * =========================================================================== */

  /**
   * Hitta rätt produkt-objekt i SIMPLE-svaret för en given SKU.
   * @param {object} simpleRes - Rått SIMPLE-JSON (kan vara object/array)
   * @param {string} sku
   * @returns {object|null}
   */
  const findSimpleProduct = (simpleRes, sku) => {
    if (!simpleRes) return null;
    // Vanligt: { "SM-...": { ... } }
    if (simpleRes[sku] && typeof simpleRes[sku] === 'object') return simpleRes[sku];

    // Annars leta efter bärare/arr som innehåller produktobjekt
    const carriers = [
      simpleRes,
      getByPaths(simpleRes, [['response','resultData'], ['resultData'], ['data']])
    ].filter(Boolean);

    for (const c of carriers) {
      if (Array.isArray(c)) {
        const hit = c.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
        if (hit) return hit;
      } else if (typeof c === 'object') {
        // Leta efter första array med objekt i
        const arr = deepFind(c, (x)=> Array.isArray(x) && x.some(it => it && typeof it==='object'));
        if (Array.isArray(arr)) {
          const hit = arr.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
          if (hit) return hit;
        }
      }
    }
    return null;
  };

  /* ===========================================================================
   *                         BILDER / URL-HJÄLPARE
   * =========================================================================== */

  /**
   * Prefixa ofullständiga Samsung-URL:er (t.ex. börjar med // eller /is/image/samsung/)
   * @param {string} u
   * @returns {string|null}
   */
  const normalizeImageUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    if (u.startsWith('//')) return 'https:' + u;                 // //images.samsung.com/...
    if (u.startsWith('/is/image/samsung/')) return 'https://images.samsung.com' + u;
    return u;                                                     // redan fullständig
  };

  /**
   * Försök plocka ut en fungerande bild-URL ur produktobjektet.
   * @param {object} o - Produktobjekt
   * @param {string} sku - För debug
   * @returns {string|null}
   */
  const pickImage = (o, sku) => {
    // Vanliga fältnamn för bild/thumbnail
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
    // Kombinera "imagePath" + "imageName" om de finns separat
    const imagePath = getByPaths(o, [['imagePath']]);
    const imageName = getByPaths(o, [['imageName'], ['fileName']]);
    if (imagePath && imageName) {
      const out = normalizeImageUrl(String(imagePath).replace(/\/$/, '') + '/' + String(imageName).replace(/^\//,''));
      if (out) return out;
    }
    // Sista utväg: skanna efter en sträng som "ser ut som" en bild-URL
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

  /**
   * Plocka ut titel/namn (med fallback till SKU)
   */
  const pickTitle = (o, fallbackSku) => {
    const title = getByPaths(o, [
      ['displayName'], ['name'], ['title'], ['modelName'], ['seoName']
    ]);
    return (typeof title === 'string' && title.trim().length > 1) ? title : (fallbackSku || 'Produkt');
  };

  /**
   * Bygg PDP-länk (prefixa domän om det är relativ URL)
   */
  const pickPdpUrl = (o) => {
    const url = getByPaths(o, [
      ['pdpUrl'], ['canonicalUrl'], ['url'], ['detailUrl']
    ]);
    if (typeof url === 'string') {
      if (/^https?:\/\//.test(url)) return url;             // absolut URL
      if (url.startsWith('/')) return 'https://www.samsung.com' + url; // relativ -> absolut
    }
    return '#'; // Okänd
  };

  /* ===========================================================================
   *                           ENERGI / PDF-HANTERING
   * =========================================================================== */

  /** Normalisera "B" från t.ex. "badge-energy-label__badge--b" eller "Class B" */
  const coerceGrade = (s) => {
    if (!s) return null;
    const m = String(s).trim().match(/([A-G])/i);
    return m ? m[1].toUpperCase() : null;
  };

  /** Leta efter energiklass i attributlistor */
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

  /** Sista fallback för PDF-länk: "gissa" URL enligt mönster */
  const energyPdfUrlGuess = (sku, locale) => {
    const lower = String(sku||'').toLowerCase();
    const locs = [locale||'se','eu','uk'];
    return locs.map(l =>
      `https://images.samsung.com/is/content/samsung/p6/common/energylabel/${l}-energylabel-${lower}-energylabel.pdf`
    );
  };

  /**
   * Extrahera energiklass + relaterade PDF:er och metadata.
   * @param {object} o - Produktdetalj/Simple-objekt
   * @param {string} sku
   * @param {string} locale
   */
  const pickEnergy = (o, sku, locale) => {
    // 1) Försök hitta grad direkt i kända fält
    const direct = getByPaths(o, [
      ['energyLabelGrade'],
      ['energyGrade'], ['energyClass'], ['energyEfficiencyClass'],
      ['euEnergyGrade'], ['euEnergyClass'],
      ['energy','grade'], ['energyLabel','grade'], ['euEnergy','grade']
    ]);
    let grade = coerceGrade(direct);

    // 2) Ibland finns klass i CSS‑klass-sträng, t.ex. "badge--b"
    if (!grade) {
      const cls = getByPaths(o, [['energyLabelClass1'], ['energyLabelClass2']]);
      if (typeof cls === 'string') {
        const m = cls.match(/badge--([a-g])/i);
        if (m) grade = m[1].toUpperCase();
      }
    }

    // 3) Sök i attribut/spec-listor
    if (!grade) {
      const attrs = getByPaths(o, [['attributes'], ['specs'], ['specifications'], ['keySpecs'], ['badges']]);
      grade = extractGradeFromAttributes(attrs);
    }

    // 4) Sista "hint": försök tolka från gissad PDF-URL
    if (!grade) {
      const pdfGuess = energyPdfUrlGuess(sku, locale);
      for (const url of pdfGuess) {
        const m = url.match(/-([a-g])-(?:[^/]+)?energylabel\.pdf$/i);
        if (m) { grade = m[1].toUpperCase(); break; }
      }
    }

    // 5) Heltext-sökning efter "Class X" m.m.
    if (!grade) {
      const anyText = deepFind(o, (node, path) => {
        if (typeof node !== 'string') return false;
        const last = (path[path.length-1] || '').toLowerCase();
        return /energy|efficiency|eu.?energy|label/.test(last) && /class\s*[A-G]/i.test(node);
      });
      grade = coerceGrade(anyText);
    }

    // 6) PDF-länkar direkt från API om de finns
    const energyFileUrl = getByPaths(o, [['energyFileUrl'], ['euEnergyLabelUrl'], ['energyLabel','url']]);
    const ficheFileUrl  = getByPaths(o, [['ficheFileUrl'], ['productFicheUrl']]);

    // 7) Övriga nyckel-värden som kan vara intressanta att visa
    const battery = deepFind(o, (x,p)=> typeof x==='string' && /\d+h/.test(x) && /battery|hours|playback|endurance/i.test((p[p.length-1]||'')));
    const ip = deepFind(o, (x)=> typeof x==='string' && /^IP\d{2}/.test(x));
    const drops = deepFind(o, (x,p)=> (typeof x==='string'||typeof x==='number') && /drop|drops|fall/i.test((p[p.length-1]||'')));

    // 8) Sätt ihop PDF-listan: API först, sedan fallback
    const pdfs = [];
    if (typeof energyFileUrl === 'string') pdfs.push(energyFileUrl);
    if (typeof ficheFileUrl === 'string')  pdfs.push(ficheFileUrl);
    if (pdfs.length === 0) pdfs.push(...energyPdfUrlGuess(sku, locale));

    return {
      grade: grade || null,
      battery: typeof battery==='string'?battery:null,
      ip: typeof ip==='string'?ip:null,
      drops: (typeof drops==='string'||typeof drops==='number')?String(drops):null,
      pdfs
    };
  };

  /* ===========================================================================
   *                                   PRIS
   *  - Hämtar "formatted" först, annars numeriskt värde + formatterar
   * =========================================================================== */
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

    // Sista försök: leta sträng som ser ut som "9 990 kr"
    const match = deepFind(o, (node) => {
      if (typeof node !== 'string') return false;
      return /(?:\d{1,3}([ .]\d{3})*|\d+)[,\.]\d{2}\s?(kr|SEK)/i.test(node);
    });
    if (typeof match === 'string') return { formatted: match };

    return null;
  };

  /** Lista/pris före rabatt etc. (om det finns) */
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

  /** Formatera numeriskt pris till "sv-SE" eller returnera given "formatted" */
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

  /* ===========================================================================
   *                              PER-SIDA CACHE
   *  - Liten in-memory cache så flera komponenter med samma SKU-set
   *    inte hämtar samma data flera gånger under sidans livslängd
   * =========================================================================== */
  const CACHE = {
    simple: new Map(), // key = "SKU1,SKU2,SKU3"
    detail: new Map(),
  };

  /* ===========================================================================
   *                          WEB COMPONENT: <samsung-product-cards>
   * =========================================================================== */
  class SamsungProductCards extends HTMLElement {
    /** Vilka attribut ska trigga attributeChangedCallback */
    static get observedAttributes(){ return ['data-skus','data-locale']; }

    constructor(){
      super();

      // 1) Skapa Shadow Root så stilar/markup kapslas in
      this.attachShadow({mode:'open'});

      // 2) Rot-element för kortens grid
      this.root = document.createElement('div');
      this.root.className = 'wrapper';

      // 3) Lägg in CSS:en i en <style> i Shadow DOM
      const style = document.createElement('style');
      style.textContent = STYLE;
      this.shadowRoot.append(style, this.root);

      // 4) Initiera state från attribut
      this.locale = (this.getAttribute('data-locale')||'se').toLowerCase();
      this.skus = (this.getAttribute('data-skus')||'').split(',').map(s=>s.trim()).filter(Boolean);

      // 5) Förhindra dubbla fetch:ar om attribut uppdateras snabbt
      this._loadTimer = null;      // används för "coalescing" (samla ändringar)
      this._abort = null;          // AbortController för att kunna avbryta fetch

      // 6) Visa "skeleton" direkt (bättre perceived performance)
      this._renderSkeleton();
    }

    /**
     * Körs när observerade attribut ändras (t.ex. när man byter SKU-lista).
     * Vi uppdaterar state och schemalägger en ny "load()" (coalesced).
     */
    attributeChangedCallback(name, oldV, newV){
      if (name === 'data-skus'){
        this.skus = (newV||'').split(',').map(s=>s.trim()).filter(Boolean);
      }
      if (name === 'data-locale'){
        this.locale = (newV||'se').toLowerCase();
      }
      this._scheduleLoad(); // Vänta mikro-tick och kör load() en gång
    }

    /** När elementet sätts in i DOM:en första gången */
    connectedCallback(){
      this._scheduleLoad();
    }

    /**
     * Samla flera attribut-ändringar innan vi hämtar data (coalescing).
     * Bra om någon sätter både data-skus och data-locale i snabb följd.
     */
    _scheduleLoad(){
      if (this._loadTimer) clearTimeout(this._loadTimer);
      this._loadTimer = setTimeout(() => {
        this._loadTimer = null;
        this.load();
      }, 0); // Kan ökas (t.ex. 50ms) om du vill slå ihop fler ändringar
    }

    /**
     * Huvudflödet: hämta SIMPLE + DETAIL, matcha på SKU, bygg visningsmodeller och rendera.
     */
    async load(){
      // 1) Validera att vi har SKU:er
      if (!this.skus || this.skus.length===0){
        this.root.innerHTML = `<div class="err">Inga SKU:er angivna. Lägg till attributet <code>data-skus</code>.</div>`;
        return;
      }

      // 2) Visa skeleton medan vi hämtar
      this._renderSkeleton();

      // 3) Avbryt pågående begäran om det sker en ny "load"
      if (this._abort) this._abort.abort();
      this._abort = new AbortController();

      // 4) Läs ev. overrides från sidan (JSON i <script data-samsung-product-overrides>)
      const overridesEl = document.querySelector('script[data-samsung-product-overrides][type="application/json"]');
      let overrides = {};
      if (overridesEl){
        try{ overrides = JSON.parse(overridesEl.textContent||'{}'); } catch {}
      }

      // 5) Cache-nyckel (hela SKU-listan i en sträng)
      const key = this.skus.join(',');

      try{
        // 6) SIMPLE: hämta från cache eller fetch -> cache
        const simplePromise = (CACHE.simple.has(key))
          ? Promise.resolve(CACHE.simple.get(key))
          : fetch(HYBRIS_SIMPLE(this.skus), { signal:this._abort.signal, credentials:'omit' })
              .then(r=>r.json())
              .then(json => { CACHE.simple.set(key, json); return json; });

        // 7) DETAIL: samma sak
        const detailPromise = (CACHE.detail.has(key))
          ? Promise.resolve(CACHE.detail.get(key))
          : fetch(HYBRIS_DETAIL(this.skus), { signal:this._abort.signal, credentials:'omit' })
              .then(r=>r.json())
              .then(json => { CACHE.detail.set(key, json); return json; });

        // 8) Kör båda parallellt. Promise.allSettled för att vi ska få ut det som funkar.
        const [simple, detail] = await Promise.allSettled([simplePromise, detailPromise]).then(
          results => results.map(r => r.status === 'fulfilled' ? r.value : null)
        );

        // 9) Debug-loggar om aktiverat
        if (window.__cardsDebug) {
          console.log('HYBRIS simple:', simple);
          console.log('HYBRIS detail:', detail);
        }

        // 10) Bygg listan av "presentations-objekt" i samma ordning som SKU:erna
        const results = this.skus.map(sku => {
          const detailItem = findDetailProduct(detail, sku) || {};
          const simpleItem = findSimpleProduct(simple, sku) || {};

          // Titel/Bild/PDP-länk
          const title = (overrides[sku]?.title) || pickTitle(detailItem, sku);
          const image = (overrides[sku]?.image) || pickImage(detailItem, sku) || pickImage(simpleItem, sku) || '';
          const pdpUrl= (overrides[sku]?.url)   || pickPdpUrl(detailItem) || pickPdpUrl(simpleItem) || '#';

          // Pris: försök simpel först (brukar vara mest pålitlig), annars detail
          const pricePrimary = overrides[sku]?.price || pickPrice(simpleItem) || pickPrice(detailItem);
          const listPrice    = overrides[sku]?.listPrice || pickListPrice(simpleItem) || pickListPrice(detailItem);

          // Energi
          const energyFromApi = pickEnergy(detailItem || simpleItem || {}, sku, this.locale);
          const energyGrade = (overrides[sku]?.energyGrade || energyFromApi.grade || '').toUpperCase();
          const battery = overrides[sku]?.battery || energyFromApi.battery || null;
          const ip      = overrides[sku]?.ip || energyFromApi.ip || null;
          const drops   = overrides[sku]?.drops || energyFromApi.drops || null;
          const pdfs    = (energyFromApi.pdfs && energyFromApi.pdfs.length ? energyFromApi.pdfs : []);

          // Extra debug per SKU
          if (window.__cardsDebug) {
            console.log('SKU', sku, { title, image, pdpUrl, pricePrimary, listPrice, energyGrade, pdfs });
          }

          // Returnera färdig "view model"
          return {
            sku, title, image, pdpUrl,
            priceText: formatPrice(pricePrimary),
            listPriceText: listPrice ? formatPrice(listPrice) : null,
            energy: { grade: /^[A-G]$/.test(energyGrade) ? energyGrade : null, battery, ip, drops, pdfs }
          };
        });

        // 11) Rendera korten
        this._renderCards(results);
      } catch (e){
        // Om vi avbrytit en fetch (t.ex. p.g.a. ny load) – ignorera
        if (e?.name === 'AbortError') return;

        // Annars visa ett felmeddelande i UI
        this.root.innerHTML = `<div class="err">Kunde inte hämta produktdata just nu. Kontrollera proxy/CORS eller nätverk. (${e?.message||e})</div>`;
      }
    }

    /**
     * Visa "skeleton"-kort (laddnings-state) – en per SKU (minst 1)
     */
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

    /**
     * Bygg upp alla produktkort i DOM:en utifrån "presentations-objekten".
     * @param {Array} items - resultatlista i samma ordning som SKU:erna
     */
    _renderCards(items){
      this.root.innerHTML = '';
      items.forEach(p=>{
        // Kortets container
        const card = document.createElement('div'); card.className='card';

        // Bildyta (visar skeleton om bild saknas)
        const media = document.createElement('div'); media.className='media';
        media.innerHTML = p.image ? `<img loading="lazy" src="${p.image}" alt="${this._esc(p.title)}">` : `<div class="skeleton" style="width:100%;height:100%"></div>`;

        // Text-kropp
        const body = document.createElement('div'); body.className='body';

        // Titel
        const title = document.createElement('div'); title.className='title'; title.textContent = p.title;

        // Prisraden (nuvarande pris + ev. jämförelsepris)
        const priceRow = document.createElement('div'); priceRow.className='priceRow';
        const price = document.createElement('div'); price.className='price'; price.textContent = p.priceText || '—';
        priceRow.appendChild(price);
        if (p.listPriceText && p.listPriceText !== p.priceText){
          const cmp = document.createElement('div'); cmp.className='compare'; cmp.textContent = p.listPriceText;
          priceRow.appendChild(cmp);
        }

        // Energisektionen
        const energy = this._renderEnergy(p.energy, p.sku);

        // CTA-raden (knappar)
        const ctaRow = document.createElement('div'); ctaRow.className='ctaRow';

        // "Visa produkt" – öppna PDP i ny flik om vi har länk
        const btn = document.createElement('button'); btn.type='button'; btn.className='cta'; btn.textContent='Visa produkt';
        btn.addEventListener('click', ()=>{
          if (p.pdpUrl && p.pdpUrl !== '#') {
            window.open(p.pdpUrl, '_blank', 'noopener');
          }
        });

        // "Kopiera länk" – kopiera PDP-URL (fallback till aktuell sida)
        const share = document.createElement('button'); share.type='button'; share.className='ghost'; share.textContent='Kopiera länk';
        share.addEventListener('click', async ()=>{
          try{
            await navigator.clipboard.writeText(p.pdpUrl || location.href);
            share.textContent='Kopierad!';
            setTimeout(()=>share.textContent='Kopiera länk', 1500);
          }catch{
            // Om kopiering misslyckas gör inget större väsen (hålla UI tyst)
          }
        });

        ctaRow.append(btn, share);

        // Bygg ihop kortets DOM
        body.append(title, priceRow, energy, ctaRow);
        card.append(media, body);
        this.root.appendChild(card);
      });
    }

    /**
     * Bygg energisektionen: A–G skala + nyckelvärden + PDF-länkar
     * @param {object} energy - { grade, battery, ip, drops, pdfs[] }
     * @param {string} sku
     */
    _renderEnergy(energy, sku){
      const box = document.createElement('div'); box.className='energy';

      // Rubrik
      const h = document.createElement('h4'); h.textContent='Energimärkning (EU)';

      // Skalan (A–G)
      const scale = document.createElement('div'); scale.className='scale';
      const classes = ['A','B','C','D','E','F','G'];
      classes.forEach(letter=>{
        const wrap = document.createElement('div');
        // Endast aktuell klass får .active (gör den tydligare)
        wrap.className = 'gradeWrap' + (energy.grade && letter===energy.grade ? ' active' : '');
        const bar = document.createElement('div'); bar.className='bar ' + letter.toLowerCase();
        const mark = document.createElement('div'); mark.className='mark'; mark.textContent=letter;
        wrap.append(bar, mark);
        scale.appendChild(wrap);
      });

      // Nyckel-värden (om de finns)
      const details = document.createElement('div'); details.className='energyRow';
      if (energy.grade) details.appendChild(this._kv('Klass', energy.grade));
      if (energy.battery) details.appendChild(this._kv('Batteritid', energy.battery));
      if (energy.ip) details.appendChild(this._kv('IP‑klass', energy.ip));
      if (energy.drops) details.appendChild(this._kv('Tålighet', `${energy.drops} drops`));

      // PDF-länkar (etikett + produktblad)
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
      // Om inget från API: gissa URL baserat på SKU/locale
      if ((!energy.pdfs || energy.pdfs.length===0) && sku) {
        const guess = `https://images.samsung.com/is/content/samsung/p6/common/energylabel/${(this.locale||'se')}-energylabel-${sku.toLowerCase()}-energylabel.pdf`;
        const a = document.createElement('a');
        a.className='pdfLink'; a.href = guess; a.target='_blank'; a.rel='noopener noreferrer';
        a.textContent = 'Energietikett (PDF)';
        pdfRow.appendChild(a);
      }
      if (pdfRow.children.length) details.appendChild(pdfRow);

      // Slutlig sammansättning av energisektionen
      box.append(h, scale, details);
      return box;
    }

    /** Bygg en liten "Nyckel: Värde"-tagg */
    _kv(k,v){
      const el = document.createElement('div'); el.className='kv'; el.textContent = `${k}: ${v}`;
      return el;
    }

    /** HTML-escape för att undvika att t.ex. titlar kan injicera HTML */
    _esc(s){
      return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }
  }

  /* ===========================================================================
   *            Registrera komponenten om den inte redan finns i sidan
   * =========================================================================== */
  if (!customElements.get('samsung-product-cards')) {
    customElements.define('samsung-product-cards', SamsungProductCards);
  }
})();
