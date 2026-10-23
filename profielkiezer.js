// Het venster waarin je een profiel kiest.
//
// Hoofdstuk 4 van de opdracht: een boom categorie -> norm -> profiel, een
// zoekveld, snelfilters, een detailpaneel, en een profielverwijzing als
// resultaat.
//
// Twee dingen bepalen hoe dit gebouwd is.
//
// 1. Er zijn 1742 profielen. Die staan NIET allemaal in de DOM. Alleen de
//    profielen van een opengeklapte norm worden getekend. Zet je ze er allemaal
//    in, dan wordt typen in het zoekveld traag en dat merkt de gebruiker meteen.
// 2. Het is een <dialog>. Die zit in elke moderne browser en regelt het modale
//    gedrag, de focus en Escape voor je. Dat is precies het soort ding waarvoor
//    je anders een framework zou binnenhalen.
//
// De rest van de app blijft ongemoeid: de kiezer levert een verwijzing af en
// verandert niets aan hoe bestaande onderdelen gemodelleerd worden.

import { filter, staalsoorten, getalTekst, omtrekVan, profielUrl } from './profielen.js';
import { voorbeeldVan, doorsnedeVan, maakStaaf } from './profiel-geometrie.js';
import { maakVoorbeeldVenster } from './profiel-voorbeeld.js';

// Hoe lang de staaf in het voorbeeld is. Staat zo in de opdracht: lang genoeg om
// te zien dat het een staaf is, kort genoeg om de doorsnede te kunnen bekijken.
const VOORBEELDLENGTE = 200;

// Wat er tussen twee keer openen bewaard blijft. Bewust in het geheugen en niet
// in de browseropslag: het is een gemak binnen deze sessie, geen instelling die
// bij een order hoort. Zie de opmerking bij de instellingen in main.js.
const sessie = {
    open: new Set(),        // welke knopen openstaan, als "cat:CHS" / "norm:DIN_EN_..."
    gekozen: null,          // het laatst gekozen profiel, om terug te springen
    zoek: '',
    categorie: 'alle',
    vorm: 'alle',
    staalsoort: 'alle',
};

// De sleutel van een profiel: de tabel ERBIJ, niet alleen het label.
//
// Het label is uniek binnen één norm, want daar is op ontdubbeld. Maar niet
// daarbuiten: "SHS 40x40x3" bestaat zowel onder EN 10210-2 als onder EN 10219-2.
// Op het label alleen onthouden markeerde ze na het hertekenen allebei.
const sleutelVan = (p) => `${p.table}|${p.label}`;

// Profielen waarvan het STEP-bestand niet te lezen bleek. Die horen grijs en
// onklikbaar te zijn met een uitleg erbij, zegt de opdracht. Wordt gevuld zodra
// er echt een bestand geopend wordt (het 3D-voorbeeld).
const onleesbaar = new Map();   // bestand -> reden

// Het voorbeeldvenster leeft buiten kiesProfiel: bij elke keer openen een nieuwe
// maken zou telkens een WebGL-context kosten, en daar staan browsers er maar een
// stuk of zestien van toe. Daarna krijg je een zwart vlak en geen foutmelding.
let venster = null;

// Volgnummer van het laatste voorbeeldverzoek. Klik je snel door de lijst, dan
// kan een oud verzoek later terugkomen dan een nieuw; dan hoort het oude
// genegeerd te worden.
let beurt = 0;

/** Meld dat een profielbestand niet te lezen was. */
export function meldOnleesbaar(bestand, reden) {
    onleesbaar.set(bestand, reden);
}

const VORM_TEKST = {
    hot: 'hot-finished',
    cold: 'cold-formed',
    geen: 'neither hot- nor cold-formed',
};

/**
 * Opent het venster en wacht tot er gekozen is.
 *
 * @param {object} catalogus  wat laadCatalogus() opleverde
 * @param {object} opties
 * @param {Array}  opties.vaak  wat voor DIT onderdeel het vaakst gekozen is,
 *                 de drukste eerst: [{ sleutel: bestand, label, aantal }].
 *                 Komt uit gewoonten.js; deze kiezer rekent er niets aan uit en
 *                 weet niet eens dat er geteld wordt. Zo blijft hij een venster
 *                 en geen administratie.
 * @returns {Promise<object|null>}  de profielverwijzing, of null bij annuleren
 */
export function kiesProfiel(catalogus, opties = {}) {
    const { boom, info, basis, versie } = catalogus;
    const dialoog = document.getElementById('profielDialoog');

    const zoekVeld = document.getElementById('pz_zoek');
    const catKeuze = document.getElementById('pz_categorie');
    const vormKeuze = document.getElementById('pz_vorm');
    const soortKeuze = document.getElementById('pz_soort');
    const aantalEl = document.getElementById('pz_aantal');
    const boomEl = document.getElementById('pz_boom');
    const tekstEl = document.getElementById('pz_tekst');
    const okKnop = document.getElementById('pz_ok');

    let gekozen = null;

    // --- staalsoorten in de keuzelijst, één keer ---------------------------
    if (soortKeuze.options.length <= 1) {
        for (const soort of staalsoorten(boom)) {
            const optie = document.createElement('option');
            optie.value = soort;
            optie.textContent = soort;
            soortKeuze.append(optie);
        }
    }

    // --- de soorten in de keuzelijst, één keer ----------------------------
    // Uit de BOOM en niet uit een vaste lijst: komt er een soort bij in een
    // volgende levering, dan staat hij hier vanzelf. De volgorde is die van de
    // boom, dus van hol naar open naar massief.
    if (catKeuze.options.length <= 1) {
        for (const c of boom.categorieen) {
            const optie = document.createElement('option');
            optie.value = c.sleutel;
            optie.textContent = `${c.label} (${c.aantal})`;
            catKeuze.append(optie);
        }
    }

    zoekVeld.value = sessie.zoek;
    catKeuze.value = sessie.categorie;
    vormKeuze.value = sessie.vorm;
    soortKeuze.value = sessie.staalsoort;

    // --- tekenen ----------------------------------------------------------

    /**
     * De maten die bij DEZE soort profiel horen.
     *
     * Een ronde buis heeft een diameter, een koker heeft zijden, een I-profiel
     * heeft een lijf en flenzen met elk hun eigen dikte. Eén rijtje voor alles
     * zou bij een I-profiel "Section 100 × 200" tonen en de twee diktes
     * weglaten, en dat zijn juist de maten waar het om gaat.
     *
     * De kolomnamen komen uit de catalogus: H hoogte, B flensbreedte, TS
     * lijfdikte, TG flensdikte, R aanzetstraal. IPN en UPN hebben in plaats van
     * R twee stralen: R1 bij de aanzet en R2 aan de flensrand.
     */
    function matenVan(profiel, c, g) {
        const maten = [];
        const mm = (naam, v) => { if (v > 0) maten.push([naam, `${g(v)} mm`]); };

        switch (profiel.categorie) {
            case 'IAndH':
            case 'Channels':
                mm('Height', c.H);
                mm('Flange width', c.B);
                mm('Web thickness', c.TS);
                mm('Flange thickness', c.TG);
                mm('Root radius', c.R > 0 ? c.R : c.R1);
                if (!(c.R > 0)) mm('Toe radius', c.R2);
                return maten;

            case 'Angles':
                mm('Leg A', c.A);
                // Bij gelijkzijdig hoekstaal staat er geen B in de catalogus;
                // die is dan gelijk aan A.
                mm('Leg B', c.B > 0 ? c.B : c.A);
                mm('Thickness', c.S);
                mm('Root radius', c.R1);
                mm('Toe radius', c.R2);
                return maten;

            case 'Tees':
                mm('Height', c.H);
                mm('Width', c.B);
                mm('Stem thickness', c.TS);
                mm('Flange thickness', c.TG);
                mm('Root radius', c.R1);
                mm('Toe radius', c.R2);
                mm('Edge radius', c.R3);
                return maten;

            case 'Flats':
                mm('Width', c.B);
                mm('Thickness', c.S);
                return maten;

            case 'SquareBars':
                mm('Side', c.A);
                return maten;

            case 'RoundBars':
                mm('Diameter', c.D);
                return maten;

            default:
                // Buizen en kokers, zoals het altijd was.
                mm('Diameter', c.DA);
                if (c.A > 0 && c.B > 0) maten.push(['Section', `${g(c.A)} × ${g(c.B)} mm`]);
                else if (c.B > 0) maten.push(['Section', `${g(c.B)} × ${g(c.B)} mm`]);
                mm('Wall thickness', c.S);
                mm('Outer radius', c.RA);
                mm('Inner radius', c.RI);
                return maten;
        }
    }

    function tekenDetail(profiel) {
        if (!profiel) {
            tekstEl.innerHTML = '<p class="pz_leeg">Kies links een profiel.</p>';
            return;
        }

        const c = profiel.bron.catalogue || {};
        const g = getalTekst;
        const maten = matenVan(profiel, c, g);

        if (c.GEW > 0) maten.push(['Mass', `${g(c.GEW)} kg/m`]);
        const opp = omtrekVan(profiel);
        if (opp > 0) maten.push(['Surface', `${g(+opp.toFixed(4))} m²/m`]);

        // Het doorsnede-oppervlak komt NIET uit de catalogus. Hier stond eerst
        // de kolom ASTEG, maar dat is het oppervlak niet: bij open profielen is
        // het het lijfoppervlak en bij kokers is het afgerond op drie cijfers.
        // Het echte getal wordt uit de vorm gemeten, en dat kan pas als het
        // STEP-bestand geladen is - dus hier een streepje, en toonVoorbeeld()
        // vult het in.
        maten.push(['Section area', '<span id="pz_oppervlak">…</span>']);

        const soorten = profiel.items.map((i) => i.material).filter(Boolean);
        const rij = (naam, waarde) =>
            `<tr><th>${naam}</th><td>${waarde}</td></tr>`;

        // De opdracht wil het normlabel én of het warm- of koudgevormd is. Bij
        // EN 10210-2 en EN 10219-2 staat dat al ín het normlabel, en dan levert
        // het los erbij zetten "EN 10210-2 – hot-finished hot-finished" op.
        // Alleen tonen waar het normlabel het niet zegt, dus bij EN 10255.
        const vormTekst = VORM_TEKST[profiel.vorm];
        const vormApart = profiel.normLabel.includes(vormTekst)
            ? '' : `<br><span class="pz_vorm">${vormTekst}</span>`;

        tekstEl.innerHTML = `
            <h3>${profiel.label}</h3>
            <p class="pz_norm">${profiel.normLabel}${vormApart}</p>
            <table class="pz_maten">
                ${maten.map(([n, v]) => rij(n, v)).join('')}
                ${c.BEZ_1090 ? rij('EN 1090', c.BEZ_1090) : ''}
                ${soorten.length ? rij('Steel grades', soorten.join(', ')) : ''}
            </table>
            <p class="pz_herkomst">
                DSTV: ${profiel.bron.dstv || '—'}<br>
                ${profiel.bestand}
            </p>`;
    }

    function kies(profiel, element) {
        gekozen = profiel;
        sessie.gekozen = profiel ? sleutelVan(profiel) : null;
        for (const el of boomEl.querySelectorAll('.pz_profiel.gekozen')) {
            el.classList.remove('gekozen');
        }
        if (element) element.classList.add('gekozen');
        okKnop.disabled = !profiel;
        tekenDetail(profiel);
        toonVoorbeeld(profiel);
    }

    /**
     * Het 3D-voorbeeld laden en tonen.
     *
     * Hier wordt voor het eerst een STEP-bestand geopend, en dus ook voor het
     * eerst de 50 MB OCCT. Daarom gebeurt dit pas bij het aanklikken van een
     * profiel en niet bij het openen van het venster: dat moet binnen een
     * seconde open staan.
     *
     * Elke aanroep krijgt een eigen volgnummer. Klik je snel door de lijst, dan
     * kan een oud verzoek later terugkomen dan een nieuw, en dan zou je het
     * verkeerde profiel in beeld krijgen.
     */
    async function toonVoorbeeld(profiel) {
        const houder = document.getElementById('pz_voorbeeld');
        if (!houder) return;
        if (!venster) venster = maakVoorbeeldVenster(houder);

        if (!profiel) { venster.leeg(); return; }

        const mijnBeurt = ++beurt;
        venster.meld('Voorbeeld laden…');

        // Dezelfde url als de profielverwijzing straks krijgt, met het
        // exportmoment erachter. Anders zou hetzelfde bestand twee keer
        // ingelezen worden: één keer voor het voorbeeld en één keer voor de
        // verwijzing, want de cache is op de url gesleuteld.
        const metUrl = { ...profiel, url: profielUrl(basis, profiel.bestand, versie) };

        try {
            const uit = await voorbeeldVan(metUrl, VOORBEELDLENGTE);
            if (mijnBeurt !== beurt) return;   // er is intussen iets anders gekozen
            venster.toon(uit);
            vulOppervlakIn(await doorsnedeVan(metUrl));
        } catch (err) {
            if (mijnBeurt !== beurt) return;
            // Eén kapot bestand mag nooit de hele kiezer omver halen. Het
            // profiel wordt grijs en onklikbaar, met de reden in de tooltip.
            console.warn(`Profiel ${profiel.label}: ${err.message}`);
            meldOnleesbaar(profiel.bestand, err.message);
            venster.meld('Dit profiel is niet te lezen:\n' + err.message, 'fout');
            okKnop.disabled = true;
            gekozen = null;
            sessie.gekozen = null;
            teken();
        }
    }

    /**
     * Het gemeten oppervlak in het detailpaneel zetten, en bij een profiel dat
     * niet om zijn zwaartepunt ligt ook waar dat zwaartepunt zit.
     *
     * Dat laatste staat erbij omdat je het aan de doorsnede niet ziet. Bij
     * hoekstaal ligt het nulpunt in het midden van het doosje en het zwaartepunt
     * een heel eind daarvandaan; wie dat niet weet, zet het profiel scheef.
     */
    function vulOppervlakIn({ oppervlak, zwaartepunt }) {
        const el = document.getElementById('pz_oppervlak');
        if (!el || !(oppervlak > 0)) return;

        const [zx, zy] = zwaartepunt || [0, 0];
        const uitHart = Math.hypot(zx, zy) > 0.01
            ? `<br><span class="pz_vorm">centroid at `
              + `${getalTekst(+zx.toFixed(3))}, ${getalTekst(+zy.toFixed(3))} mm`
              + ` — not the origin</span>`
            : '';
        el.outerHTML = `${getalTekst(+oppervlak.toFixed(2))} mm²${uitHart}`;
    }

    function teken() {
        const zoek = zoekVeld.value;
        const opties = {
            zoek,
            categorie: catKeuze.value,
            vorm: vormKeuze.value,
            staalsoort: soortKeuze.value,
        };
        sessie.zoek = zoek;
        sessie.categorie = opties.categorie;
        sessie.vorm = opties.vorm;
        sessie.staalsoort = opties.staalsoort;

        const zicht = filter(boom, opties);
        const zoekt = zoek.trim() !== '';
        const eenSoort = opties.categorie !== 'alle';

        aantalEl.textContent = zoekt || eenSoort
            || opties.vorm !== 'alle' || opties.staalsoort !== 'alle'
            ? `${zicht.aantallen.profielen} van ${boom.aantallen.profielen} profielen`
            : `${boom.aantallen.profielen} profielen`;

        boomEl.innerHTML = '';
        if (zicht.categorieen.length === 0) {
            boomEl.innerHTML = '<p class="pz_leeg">Niets gevonden.</p>';
            return;
        }

        for (const cat of zicht.categorieen) {
            const catSleutel = 'cat:' + cat.sleutel;
            // Tijdens zoeken klappen de treffers open, zegt de opdracht. Anders
            // moet je na elke letter zelf gaan opentikken.
            //
            // En bij het kiezen van één soort ook: dan heb je net gezegd welke
            // soort je wilt, en dan is er niets om nog dicht te houden.
            const catOpen = zoekt || eenSoort || sessie.open.has(catSleutel);

            const catEl = document.createElement('div');
            catEl.className = 'pz_cat';
            catEl.innerHTML =
                `<button type="button" class="pz_knoop" aria-expanded="${catOpen}">
                    <span class="pz_pijl">${catOpen ? '▾' : '▸'}</span>
                    ${cat.label}
                    <span class="pz_telling">${cat.aantal}</span>
                 </button>`;
            catEl.querySelector('.pz_knoop').addEventListener('click', () => {
                if (sessie.open.has(catSleutel)) sessie.open.delete(catSleutel);
                else sessie.open.add(catSleutel);
                teken();
            });
            boomEl.append(catEl);
            if (!catOpen) continue;

            for (const norm of cat.normen) {
                const normSleutel = 'norm:' + norm.table;
                // Kies je een soort waar maar ÉÉN norm onder hangt, dan gaat
                // die meteen open: er valt niets te kiezen, dus een extra klik
                // is alleen maar in de weg. Bij platstaal is dat zo.
                //
                // Hangen er meer normen onder, dan blijven ze dicht. Dat is
                // geen gemakzucht: warmvervaardigd en koudvervaardigd zijn
                // echt twee verschillende profielen, met een andere
                // hoekafronding en een ander gewicht. Die keuze hoor je bewust
                // te maken, niet door een lijst van 1126 buizen te scrollen.
                const normOpen = zoekt || sessie.open.has(normSleutel)
                    || (eenSoort && cat.normen.length === 1);

                const normEl = document.createElement('div');
                normEl.className = 'pz_norm_knoop';
                normEl.innerHTML =
                    `<button type="button" class="pz_knoop pz_niveau2"
                             aria-expanded="${normOpen}">
                        <span class="pz_pijl">${normOpen ? '▾' : '▸'}</span>
                        ${norm.label}
                        <span class="pz_telling">${norm.profielen.length}</span>
                     </button>`;
                normEl.querySelector('.pz_knoop').addEventListener('click', () => {
                    if (sessie.open.has(normSleutel)) sessie.open.delete(normSleutel);
                    else sessie.open.add(normSleutel);
                    teken();
                });
                catEl.append(normEl);
                if (!normOpen) continue;

                // Alleen HIER komen profielen in de DOM: van een opengeklapte
                // norm. Bij 871 ronde buizen is dat al een flinke lijst, en alle
                // 1742 tegelijk maakt het typen merkbaar traag.
                const lijst = document.createElement('div');
                lijst.className = 'pz_lijst';
                for (const p of norm.profielen) {
                    const stuk = document.createElement('button');
                    stuk.type = 'button';
                    stuk.className = 'pz_profiel';
                    stuk.textContent = p.label;

                    const reden = onleesbaar.get(p.bestand);
                    if (reden) {
                        stuk.disabled = true;
                        stuk.classList.add('pz_stuk');
                        stuk.title = `Dit bestand kon niet gelezen worden: ${reden}`;
                    } else {
                        // De norm hangt aan het profiel, want het detailpaneel
                        // moet hem kunnen tonen zonder de boom te kennen.
                        const metNorm = { ...p, normLabel: norm.label };
                        if (sleutelVan(p) === sessie.gekozen) {
                            stuk.classList.add('gekozen');
                            gekozen = metNorm;
                            okKnop.disabled = false;
                            tekenDetail(metNorm);
                        }
                        stuk.addEventListener('click', () => kies(metNorm, stuk));
                        stuk.addEventListener('dblclick', () => {
                            kies(metNorm, stuk);
                            dialoog.close('ok');
                        });
                    }
                    lijst.append(stuk);
                }
                normEl.append(lijst);
            }
        }
    }

    // --- vaak gebruikt ----------------------------------------------------
    //
    // Een rij knopjes met wat je voor dit onderdeel het vaakst koos. Zonder
    // dit moet je bij elke leuning opnieuw door 2336 profielen: categorie
    // openklappen, norm openklappen, scrollen, klikken.
    //
    // EEN KNOPJE KIEST, HET SLUIT NIET. Dat is bewust. Het gaat precies zo als
    // een profiel in de boom aanklikken: de doorsnede komt in beeld, het
    // 3D-voorbeeld draait, en OK bevestigt. Zou een klik meteen sluiten, dan
    // kost één misklik je de juiste keuze en krijg je bovendien nooit meer het
    // voorbeeld te zien. Twee klikken in plaats van zes is winst genoeg.
    function tekenVaak() {
        const vaakEl = document.getElementById('pz_vaak');
        if (!vaakEl) return;
        const lijst = opties.vaak || [];
        vaakEl.textContent = '';
        vaakEl.hidden = lijst.length === 0;
        if (!lijst.length) return;

        // Op BESTAND opzoeken wat er in de catalogus van over is. Een profiel
        // dat je vorige maand koos kan er bij een nieuwe levering niet meer
        // zijn; dan hoort het knopje grijs te staan met de reden erbij, en
        // niet stilletjes te verdwijnen.
        const perBestand = new Map();
        for (const cat of boom.categorieen) {
            for (const norm of cat.normen) {
                for (const p of norm.profielen) {
                    perBestand.set(p.bestand, { ...p, normLabel: norm.label });
                }
            }
        }

        const kop = document.createElement('span');
        kop.className = 'pz_vaakKop';
        kop.textContent = 'vaak gebruikt:';
        vaakEl.append(kop);

        for (const v of lijst) {
            const knop = document.createElement('button');
            knop.type = 'button';
            knop.className = 'pz_vaakKnop';
            const profiel = perBestand.get(v.sleutel);
            // Met losse elementen en niet met innerHTML: een label komt uit de
            // catalogus en daar hoort geen opmaak uit te kunnen komen.
            const naam = document.createElement('b');
            naam.textContent = (profiel ? profiel.label : v.label) || v.sleutel;
            const keer = document.createElement('span');
            keer.className = 'pz_keer';
            keer.textContent = `${v.aantal}×`;
            knop.append(naam, keer);

            if (!profiel) {
                knop.disabled = true;
                knop.title = 'Dit profiel zit niet in de catalogus die er nu '
                    + 'ligt. Misschien is er een nieuwe levering geweest.';
            } else if (onleesbaar.get(profiel.bestand)) {
                knop.disabled = true;
                knop.title = 'Dit bestand kon niet gelezen worden: '
                    + onleesbaar.get(profiel.bestand);
            } else {
                knop.title = `${profiel.label} — ${profiel.normLabel}`;
                if (sleutelVan(profiel) === sessie.gekozen) knop.classList.add('gekozen');
                knop.addEventListener('click', () => {
                    kies(profiel, null);
                    // DE BOOM OPENKLAPPEN TOT WAAR HIJ STAAT. Alleen de
                    // opengeklapte normen staan in de DOM, dus zonder dit
                    // licht de keuze hier op en is er in de lijst niets van te
                    // zien. Dan lijkt het alsof er twee losse dingen gebeuren.
                    sessie.open.add('cat:' + profiel.categorie);
                    sessie.open.add('norm:' + profiel.table);
                    teken();

                    // STAAT HIJ ER DAN NOG NIET, dan verbergt een FILTER hem:
                    // een zoekterm, een soort of een staalsoort van een vorige
                    // keer. Die staan nog aan als je het venster opnieuw opent.
                    // Pas dán opruimen, en niet eerder - je zoektekst weggooien
                    // terwijl het niet nodig is, is alleen maar vervelend.
                    if (!boomEl.querySelector('.pz_profiel.gekozen')) {
                        zoekVeld.value = '';
                        catKeuze.value = 'alle';
                        vormKeuze.value = 'alle';
                        soortKeuze.value = 'alle';
                        teken();        // teken() leest de velden en bijwerkt sessie
                    }

                    tekenVaak();
                    const erin = boomEl.querySelector('.pz_profiel.gekozen');
                    if (erin) erin.scrollIntoView({ block: 'center' });
                });
            }
            vaakEl.append(knop);
        }
    }

    // --- gebeurtenissen ---------------------------------------------------

    // Nieuwe handlers bij elke keer openen zou ze stapelen. Daarom eerst weg met
    // de oude: een kloon zonder luisteraars, en die gebruiken we.
    const verversers = [zoekVeld, catKeuze, vormKeuze, soortKeuze];
    for (const el of verversers) {
        el.oninput = teken;
        el.onchange = teken;
    }

    okKnop.disabled = true;
    tekenDetail(null);
    teken();          // markeert de vorige keuze en vult dan het detailpaneel
    tekenVaak();      // en daarna pas de rij, die weet wat er gekozen staat

    dialoog.showModal();
    // Het voorbeeldvenster kan pas meten als het venster echt zichtbaar is:
    // daarvoor is clientWidth nul en wordt het canvas 0 bij 0 pixels.
    if (venster) venster.meet();
    // De vorige keuze weer in beeld. Bewust hier en niet in teken(): die draait
    // bij elke toetsaanslag, en dan zou je bij elke letter opnieuw tessellleren.
    if (gekozen) toonVoorbeeld(gekozen);
    zoekVeld.focus();
    zoekVeld.select();

    return new Promise((klaar) => {
        dialoog.addEventListener('close', function eenmaal() {
            dialoog.removeEventListener('close', eenmaal);
            if (dialoog.returnValue !== 'ok' || !gekozen) {
                klaar(null);        // annuleren of Escape levert niets op
                return;
            }
            klaar(maakVerwijzing(gekozen, info, basis, versie));
        });
    });
}

/**
 * De profielverwijzing die de rest van de app krijgt.
 *
 * `tableId` en de itemIds blijven erin: die wijzen de rij in de
 * HiCAD-catalogus aan, en daar hangt de bestelling aan vast. `dstv` staat er
 * alleen ter informatie bij en is NOOIT een sleutel - de catalogus heeft daar
 * fouten in.
 */
export function maakVerwijzing(profiel, info, basis, versie) {
    const map = info && info.pad ? info.pad : null;
    const relatief = profiel.bestand;
    // Met het exportmoment erachter, zodat een nieuwe levering nooit een oude
    // doorsnede uit een cache kan halen. Zie profielUrl in profielen.js.
    const url = profielUrl(basis, relatief, versie);

    return {
        // wat de rij in HiCAD aanwijst
        table: profiel.table,
        tableId: profiel.tableId,
        items: profiel.items.map((i) => ({ itemId: i.itemId, material: i.material })),

        // wat op het scherm hoort
        englishLabel: profiel.label,
        standardLabel: profiel.normLabel,
        vorm: profiel.vorm,
        categorie: profiel.categorie,

        // waar het bestand staat: het absolute pad om te noemen, de url om te lezen
        bestand: relatief,
        pad: map ? map + '\\' + relatief.replace(/\//g, '\\') : relatief,
        url,

        // De doorsnede, als functie en niet als waarde. Zo hoeft de rest van de
        // app niet te weten waar het bestand staat of hoe je er een vlak uit
        // haalt, en wordt er nog steeds niets ingelezen door wie hem niet nodig
        // heeft. Tweede aanroep komt uit het geheugen.
        doorsnede: () => doorsnedeVan({ url, boxSize: profiel.bron.boxSize }),

        // En meteen de stap die de opdracht "Making a member - Straight" noemt.
        staaf: (lengte) =>
            maakStaaf({ url, boxSize: profiel.bron.boxSize }, lengte),

        // De buitenmaat van de doorsnede, uit het manifest. Wie dit profiel
        // ergens in wil passen heeft die maat nodig, en dan hoeft het
        // STEP-bestand er niet voor open.
        boxSize: profiel.bron.boxSize,

        // de hele manifestregel, voor maten en gewichten
        catalogus: profiel.bron.catalogue || {},
        // De interne naam uit de catalogus. Blijft in de verwijzing zitten omdat
        // de bestelling eraan hangt, maar komt niet op het scherm: de demo toont
        // geen leveranciersgebonden aanduidingen.
        catalogusNaam: profiel.bron.name || '',
        dstv: profiel.bron.dstv || '',
    };
}
