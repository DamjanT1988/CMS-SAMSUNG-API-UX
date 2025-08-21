# Samsung Product Cards — README

## Uppgift (sammanfattning)
Från och med 20 juni 2025 måste alla nya mobiler och tablets som säljs inom EU ha en energimärkning. 
Uppgiften var att bygga ett **lokalt produktkort** som visar produktinformation, pris och dessa märkningar 
för Samsung Galaxy S25-serien (tre SKU:er).

- SKU: `SM-S931BLBDEUB`, `SM-S937BLBDEUB`, `SM-S936BDBDEUB`
- API: 
  - Simple: `https://shop.samsung.com/se/servicesv2/getSimpleProductsInfo?productCodes=<SKU>`
  - Detail: `https://searchapi.samsung.com/v6/front/b2c/product/card/detail/hybris?...`

Krav enligt uppgiften:
- Stand‑alone kod, integrerbar i CMS (AEM).
- Web Publisher utan kodkunskap ska kunna uppdatera SKU:er.
- Strukturerad, kommenterad kod.
- Redogöra för teknikval, arkitektur, för-/nackdelar.

Lösningen tillfälligt i produktion: https://www.damjantosic.se/samsung-s25-produktkort/
---

## Designlösning

### Arkitektur
- Bygger på **Web Component** (`<samsung-product-cards>`).
- Helt fristående: en enda JS‑fil som kan bäddas i valfritt CMS (WordPress, AEM).
- Shadow DOM används för isolerad CSS.
- Ingen extern dependens, inga byggsteg krävs.

### Dataflöde
1. **Simple API** via **WP-proxy** (`/wp-json/samsung/v1/simple`) för prisinfo (CORS‑begränsad).
2. **Detail API** direkt från `searchapi.samsung.com` för titel, bilder, energimärkning.
3. Resultat kombineras per SKU → renderas i produktkort.

### Funktionalitet
- Produktkort visar:
  - Bild (lazy-loaded)
  - Titel
  - Pris och ev. jämförpris
  - Energimärkning (A–G skala)
  - CTA-knappar: “Visa produkt” (öppnar PDP i ny flik), “Kopiera länk”
- Energimärkning:
  - Relevant klass markeras tydligt, övriga nedtonade.
  - PDF‑länkar till energietikett/produktblad används om tillgängligt.
- Hover‑effekter på knappar.
- “Visa produkt” är en knapp med `window.open(...)` för att öppna PDP.

### Underhåll (för Web Publisher)
- SKU:er anges direkt i HTML‑attributet `data-skus`:
  ```html
  <samsung-product-cards data-skus="SM-S931BLBDEUB,SM-S937BLBDEUB,SM-S936BDBDEUB" data-locale="se"></samsung-product-cards>
  ```
- För anpassningar (t.ex. egen titel/bild) kan overrides läggas i JSON:
  ```html
  <script type="application/json" data-samsung-product-overrides>
  {
    "SM-S931BLBDEUB": { "title": "Galaxy S25 – Special Edition" }
  }
  </script>
  ```

### Kodstruktur
- **Helpers**: `pickTitle`, `pickImage`, `pickPrice`, `pickEnergy` m.fl. för robust hämtning ur API‑JSON.
- **findDetailProduct**: lokaliserar rätt SKU i `detail`‑svaret oavsett struktur.
- **SamsungProductCards** (Custom Element):
  - `connectedCallback` → laddar data.
  - `_renderSkeleton` → placeholder‑UI under laddning.
  - `_renderCards` → slutlig rendering av kort.

### För-/nackdelar
**Fördelar:**
- Stand‑alone, inga externa ramverk krävs.
- Isolerad CSS → ingen konflikt med CMS‑teman.
- Enkelt för Web Publisher att byta SKU i attribut.
- Robust mot varierande API‑scheman.

**Nackdelar:**
- Web Component kräver modern browser (men alla EU‑relevanta stöds).
- Ingen server‑cache out‑of‑the‑box (kan ge många API‑calls). Rek: lägga WP‑proxy med 1–5 min cache.

---

## Process (hur lösningen togs fram)
1. Analys av kravspec (energimärkning, pris, bilder, stand‑alone kod).
2. Förstudie av API‑svar → identifierade fält för titel, bild, pris, energiklass.
3. Skapade `pick*`‑hjälpare för att robust hämta data även om fältnamn varierar.
4. Utvecklade Web Component med Shadow DOM, skeleton‑UI och renderingslogik.
5. Test i WordPress (Themify Ultra) med WP‑proxy för `simple` API.
6. Iterationer: fix av bilder, pris, energimärkning (A/B för S25/S25+), hover‑effekter, CTA som öppnar PDP.
7. Slutresultat: komplett `samsung-product-cards.js v1.3.3`.

---

## Demo / Integration
I valfri CMS‑sida:
```html
<script src="/path/to/samsung-product-cards.js"></script>
<samsung-product-cards 
  data-skus="SM-S931BLBDEUB,SM-S937BLBDEUB,SM-S936BDBDEUB" 
  data-locale="se">
</samsung-product-cards>
```

---

## Vidare utveckling
- Accessibility (aria‑labels, fokusmarkeringar).
- Server‑cache för simple API.
- Enhetstester för `pick*`‑funktionerna.
- Theme‑specifik styling via CSS Custom Properties.

---
