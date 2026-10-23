// Het tekeningkader: een blad met een rand, een titelblok en de inhoud.
//
// WAT DIT WEL EN NIET IS. Dit is géén 2D-tekening met aanzichten en snedes.
// Dat kan de app niet: er is geen aanzichtgeneratie, geen schaal en geen
// bladomgeving. Dit is een BLAD met een afbeelding van het 3D-model, de
// stuklijst, en een titelblok eronder - genoeg om iets uit te printen of als
// PDF mee te sturen.
//
// WAAROM NIET HET MVL-KADER ZELF. Dat bestaat wel degelijk: in
// C:\HiCAD_FVT\kaders staat ALLE_KADERS_MVL_06-10-2025.SZA plus een stel
// bijgewerkte DIN-kaders, en sys\RAHMEN.DAT noemt A:DINA3 als laatst
// gebruikte kader. Maar .SZA en .FGA zijn gecomprimeerde HiCAD-formaten.
// Doorzocht op 9 oktober 2026; dit kwam eruit:
//
//   - De kadergeometrie is niet leesbaar. Entropie 7,79 bit/byte, en de
//     zlib-achtige koppen die je vindt zijn precies zoveel als toeval
//     voorspelt. Er komt niet meer uit dan de tokens `DrwFrame`, `FLEXTEXT`
//     en `bitmap`.
//   - Het MVL-logo zit er wél in, als PNG op offset 33063: 2301x500, RGBA.
//     De IDAT-blokken liggen verspreid (33121, 49044, 57248, 80979) met
//     andere containerdata ertussen, dus de deflate-stroom breekt af. Na
//     uitpakken en zelf de rijen terugrekenen kwamen 214 van de 500 rijen
//     eruit: links een groot beeldmerk, rechts een woordmerk, maar
//     streperig en onvolledig. Niet bruikbaar om af te drukken.
//   - Het enige echt geplotte blad op deze pc is szenen\FVT.00.00004.pdf
//     (A2). Daaruit is het hele titelblok te halen - tien velden: Formaat,
//     Schaal, Projectie, Datum, Tekeningtype, Artikel-/Tek.nr.,
//     Artikel-/Tekeningomschrijving, Totaalgewicht, Conservering en een
//     disclaimer. Maar dat kader is van Flikweert Vision Technologies BV,
//     een klant, niet van MvL. Overnemen kan dus niet.
//
// Om het echte kader na te bouwen is een PDF of een schermafdruk ervan
// nodig, plus het logo als los bestand. Tot die er zijn staat het kader
// hieronder.
//
// Deze opzet is zo gemaakt dat dat later past: de maten van het blad, de
// velden van het titelblok en het logo staan allemaal apart.

/** De bladmaten in millimeter, liggend. */
export const BLADEN = {
    A4: { breed: 297, hoog: 210, naam: 'A4 liggend' },
    A3: { breed: 420, hoog: 297, naam: 'A3 liggend' },
};

// De rand rondom, en de hoogte van het titelblok. Maten zoals ze op een
// technische tekening gebruikelijk zijn: een ruime rand links om te kunnen
// inbinden.
const RAND = { links: 20, rechts: 10, boven: 10, onder: 10 };
const TITELBLOK_HOOG = 40;
const TITELBLOK_BREED = 180;

/**
 * Bouwt het blad als HTML.
 *
 * @param gegevens  { blad, bedrijf, opdracht, omschrijving, nummer,
 *                    getekend, datum, afbeelding, bom, samenvatting, logo }
 * @returns {string} HTML voor in een eigen venster
 *
 * Teruggegeven als tekst en niet als DOM: het blad gaat naar een eigen venster
 * om af te drukken, en dat venster heeft zijn eigen document. Zo staat er ook
 * niets in de weg in de app zelf.
 */
export function maakBlad(gegevens) {
    const blad = BLADEN[gegevens.blad] || BLADEN.A4;
    const binnenBreed = blad.breed - RAND.links - RAND.rechts;
    const binnenHoog = blad.hoog - RAND.boven - RAND.onder;

    const veld = (label, waarde, breedte) =>
        `<div class="tb_veld" style="width:${breedte}mm">`
        + `<span class="tb_label">${ontsnap(label)}</span>`
        + `<span class="tb_waarde">${ontsnap(waarde || '—')}</span></div>`;

    const bomRijen = (gegevens.bom || []).map(r =>
        `<tr><td>${ontsnap(r.positie)}</td>`
        + `<td class="g">${r.aantal}</td>`
        + `<td>${ontsnap(r.soort)}</td>`
        + `<td>${ontsnap(r.profiel)}</td>`
        + `<td>${ontsnap(r.materiaal)}</td>`
        + `<td class="g">${Math.round(r.zaaglengte)}</td>`
        + `<td>${ontsnap(r.zaaghoeken)}</td></tr>`).join('');

    return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8">
<title>${ontsnap(gegevens.nummer || 'tekening')}</title>
<style>
  @page { size: ${blad.breed}mm ${blad.hoog}mm; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 3mm/1.35 system-ui, sans-serif; color: #111;
         background: #e9ecef; }
  .blad { width: ${blad.breed}mm; height: ${blad.hoog}mm; background: #fff;
          margin: 8mm auto; position: relative; }
  @media print { body { background: #fff; } .blad { margin: 0; } }

  /* De rand. Links breder, om te kunnen inbinden. */
  .rand { position: absolute; left: ${RAND.links}mm; top: ${RAND.boven}mm;
          width: ${binnenBreed}mm; height: ${binnenHoog}mm;
          border: 0.5mm solid #111; }

  .inhoud { position: absolute; left: 0; top: 0; right: 0;
            bottom: ${TITELBLOK_HOOG}mm; display: flex; gap: 3mm; padding: 3mm; }
  .beeld { flex: 1; display: flex; align-items: center; justify-content: center;
           overflow: hidden; }
  .beeld img { max-width: 100%; max-height: 100%; }
  .lijst { width: 95mm; overflow: hidden; }
  .lijst h2 { font-size: 3.2mm; margin: 0 0 1mm; }
  table { width: 100%; border-collapse: collapse; font-size: 2.5mm; }
  th, td { border: 0.2mm solid #999; padding: 0.6mm 1mm; text-align: left; }
  th { background: #f0f2f4; }
  td.g, th.g { text-align: right; }

  /* Het titelblok: rechtsonder in de rand, zoals op een technische tekening. */
  .titelblok { position: absolute; right: 0; bottom: 0;
               width: ${TITELBLOK_BREED}mm; height: ${TITELBLOK_HOOG}mm;
               border-top: 0.5mm solid #111; border-left: 0.5mm solid #111;
               display: flex; }
  .tb_logo { width: 45mm; border-right: 0.3mm solid #111; padding: 2mm;
             display: flex; flex-direction: column; justify-content: center; }
  .tb_logo img { max-width: 100%; max-height: 14mm; margin-bottom: 1mm; }
  .tb_bedrijf { font-size: 2.6mm; white-space: pre-line; color: #333; }
  .tb_velden { flex: 1; display: flex; flex-wrap: wrap;
               align-content: flex-start; }
  .tb_veld { border-right: 0.3mm solid #999; border-bottom: 0.3mm solid #999;
             padding: 1mm 1.5mm; height: ${TITELBLOK_HOOG / 2}mm; }
  .tb_label { display: block; font-size: 2.2mm; color: #666; }
  .tb_waarde { display: block; font-size: 3.2mm; }
</style></head>
<body>
<div class="blad">
  <div class="rand"></div>

  <div class="inhoud">
    <div class="beeld">
      ${gegevens.afbeelding
        ? `<img src="${gegevens.afbeelding}" alt="aanzicht">`
        : '<span style="color:#888">geen aanzicht</span>'}
    </div>
    <div class="lijst">
      <h2>Stuklijst${gegevens.samenvatting
          ? ` — ${ontsnap(gegevens.samenvatting)}` : ''}</h2>
      <table>
        <thead><tr><th>pos</th><th class="g">st</th><th>onderdeel</th>
          <th>profiel</th><th>materiaal</th><th class="g">lengte</th>
          <th>zaag</th></tr></thead>
        <tbody>${bomRijen || '<tr><td colspan="7">geen onderdelen</td></tr>'}</tbody>
      </table>
    </div>
  </div>

  <div class="titelblok">
    <div class="tb_logo">
      ${gegevens.logo ? `<img src="${gegevens.logo}" alt="">` : ''}
      <div class="tb_bedrijf">${ontsnap(gegevens.bedrijf || '')}</div>
    </div>
    <div class="tb_velden">
      ${veld('opdracht', gegevens.opdracht, 45)}
      ${veld('tekeningnummer', gegevens.nummer, 45)}
      ${veld('getekend', gegevens.getekend, 45)}
      ${veld('omschrijving', gegevens.omschrijving, 90)}
      ${veld('datum', gegevens.datum, 45)}
    </div>
  </div>
</div>
</body></html>`;
}

/**
 * Tekst veilig in HTML zetten.
 *
 * Alles hier komt uit invoervelden van de gebruiker. Zonder dit kan een naam
 * met een kleiner-dan-teken het blad kapot maken - en erger.
 */
function ontsnap(waarde) {
    return String(waarde ?? '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
