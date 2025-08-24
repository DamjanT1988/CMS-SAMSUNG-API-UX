/**
 * Samsung Product Cards — v1.3.7 (SE)
 * =============================================================================
 * VAD ÄR DETTA?
 * -----------------------------------------------------------------------------
 * Ett fristående (stand‑alone) Web Component som du kan bädda in var som helst
 * i ett CMS (WordPress/AEM etc). Det renderar responsiva “produktkort” för
 * Samsung‑produkter (t.ex. Galaxy S25‑serien) med:
 *   • Titel/namn
 *   • Bild (hämtas från DETAIL‑endpoint)
 *   • Pris + ev. jämförelsepris (hämtas primärt från SIMPLE via din WP‑proxy)
 *   • EU‑energimärkning (klass A–G) + länkar till PDF:er (etikett/fiche)
 *   • CTA‑knappar (Visa produkt i ny flik, Kopiera länk)
 *
 * KOMPATIBILITET
 * -----------------------------------------------------------------------------
 *  • Kräver inga externa JS‑ramverk (ingen React/Vue etc).
 *  • Bygger UI med ren DOM (Shadow DOM för kapslade stilar).
 *  • Fungerar i moderna webbläsare (Chrome/Edge/Firefox/Safari).
 *
 * HUR ANVÄNDS DET?
 * -----------------------------------------------------------------------------
 * 1) Se till att denna fil laddas in exakt EN gång på sidan.
 *    – I WordPress: enqueua skriptet via functions.php/plugins (footer = true).
 * 2) Lägg in följande HTML där du vill visa korten:
 *      <samsung-product-cards
 *        data-skus="SM-S931BLBDEUB,SM-S937BLBDEUB,SM-S936BDBDEUB"
 *        data-locale="se"></samsung-product-cards>
 *    – “data-skus” tar en kommaseparerad lista av SKU:er (ordning bevaras).
 *    – “data-locale” används för att gissa fallback‑PDF‑URL om API saknar länk.
 * 3) (Valfritt) Sidlokala overrides:
 *      <script type="application/json" data-samsung-product-overrides>
 *        { "SM-S931BLBDEUB": { "title":"Min titel", "url":"https://..." } }
 *      </script>
 *
 * NÄTVERK OCH CORS
 * -----------------------------------------------------------------------------
 *  • SIMPLE‑endpoint (pris) på shop.samsung.com har CORS‑begränsningar.
 *    – Löses via WP‑proxy (REST‑route) på din domän: /wp-json/samsung/v1/simple
 *  • DETAIL‑endpoint (searchapi.samsung.com) har “access-control-allow-origin:*”
 *    – Kan anropas direkt från klienten.
 *
 * STRATEGI FÖR DATA
 * -----------------------------------------------------------------------------
 *  • Bild/Titel/URL: Prefererar DETAIL (stabilt/rikt fält), fallback till SIMPLE.
 *  • Pris: Prefererar SIMPLE (prisfält ofta tydliga), fallback till DETAIL.
 *  • Energi: Hämtas ur DETAIL om möjligt (energyLabelGrade m.m.); annars heuristik
 *    + PDF‑URL från API eller gissad URL som sista utväg.
 *
 * PRESTANDA
 * -----------------------------------------------------------------------------
 *  • Coalescing av attributändringar (data-skus/data-locale) för att undvika
 *    onödiga fetch‑anrop.
 *  • AbortController: avbryter pågående fetch om ny lastning triggas.
 *  • In‑memory per‑sida cache (Map) för SIMPLE/DETAIL svar (nyttigt när flera
 *    komponenter på samma sida använder samma SKU‑set).
 *
 * DEBUG
 * -----------------------------------------------------------------------------
 *  • Sätt i konsolen: window.__cardsDebug = true;
 *    – Skriver ut råa svar + sammanfattningar per SKU.
 *
 * VIKTIGT VID FEL
 * -----------------------------------------------------------------------------
 *  • Om korten inte visar pris: kontrollera att WP‑proxy svarar 200 (och inte
 *    blockeras av cache/CDN). Testa direkt: /wp-json/samsung/v1/simple?productCodes=...
 *  • Om bilder saknas: kontrollera att DETAIL svarar och att bild‑URL normaliseras
 *    (börja med //images.samsung.com eller /is/image/samsung/...).
 *  • BOM/headers‑varningar i WP‑PHP? Spara PHP‑filer som UTF‑8 utan BOM och se
 *    till att inga “echo”/whitespace skrivs före header‑ändringar.
 * =============================================================================
 */
(() => {
  /* ===========================================================================
   *                                STYLES (CSS)
   * ---------------------------------------------------------------------------
   *  • Ligger i Shadow DOM → krockar inte med WordPress/Themes globala CSS.
   *  • “system‑font stack” för säker rendering (kan bytas till SamsungOne om
   *    den finns globalt laddad via @font-face i sajten).
   * =========================================================================== */
  const STYLE = `
:host { all: initial; }                 /* Isolera komponenten från sidans CSS‑arv */
* { box-sizing: border-box; }           /* Räkna border/padding in i width/height */

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
.media{
  /* Kvadratisk bildyta som håller proportioner bra för produktfoton */
  width:100%; aspect-ratio: 1/1; background:#fafafa; display:flex; align-items:center; justify-content:center;
}
.media img{ max-width:90%; max-height:90%; object-fit:contain; }  /* Skala in utan att beskäras */
.body{ padding:16px; display:flex; flex-direction:column; gap:8px; }
.title{ font-size:16px; font-weight:600; line-height:1.3; min-height:40px; } /* Min‑höjd ger stabila korthöjder */
.priceRow{ display:flex; align-items:baseline; gap:8px; }
.price{ font-size:18px; font-weight:700; }
.compare{ font-size:13px; color:#6b7280; text-decoration:line-through; } /* Jämförpris/was‑price */

.ctaRow{ margin-top:8px; display:flex; gap:8px; } /* Knapprad under innehållet */
button.cta, button.ghost{
  /* Grundknapp: runda piller, lätt hover/active animationer för taktil känsla */
  appearance:none; border-radius:999px; padding:10px 14px; cursor:pointer;
  border:1px solid #0b0b0b; font-weight:600; font-size:14px; transition:all .18s ease;
}
button.cta{ background:#0b0b0b; color:#fff; } /* Primärknapp (svart) */
button.cta:hover{ background:#2a2a2a; transform:translateY(-1px); box-shadow:0 4px 10px rgba(0,0,0,.08); }
button.cta:active{ transform:translateY(0); box-shadow:none; }
button.ghost{ background:transparent; color:#0b0b0b; } /* Sekundärknapp (outlined) */
button.ghost:hover{ background:#f5f5f5; transform:translateY(-1px); }
button.ghost:active{ transform:translateY(0); }

.energy{
  /* Energisektionen får en subtil panelstil */
  margin-top:10px; padding:12px; border-radius:12px; border:1px solid #e5e7eb; background:#f9fafb;
}
.energy h4{ margin:0 0 6px 0; font-size:12px; font-weight:700; color:#374151; letter-spacing:.02em; text-transform:uppercase; }
.scale{ display:grid; grid-template-columns: repeat(7, 1fr); gap:8px; align-items:end; }

/* Alla energiklasser är nedtonade som default (opacity + grayscale),
   så att vi kan lyfta fram den valda med .active nedan */
.gradeWrap{ display:grid; gap:4px; justify-items:center; transition:all .18s ease; opacity:.25; filter:grayscale(60%); }
.gradeWrap .bar{ height:8px; width:100%; border-radius:4px; background:#22c55e; transition:all .18s ease; }
.gradeWrap .mark{ font-size:12px; color:#111827; font-weight:700; transition:all .18s ease; }

/* Markerad energiklass (den “relevanta” för produkten) */
.gradeWrap.active{ opacity:1; filter:none; transform:scale(1.03); }
.gradeWrap.active .bar{ height:12px; box-shadow: inset 0 0 0 2px rgba(0,0,0,.05); }
.gradeWrap.active .mark{ text-decoration:underline; font-weight:800; }

/* Färgskala A–G (grön → röd). “.bar.a” lämnas grön som default ovan. */
.bar.b{ background:#84cc16; }
.bar.c{ background:#a3e635; }
.bar.d{ background:#facc15; }
.bar.e{ background:#fb923c; }
.bar.f{ background:#f97316; }
.bar.g{ background:#ef4444; }

.energyRow{ display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-top:8px; }
.kv{ font-size:12px; color:#374151; background:#fff; border:1px solid #e5e7eb; padding:6px 8px; border-radius:8px; }
.pdfRow{ margin-left:auto; display:flex; gap:12px; align-items:center; } /* PDF-länkar trycks till höger */
.pdfLink{ font-size:12px; text-decoration:none; color:#0b0b0b; border-bottom:1px dotted #0b0b0b; }

.skeleton{ background:linear-gradient(90deg, #f4f4f5, #ffffff, #f4f4f5); background-size:200% 100%; animation:s 1.2s ease-in-out infinite; }
@keyframes s{ 0%{background-position:200% 0} 100%{background-position:-200% 0} }
.media.skeleton{ aspect-ratio:1/1; } /* Skelettet håller samma höjd som bildytan */
.title.skeleton{ height:18px; width:70%; border-radius:6px; }
.price.skeleton{ height:16px; width:40%; border-radius:6px; }

.err{ border:1px dashed #ef4444; background:#fff7f7; color:#991b1b; padding:10px; border-radius:12px; font-size:13px; }
  `;

  /* ===========================================================================
   *                              ENDPOINTS (URL:er)
   * ---------------------------------------------------------------------------
   *  • HYBRIS_SIMPLE: Din WP‑proxy (måste implementeras server‑side i WP).
   *  • HYBRIS_DETAIL: Offentligt CORS‑öppet API (kan hämtas direkt i klienten).
   *  • OBS: Vi encodar SKU‑listan (join(',')) så att specialtecken blir säkra.
   * =========================================================================== */
  const HYBRIS_SIMPLE = (skus) =>
    `/wp-json/samsung/v1/simple?productCodes=${encodeURIComponent(skus.join(','))}`;
  const HYBRIS_DETAIL = (skus) =>
    `https://searchapi.samsung.com/v6/front/b2c/product/card/detail/hybris?siteCode=se&modelList=${encodeURIComponent(skus.join(','))}&saleSkuYN=N&onlyRequestSkuYN=Y`;

  /* ===========================================================================
   *                            HJÄLPFUNKTIONER (UTILS)
   * =========================================================================== */

  /**
   * Läs ut ett värde via flera alternativa nyckelstigar.
   * – Många “Hybris/searchapi”‑svar kan variera lite beroende på konfiguration/land.
   * – Därför testar vi flera path‑varianter i prio‑ordning.
   *
   * @template T
   * @param {Record<string, any>} root  Rotobjekt (kan vara nested)
   * @param {string[][]} paths          Lista av path:er (t.ex. [ ['price','formatted'], ['priceDisplay'] ])
   * @returns {T|null}                  Första hittade värdet eller null
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
   * Generisk djupsökning i ett objekt (DFS).
   * – Används när vi inte säkert vet var ett fält ligger (t.ex. bild‑URL).
   * – predicate får både aktuell nod och path dit (array av nycklar).
   *
   * @param {any} obj
   * @param {(node:any, path:string[])=>boolean} predicate
   * @param {string[]} [path=[]]
   * @returns {any|null}
   */
  const deepFind = (obj, predicate, path = []) => {
    if (!obj || typeof obj !== 'object') return null;
    if (predicate(obj, path)) return obj;              // matcha hela noden
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      const r = deepFind(v, predicate, path.concat(k)); // sök rekursivt
      if (r) return r;
    }
    return null;
  };

  /* ===========================================================================
   *                   HÄMTA PRODUKT I DETAIL‑SVAR (SEARCHAPI)
   *  – Försök via kända liststigar först (snabbt).
   *  – Annars fall tillbaka till generisk traversal (robust).
   * =========================================================================== */
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
        // Matcha på några tänkbara fältnamn (sku/modelCode/code)
        const hit = list.find(p => (p?.sku===sku) || (p?.modelCode===sku) || (p?.code===sku));
        if (hit) return hit;
      }
    }
    // Generisk DFS‑genomgång som sista “säkert kort”
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
    // Vissa svar kan vara “objekt indexerat på SKU”
    if (detailRes[sku] && typeof detailRes[sku] === 'object') return detailRes[sku];
    return null;
  };

  /* ===========================================================================
   *                   HÄMTA PRODUKT I SIMPLE‑SVAR (WP‑PROXY)
   *  – SIMPLE kan komma som { "<SKU>": {...} } eller andra strukturer.
   *  – Vi försöker först direkt, sedan letar vi efter första rimliga array.
   * =========================================================================== */
  const findSimpleProduct = (simpleRes, sku) => {
    if (!simpleRes) return null;

    // Vanligast: Object med SKU som toppnyckel
    if (simpleRes[sku] && typeof simpleRes[sku] === 'object') return simpleRes[sku];

    // Annars sök efter tänkbara bärare
    const carriers = [
      simpleRes,
      getByPaths(simpleRes, [['response','resultData'], ['resultData'], ['data']])
    ].filter(Boolean);

    for (const c of carriers) {
      if (Array.isArray(c)) {
        const hit = c.find(p => p?.sku===sku || p?.modelCode===sku || p?.code===sku || p?.productCode===sku);
        if (hit) return hit;
      } else if (typeof c === 'object') {
        // Leta efter första array med produktobjekt i
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
   *                         BILD‑ OCH URL‑HJÄLPARE
   * =========================================================================== */

  /**
   * Normalisera ofullständiga Samsung‑URL:er för bilder.
   *  – //images.samsung.com/...  → lägg på https:
   *  – /is/image/samsung/...     → prefixa https://images.samsung.com
   */
  const normalizeImageUrl = (u) => {
    if (!u || typeof u !== 'string') return null;
    if (u.startsWith('//')) return 'https:' + u;
    if (u.startsWith('/is/image/samsung/')) return 'https://images.samsung.com' + u;
    return u;
  };

  /**
   * Försök hitta en fungerande bild‑URL i produktobjektet.
   * – Testar flera kända fält.
   * – Testar också kombination imagePath+imageName.
   * – Sista utvägen: heuristisk textsökning efter en sträng som ser ut som en bild‑URL.
   */
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

  /** Titel med fallback till SKU om allt annat fallerar */
  const pickTitle = (o, fallbackSku) => {
    const title = getByPaths(o, [
      ['displayName'], ['name'], ['title'], ['modelName'], ['seoName']
    ]);
    return (typeof title === 'string' && title.trim().length > 1) ? title : (fallbackSku || 'Produkt');
  };

  /** PDP‑URL – om relativ länk, prefixa Samsung‑domänen */
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

  /* ===========================================================================
   *                           ENERGI / PDF‑EXTRAKTION
   * =========================================================================== */

  /** Plocka ut “B” ur t.ex. “badge-energy-label__badge--b”, “Class B”, “B” etc. */
  const coerceGrade = (s) => {
    if (!s) return null;
    const m = String(s).trim().match(/([A-G])/i);
    return m ? m[1].toUpperCase() : null;
  };

  /** Sök energiklass i attributlistor (olika API:er kallar dessa lite olika) */
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

  /** Gissa energietikettens PDF‑URL om API saknar direktlänk (sista fallback) */
  const energyPdfUrlGuess = (sku, locale) => {
    const lower = String(sku||'').toLowerCase();
    const locs = [locale||'se','eu','uk'];
    return locs.map(l =>
      `https://images.samsung.com/is/content/samsung/p6/common/energylabel/${l}-energylabel-${lower}-energylabel.pdf`
    );
  };

  /**
   * Extrahera energiklass + etikett/fiche PDF + lite relaterad metadata (IP‑klass, batteri etc).
   * – Detaljer försöks hämtas från DETAIL först; annars heuristik.
   */
  const pickEnergy = (o, sku, locale) => {
    // 1) Försök hitta grad i kända fält
    const direct = getByPaths(o, [
      ['energyLabelGrade'],
      ['energyGrade'], ['energyClass'], ['energyEfficiencyClass'],
      ['euEnergyGrade'], ['euEnergyClass'],
      ['energy','grade'], ['energyLabel','grade'], ['euEnergy','grade']
    ]);
    let grade = coerceGrade(direct);

    // 2) CSS‑klasssträng kan innehålla “badge--b” etc.
    if (!grade) {
      const cls = getByPaths(o, [['energyLabelClass1'], ['energyLabelClass2']]);
      if (typeof cls === 'string') {
        const m = cls.match(/badge--([a-g])/i);
        if (m) grade = m[1].toUpperCase();
      }
    }

    // 3) Attribut/specs kan ibland ha energiklass som text
    if (!grade) {
      const attrs = getByPaths(o, [['attributes'], ['specs'], ['specifications'], ['keySpecs'], ['badges']]);
      grade = extractGradeFromAttributes(attrs);
    }

    // 4) Hint via gissad PDF‑URL (om den råkar innehålla klassbokstaven)
    if (!grade) {
      const pdfGuess = energyPdfUrlGuess(sku, locale);
      for (const url of pdfGuess) {
        const m = url.match(/-([a-g])-(?:[^/]+)?energylabel\.pdf$/i);
        if (m) { grade = m[1].toUpperCase(); break; }
      }
    }

    // 5) Sista steg: rå textsök där nycklar antyder energi‑info
    if (!grade) {
      const anyText = deepFind(o, (node, path) => {
        if (typeof node !== 'string') return false;
        const last = (path[path.length-1] || '').toLowerCase();
        return /energy|efficiency|eu.?energy|label/.test(last) && /class\s*[A-G]/i.test(node);
      });
      grade = coerceGrade(anyText);
    }

    // 6) PDF‑länkar direkt från API om de finns
    const energyFileUrl = getByPaths(o, [['energyFileUrl'], ['euEnergyLabelUrl'], ['energyLabel','url']]);
    const ficheFileUrl  = getByPaths(o, [['ficheFileUrl'], ['productFicheUrl']]);

    // 7) Små bonusar (visas i nyckel‑tags om vi hittar dem)
    const battery = deepFind(o, (x,p)=> typeof x==='string' && /\d+h/.test(x) && /battery|hours|playback|endurance/i.test((p[p.length-1]||'')));
    const ip = deepFind(o, (x)=> typeof x==='string' && /^IP\d{2}/.test(x));
    const drops = deepFind(o, (x,p)=> (typeof x==='string'||typeof x==='number') && /drop|drops|fall/i.test((p[p.length-1]||'')));

    // 8) Bygg PDF‑listan: API‑länkar först; saknas de, använd fallback‑gissning
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
   *  – Försök först hitta “formatted” (t.ex. “9 990 kr”), annars numeriskt värde.
   *  – Om numeriskt: formatera enligt “sv-SE” och SEK.
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

    // Sista chans: leta efter en text som “ser ut som” ett pris (med kr/SEK)
    const match = deepFind(o, (node) => {
      if (typeof node !== 'string') return false;
      return /(?:\d{1,3}([ .]\d{3})*|\d+)[,\.]\d{2}\s?(kr|SEK)/i.test(node);
    });
    if (typeof match === 'string') return { formatted: match };

    return null;
  };

  /** List/was‑price (om tillgängligt) – används som överstruket jämförelsepris */
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

  /** Formattera numeriskt pris → “sv-SE” valuta; annars '—' */
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
   *                              PER‑SIDA CACHE
   *  – Liten in‑memory cache (Map) för att slippa dubbelfetch vid flera
   *    komponenter med samma SKU‑lista.
   * =========================================================================== */
  const CACHE = {
    simple: new Map(), // key = "SKU1,SKU2,SKU3"
    detail: new Map(),
  };

  /* ===========================================================================
   *                  WEB COMPONENT: <samsung-product-cards>
   * =========================================================================== */
  class SamsungProductCards extends HTMLElement {
    /** Talar om vilka attribut vi vill observera för förändringar */
    static get observedAttributes(){ return ['data-skus','data-locale']; }

    constructor(){
      super();

      // 1) Skapa Shadow Root så CSS och markup kapslas in (ingen stil‑läckage)
      this.attachShadow({mode:'open'});

      // 2) Skapa wrapper‑elementet som håller i alla kort (grid)
      this.root = document.createElement('div');
      this.root.className = 'wrapper';

      // 3) Lägg in CSS som <style> i Shadow DOM
      const style = document.createElement('style');
      style.textContent = STYLE;
      this.shadowRoot.append(style, this.root);

      // 4) Läs initial state från attribut (om utvecklaren redan satt dem i HTML)
      this.locale = (this.getAttribute('data-locale')||'se').toLowerCase();
      this.skus = (this.getAttribute('data-skus')||'').split(',').map(s=>s.trim()).filter(Boolean);

      // 5) För coalescing/avbrytbar fetch
      this._loadTimer = null;  // Håller en pending “schemalagd” load()
      this._abort = null;      // AbortController för pågående nätverksanrop

      // 6) Visa skeleton direkt (bättre perceived performance)
      this._renderSkeleton();
    }

    /**
     * Triggas när något av observedAttributes ändras i DOM (t.ex. via CMS).
     * – Vi uppdaterar state, men skjuter upp den “riktiga” load() till nästa
     *   tick (_scheduleLoad) så att flera ändringar kan koalesceras.
     */
    attributeChangedCallback(name, oldV, newV){
      if (name === 'data-skus'){
        this.skus = (newV||'').split(',').map(s=>s.trim()).filter(Boolean);
      }
      if (name === 'data-locale'){
        this.locale = (newV||'se').toLowerCase();
      }
      this._scheduleLoad();
    }

    /** När komponenten monteras i DOM för första gången */
    connectedCallback(){
      this._scheduleLoad();
    }

    /**
     * Samla attributändringar innan nätverksanrop görs (coalescing).
     * – Sätter en 0 ms timeout (mikro‑defer) – kan ökas (t.ex. 50 ms) vid behov.
     */
    _scheduleLoad(){
      if (this._loadTimer) clearTimeout(this._loadTimer);
      this._loadTimer = setTimeout(() => {
        this._loadTimer = null;
        this.load();
      }, 0);
    }

    /**
     * Huvudflödet som hämtar SIMPLE + DETAIL parallellt, byg ger view‑models
     * per SKU och renderar korten.
     */
    async load(){
      // 1) Om inga SKU:er – visa ett tydligt fel i UI (hjälper redaktörer)
      if (!this.skus || this.skus.length===0){
        this.root.innerHTML = `<div class="err">Inga SKU:er angivna. Lägg till attributet <code>data-skus</code>.</div>`;
        return;
      }

      // 2) Skeleton medan vi väntar på nätverket
      this._renderSkeleton();

      // 3) Avbryt ev. tidigare fetch om en ny load() startas (race‑safe)
      if (this._abort) this._abort.abort();
      this._abort = new AbortController();

      // 4) Läs ev. per‑sida overrides (kan sättas av web publisher utan kod)
      const overridesEl = document.querySelector('script[data-samsung-product-overrides][type="application/json"]');
      let overrides = {};
      if (overridesEl){
        try{ overrides = JSON.parse(overridesEl.textContent||'{}'); } catch {}
      }

      // 5) Cache‑nyckel = “SKU1,SKU2,SKU3” i den ordning redaktören skrev in dem
      const key = this.skus.join(',');

      try{
        // 6) SIMPLE (pris): hämta från cache eller fetcha och cacha
        const simplePromise = (CACHE.simple.has(key))
          ? Promise.resolve(CACHE.simple.get(key))
          : fetch(HYBRIS_SIMPLE(this.skus), { signal:this._abort.signal, credentials:'omit' })
              .then(r=>r.json())
              .then(json => { CACHE.simple.set(key, json); return json; });

        // 7) DETAIL (bild/energi m.m.): samma som ovan
        const detailPromise = (CACHE.detail.has(key))
          ? Promise.resolve(CACHE.detail.get(key))
          : fetch(HYBRIS_DETAIL(this.skus), { signal:this._abort.signal, credentials:'omit' })
              .then(r=>r.json())
              .then(json => { CACHE.detail.set(key, json); return json; });

        // 8) Vänta in båda – men låt enskilda fel passera (allSettled)
        const [simple, detail] = await Promise.allSettled([simplePromise, detailPromise]).then(
          results => results.map(r => r.status === 'fulfilled' ? r.value : null)
        );

        // 9) Debug: skriv ut råsvar om utvecklaren aktiverat flaggan
        if (window.__cardsDebug) {
          console.log('HYBRIS simple:', simple);
          console.log('HYBRIS detail:', detail);
        }

        // 10) Bygg en presentation per SKU i exakt samma ordning
        const results = this.skus.map(sku => {
          const detailItem = findDetailProduct(detail, sku) || {};
          const simpleItem = findSimpleProduct(simple, sku) || {};

          // Titel/Bild/PDP – preferera DETAIL; tillåt overrides
          const title = (overrides[sku]?.title) || pickTitle(detailItem, sku);
          const image = (overrides[sku]?.image) || pickImage(detailItem, sku) || pickImage(simpleItem, sku) || '';
          const pdpUrl= (overrides[sku]?.url)   || pickPdpUrl(detailItem) || pickPdpUrl(simpleItem) || '#';

          // Pris – preferera SIMPLE; fallback DETAIL; tillåt overrides
          const pricePrimary = overrides[sku]?.price || pickPrice(simpleItem) || pickPrice(detailItem);
          const listPrice    = overrides[sku]?.listPrice || pickListPrice(simpleItem) || pickListPrice(detailItem);

          // Energi – extrahera + PDF‑länkar; tillåt overrides på grade om man vill tvinga
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
            sku,
            title,
            image,
            pdpUrl,
            priceText: formatPrice(pricePrimary),
            listPriceText: listPrice ? formatPrice(listPrice) : null,
            energy: {
              grade: /^[A-G]$/.test(energyGrade) ? energyGrade : null, // validera “A–G”
              battery, ip, drops, pdfs
            }
          };
        });

        // 11) Rendera faktiska kort
        this._renderCards(results);
      } catch (e){
        // Avbruten fetch (AbortController) är “normalt” vid snabba attributbyten
        if (e?.name === 'AbortError') return;

        // Annars: visa ett syrligt men informativt fel i UI (hjälper redaktör/dev)
        this.root.innerHTML = `<div class="err">Kunde inte hämta produktdata just nu. Kontrollera proxy/CORS eller nätverk. (${e?.message||e})</div>`;
      }
    }

    /**
     * Rendera skelettonkort – ett kort per SKU (minst 1). Bra för att undvika
     * “layout shift” (CLS) när riktiga kort laddas in.
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
     * Bygg alla kort och fäst dem i Shadow DOM.
     * – Inga yttre beroenden; allt genereras som “vanlig DOM”.
     */
    _renderCards(items){
      this.root.innerHTML = '';
      items.forEach(p=>{
        /* === Kortcontainer === */
        const card = document.createElement('div'); card.className='card';

        /* === Media (bild eller skeleton) === */
        const media = document.createElement('div'); media.className='media';
        media.innerHTML = p.image
          ? `<img loading="lazy" src="${p.image}" alt="${this._esc(p.title)}">`
          : `<div class="skeleton" style="width:100%;height:100%"></div>`;

        /* === Body (text + UI) === */
        const body = document.createElement('div'); body.className='body';

        // Titel
        const title = document.createElement('div'); title.className='title'; title.textContent = p.title;

        // Prisrad (nuvarande pris + ev. jämförelse/list‑pris)
        const priceRow = document.createElement('div'); priceRow.className='priceRow';
        const price = document.createElement('div'); price.className='price'; price.textContent = p.priceText || '—';
        priceRow.appendChild(price);
        if (p.listPriceText && p.listPriceText !== p.priceText){
          const cmp = document.createElement('div'); cmp.className='compare'; cmp.textContent = p.listPriceText;
          priceRow.appendChild(cmp);
        }

        // Energisektionen (A–G skala + metadata + PDF‑länkar)
        const energy = this._renderEnergy(p.energy, p.sku);

        // CTA‑rad
        const ctaRow = document.createElement('div'); ctaRow.className='ctaRow';

        // “Visa produkt” – öppnar PDP i ny flik, endast om vi har vettig URL
        const btn = document.createElement('button'); btn.type='button'; btn.className='cta'; btn.textContent='Visa produkt';
        btn.addEventListener('click', ()=>{
          if (p.pdpUrl && p.pdpUrl !== '#') {
            window.open(p.pdpUrl, '_blank', 'noopener'); // ny flik + ingen access till opener
          }
        });

        // “Kopiera länk” – kopierar PDP‑URL (fallback: nuvarande sida)
        const share = document.createElement('button'); share.type='button'; share.className='ghost'; share.textContent='Kopiera länk';
        share.addEventListener('click', async ()=>{
          try{
            await navigator.clipboard.writeText(p.pdpUrl || location.href);
            share.textContent='Kopierad!';
            setTimeout(()=>share.textContent='Kopiera länk', 1500);
          }catch{
            // Klippbord kan misslyckas (osäkra kontexter / permissions).
            // Vi håller UI tyst i detta fall för att undvika brus.
          }
        });

        ctaRow.append(btn, share);

        // Sätt ihop hela kortet
        body.append(title, priceRow, energy, ctaRow);
        card.append(media, body);
        this.root.appendChild(card);
      });
    }

    /**
     * Bygg energisektionen:
     *  – A–G skala där endast aktuell klass lyfts (övriga nedtonade).
     *  – Nyckel‑taggar (Klass/IP/Batteri m.m.) om de finns.
     *  – PDF‑länkar från API eller gissade som fallback.
     */
    _renderEnergy(energy, sku){
      const box = document.createElement('div'); box.className='energy';

      // Rubrik
      const h = document.createElement('h4'); h.textContent='Energimärkning (EU)';

      // A–G‑skala (lägg .active på den klass som matchar produkten)
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

      // Nyckelvärden (visas endast om vi har värden)
      const details = document.createElement('div'); details.className='energyRow';
      if (energy.grade) details.appendChild(this._kv('Klass', energy.grade));
      if (energy.battery) details.appendChild(this._kv('Batteritid', energy.battery));
      if (energy.ip) details.appendChild(this._kv('IP‑klass', energy.ip));
      if (energy.drops) details.appendChild(this._kv('Tålighet', `${energy.drops} drops`));

      // PDF‑länkar (etikett + produktblad)
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
      // Sista utväg: gissa URL via SKU/locale om API inte gav något
      if ((!energy.pdfs || energy.pdfs.length===0) && sku) {
        const guess = `https://images.samsung.com/is/content/samsung/p6/common/energylabel/${(this.locale||'se')}-energylabel-${sku.toLowerCase()}-energylabel.pdf`;
        const a = document.createElement('a');
        a.className='pdfLink'; a.href = guess; a.target='_blank'; a.rel='noopener noreferrer';
        a.textContent = 'Energietikett (PDF)';
        pdfRow.appendChild(a);
      }
      if (pdfRow.children.length) details.appendChild(pdfRow);

      // Bygg ihop och returnera panelen
      box.append(h, scale, details);
      return box;
    }

    /** Liten hjälpare som bygger en “Nyckel: Värde”‑tagg */
    _kv(k,v){
      const el = document.createElement('div'); el.className='kv'; el.textContent = `${k}: ${v}`;
      return el;
    }

    /** HTML‑escape för att undvika att (teoretiskt) injicera HTML via API‑strängar */
    _esc(s){
      return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
    }
  }

  /* ===========================================================================
   *        Registrera custom elementet EN gång (skydd mot dubbel‑definition)
   * =========================================================================== */
  if (!customElements.get('samsung-product-cards')) {
    customElements.define('samsung-product-cards', SamsungProductCards);
  }
})();
