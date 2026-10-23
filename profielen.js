// De profielcatalogus: van manifest.json naar een boom om uit te kiezen.
//
// Alleen gegevens, geen scherm. Dat is opzet: de aantallen die de opdracht in
// hoofdstuk 5 eist (10 categorieen, 24 normen, 2336 profielen) en het zoeken
// zijn zo te controleren zonder dat er een venster tussen zit.
//
// Twee regels uit de opdracht die je makkelijk verkeerd doet:
//
// 1. Het manifest is de ENIGE bron. Niet de mappen aflopen, niet de
//    bestandsnamen ontleden. De namen op schijf wijken trouwens in
//    hoofdletters af van wat het manifest zegt, dus ontleden zou ook niet
//    werken.
// 2. Gebruik `dstv` NOOIT als sleutel. De HiCAD-catalogus heeft daar fouten in
//    zitten: "HQ 150x150x16 EN 10219-2" heeft dstv QRO150X12K. Twee profielen
//    kunnen dus dezelfde dstv hebben.
//
// De labels op het scherm zijn Engels (CHS/SHS/RHS, hot-finished). Dat is de
// internationale staalterminologie en die hoort Engels te blijven, ook al zijn
// de functienamen hier Nederlands.

// Het formaat van het manifest dat we aankunnen. Staat als constante hier en
// niet in de foutmelding: zie laadCatalogus.
const FORMAAT = 'hicad-catalogue-profiles/1';

// --- vaste tabellen uit de opdracht ----------------------------------------

// Per map: welke categorie, welk normlabel, hoe het profiellabel gebouwd wordt,
// en waar het op gesorteerd wordt. De sorteersleutels zijn cataloguskolommen, en
// de volgorde erin is de volgorde waarop gesorteerd wordt.
//
// DE VOLGORDE VAN DEZE TABEL IS DE VOLGORDE IN DE BOOM. De normen onder een
// categorie staan erin zoals ze hier staan, niet op alfabet. Dat moet, want
// alfabetisch zou DIN 1025-1 tot en met -5 de I-profielen op IPN, HEB, HEA,
// HEM, IPE zetten, en de vakman verwacht IPE, IPN, HEA, HEB, HEM.
const TABELLEN = {
    // --- buizen en kokers (ongewijzigd sinds de eerste export) ---
    'DIN_EN_10210-2_R':  { cat: 'CHS', norm: 'EN 10210-2 – hot-finished',
                           vorm: 'hot', label: 'chs', sorteer: ['DA', 'S'] },
    'DIN_EN_10219-2_R':  { cat: 'CHS', norm: 'EN 10219-2 – cold-formed',
                           vorm: 'cold', label: 'chs', sorteer: ['DA', 'S'] },
    'DIN_EN_10255':      { cat: 'CHS', norm: 'EN 10255 – threadable steel tube (gas pipe)',
                           vorm: 'geen', label: 'en10255', sorteer: ['DA', 'S'] },
    'DIN_EN_10210-2_HQ': { cat: 'SHS', norm: 'EN 10210-2 – hot-finished',
                           vorm: 'hot', label: 'shs', sorteer: ['B', 'S'] },
    'DIN_EN_10219-2_HQ': { cat: 'SHS', norm: 'EN 10219-2 – cold-formed',
                           vorm: 'cold', label: 'shs', sorteer: ['B', 'S'] },
    'DIN_EN_10210-2_HR': { cat: 'RHS', norm: 'EN 10210-2 – hot-finished',
                           vorm: 'hot', label: 'rhs', sorteer: ['A', 'B', 'S'] },
    'DIN_EN_10219-2_HR': { cat: 'RHS', norm: 'EN 10219-2 – cold-formed',
                           vorm: 'cold', label: 'rhs', sorteer: ['A', 'B', 'S'] },

    // --- I- en H-profielen ---
    'DIN_1025-5':        { cat: 'IAndH', norm: 'DIN 1025-5 – IPE',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },
    'DIN_1025-1':        { cat: 'IAndH', norm: 'DIN 1025-1 – IPN (tapered flanges)',
                           vorm: 'hot', label: 'ipn', sorteer: ['H'] },
    'DIN_1025-3':        { cat: 'IAndH', norm: 'DIN 1025-3 – HEA',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },
    'DIN_1025-2':        { cat: 'IAndH', norm: 'DIN 1025-2 – HEB',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },
    'DIN_1025-4':        { cat: 'IAndH', norm: 'DIN 1025-4 – HEM',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },

    // --- U-profielen ---
    'DIN_1026_U':        { cat: 'Channels', norm: 'DIN 1026-1 – UPN (tapered flanges)',
                           vorm: 'hot', label: 'upn', sorteer: ['H', 'B'] },
    'DIN_1026_UPE':      { cat: 'Channels', norm: 'DIN 1026-2 – UPE (parallel flanges)',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },
    'DIN_1026_UPA':      { cat: 'Channels', norm: 'UAP (parallel flanges)',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },

    // --- hoekstaal ---
    'DIN_EN_10056-1_LG': { cat: 'Angles', norm: 'EN 10056-1 – equal legs',
                           vorm: 'hot', label: 'size', sorteer: ['A', 'S'] },
    'DIN_EN_10056-1_LU': { cat: 'Angles', norm: 'EN 10056-1 – unequal legs',
                           vorm: 'hot', label: 'size', sorteer: ['A', 'B', 'S'] },

    // --- T-staal ---
    'DIN_EN_10055_T':    { cat: 'Tees', norm: 'EN 10055 – round-edged',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },
    'DIN_59051_TPS':     { cat: 'Tees', norm: 'DIN 59051 – sharp-edged',
                           vorm: 'hot', label: 'naam', sorteer: ['H'] },

    // --- platstaal ---
    'DIN_EN_10058':      { cat: 'Flats', norm: 'EN 10058 – hot-rolled',
                           vorm: 'hot', label: 'fl', sorteer: ['B', 'S'] },

    // --- vierkant staal ---
    'DIN_EN_10059':      { cat: 'SquareBars', norm: 'EN 10059 – hot-rolled',
                           vorm: 'hot', label: 'sq', sorteer: ['A'] },
    'DIN_EN_10278_V':    { cat: 'SquareBars', norm: 'EN 10278 – bright (cold-finished)',
                           vorm: 'cold', label: 'sq', sorteer: ['A'] },

    // --- rond staal ---
    'DIN_EN_10060':      { cat: 'RoundBars', norm: 'EN 10060 – hot-rolled',
                           vorm: 'hot', label: 'rd', sorteer: ['D'] },
    // De streepjes en liggende streepjes staan hier door elkaar: deze map heet
    // DIN_EN-10278_R met een koppelteken waar alle andere een liggend streepje
    // hebben. Dat is de tabelnaam uit de catalogus en die blijft de sleutel.
    'DIN_EN-10278_R':    { cat: 'RoundBars', norm: 'EN 10278 – bright (cold-finished)',
                           vorm: 'cold', label: 'rd', sorteer: ['D'] },
};

// De volgorde waarin de normen onder een categorie staan, afgeleid van de
// volgorde hierboven. Eén bron, dus niets om uit de pas te laten lopen.
const TABEL_ORDE = Object.keys(TABELLEN);

const CATEGORIE_LABEL = {
    CHS: 'Circular hollow sections (CHS)',
    SHS: 'Square hollow sections (SHS)',
    RHS: 'Rectangular hollow sections (RHS)',
    IAndH: 'I and H sections',
    Channels: 'Channels',
    Angles: 'Angles',
    Tees: 'Tees',
    Flats: 'Flat bars',
    SquareBars: 'Square bars',
    RoundBars: 'Round bars',
    International: 'AISC / BS',
};

// De volgorde waarin de categorieen in de boom staan. Van hol naar open naar
// massief, zoals de opdracht hem voorschrijft.
const CATEGORIE_ORDE = ['CHS', 'SHS', 'RHS', 'IAndH', 'Channels', 'Angles',
                       'Tees', 'Flats', 'SquareBars', 'RoundBars'];

// Terugval voor mappen die er later bijkomen. Dan is het manifest-veld
// `category` de enige aanwijzing die we hebben.
const CATEGORIE_UIT_MANIFEST = {
    RoundTubes: 'CHS',
    RoundTubesOther: 'CHS',
    SquareHollow: 'SHS',
    RectangularHollow: 'RHS',
    IAndH: 'IAndH',
    Channels: 'Channels',
    Angles: 'Angles',
    Tees: 'Tees',
    Flats: 'Flats',
    SquareBars: 'SquareBars',
    RoundBars: 'RoundBars',
    International: 'International',
};

// --- getallen --------------------------------------------------------------

/**
 * Een maat als tekst, zonder nullen achter de komma: 2.0 -> "2", 21.3 -> "21.3".
 *
 * Altijd met een punt als decimaalteken, ongeacht de taal van de browser. Deze
 * getallen zitten in profielnamen die wereldwijd hetzelfde geschreven worden -
 * "CHS 21,3x1,4" bestaat niet.
 */
export function getalTekst(v) {
    if (v === null || v === undefined || v === '') return '';
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    // 6 decimalen is ruim voor wanddikten; +() haalt de nullen eraf.
    return String(+n.toFixed(6));
}

// --- labels ----------------------------------------------------------------

/**
 * De nominale maat van een gasbuis, uit de kolom SIZE.
 *
 * SIZE staat er als `R 1 1/4 "` of `R 1"`. Eruit moet `1 1/4"`: de "R " ervoor
 * weg, dubbele spaties samengevoegd, en de spatie vóór het aanhalingsteken weg.
 */
export function en10255Maat(size) {
    if (!size) return '';
    return String(size)
        .replace(/^\s*R\s+/i, '')   // de "R " ervoor
        .replace(/\s+/g, ' ')       // dubbele spaties
        .replace(/\s+"/g, '"')      // spatie vóór het aanhalingsteken
        .trim();
}

/** heavy of medium bij EN 10255; daar staat de serie in TYPE in plaats van de staalsoort. */
function serieVan(type) {
    const t = String(type || '').trim().toUpperCase();
    if (t === 'H') return 'heavy';
    if (t === 'M') return 'medium';
    return '';
}

/**
 * Het label dat de gebruiker ziet, bijvoorbeeld "SHS 40x40x3" of
 * "1 1/4" medium – 42.4x3.2".
 *
 * Dit label is ook de sleutel voor de deduplicatie: twee regels in dezelfde map
 * met hetzelfde label zijn één profiel.
 */
export function profielLabel(p) {
    const c = p.catalogue || {};
    const tabel = TABELLEN[p.table];
    const g = getalTekst;

    if (!tabel) {
        // Onbekende map: BEZ_1090 als die er is, anders de naam uit de catalogus.
        return (c.BEZ_1090 && String(c.BEZ_1090).trim()) || p.name || '(zonder naam)';
    }

    const naam = String(p.name || '').trim();

    switch (tabel.label) {
        case 'chs': return `CHS ${g(c.DA)}x${g(c.S)}`;
        case 'shs': return `SHS ${g(c.B)}x${g(c.B)}x${g(c.S)}`;
        case 'rhs': return `RHS ${g(c.A)}x${g(c.B)}x${g(c.S)}`;

        case 'en10255': {
            const maat = en10255Maat(c.SIZE);
            const serie = serieVan(c.TYPE);
            return [maat, serie].filter(Boolean).join(' ')
                + ` – ${g(c.DA)}x${g(c.S)}`;
        }

        // IPE, HEA, HEB, HEM, UPE, UAP, T en TPS heten in de catalogus al zoals
        // ze op een tekening heten.
        case 'naam': return naam || '(zonder naam)';

        // De catalogus noemt dit "I 80"; een constructeur noemt het IPN 80.
        case 'ipn': return `IPN ${g(c.H)}`;

        // "U 30x15" wordt "UPN 30x15", en "U 30" wordt "UPN 30". Hier moet de
        // NAAM door en niet de maten, want een UPN heeft twee schrijfwijzen:
        // met en zonder breedte erachter.
        case 'upn': return naam.replace(/^U\s+/, 'UPN ');

        // Hoekstaal heet in de kolom BZ "L EN 10056-1-20x20x3" en in SIZE
        // "L 20x20x3". Die tweede is wat je wilt zien.
        case 'size': return String(c.SIZE || naam).trim();

        case 'fl': return `FL ${g(c.B)}x${g(c.S)}`;
        case 'sq': return `SQ ${g(c.A)}`;
        case 'rd': return `RD ${g(c.D)}`;

        default: return naam || '(zonder naam)';
    }
}

/** Het normlabel, niveau 2 in de boom. Onbekende map: de mapnaam zelf. */
export function normLabel(table) {
    const tabel = TABELLEN[table];
    return tabel ? tabel.norm : table;
}

/**
 * Is de doorsnede van dit profiel ROND?
 *
 * Nodig voor de afdekkap: op een buis hoort een ronde kap, op een koker een
 * vierkante. Een vierkant plaatje op een ronde paal is geen product.
 *
 * Kijkt eerst naar `categorie`, want dat draagt een profielverwijzing uit de
 * kiezer al bij zich, en valt anders terug op de tabel. Een verwijzing die
 * geen van beide heeft komt op 'Other' uit en geldt dus als niet-rond - dat is
 * de veilige kant: een vierkante kap op een vierkante paal.
 */
export function isRond(profiel) {
    if (!profiel) return false;
    const sleutel = (profiel.categorie && profiel.categorie.sleutel)
        || categorieVan(profiel).sleutel;
    return sleutel === 'CHS' || sleutel === 'RoundBars';
}

/** De categorie waar een profiel onder hangt: sleutel plus label. */
export function categorieVan(p) {
    const tabel = TABELLEN[p.table];
    if (tabel) {
        return { sleutel: tabel.cat, label: CATEGORIE_LABEL[tabel.cat] || tabel.cat };
    }

    const uitManifest = CATEGORIE_UIT_MANIFEST[p.category];
    if (uitManifest) {
        return {
            sleutel: uitManifest,
            label: CATEGORIE_LABEL[uitManifest] || uitManifest,
        };
    }
    return { sleutel: 'Other', label: 'Other' };
}

/**
 * hot-rolled/hot-finished, cold-formed/bright, of geen van beide.
 *
 * Warm en koud is niet alleen een filter maar een echt verschil: hetzelfde
 * profiel heeft warmvervaardigd een andere hoekafronding dan koudvervaardigd,
 * en dus een ander gewicht. EN 10255 valt buiten die indeling - dat is een
 * schroefdraadbuis en daar zegt de norm er niets over.
 *
 * Bij de nieuwe mappen is EN 10278 het koude geval (blankstaal); de rest is
 * warmgewalst.
 */
export function vormgevingVan(table) {
    const tabel = TABELLEN[table];
    if (tabel) return tabel.vorm;
    if (table.includes('10210')) return 'hot';
    if (table.includes('10219') || table.includes('10278')) return 'cold';
    return 'geen';
}

/**
 * Twee schrijfwijzen van dezelfde staalsoort gelijktrekken.
 *
 * De catalogus schrijft S355JO (met een letter O) 720 keer en S355J0 (met een
 * nul) 18 keer. Dat is dezelfde staalsoort. Zonder dit staan er twee regels in
 * het filter en vind je met de ene de profielen van de andere niet.
 *
 * Alleen voor het FILTEREN. In de profielverwijzing blijven de oorspronkelijke
 * tekst en het itemId staan: dat getal gaat naar de werkplaats en dat moet
 * precies zijn wat de catalogus zegt.
 */
export function staalsoortSleutel(naam) {
    return String(naam || '').trim().toUpperCase().replace(/O/g, '0');
}

/**
 * De omtrek van een profiel per meter, in m²/m.
 *
 * Normaal is dat gewoon de kolom MANTELFL. In twee tabellen klopt die niet. Bij
 * blank vierkant staal (EN 10278) staat hij 1000x te hoog - 8 m²/m voor een
 * staafje van 2 mm, terwijl het 0,008 is - en bij blank rond staal 10x. Voor
 * die twee wordt hij uitgerekend: 4 x de zijde voor vierkant, pi x de diameter
 * voor rond.
 *
 * Per tabel benoemd en niet met een vuistregel. "Is het getal veel te groot?
 * Dan delen door 1000" zou een echte fout in een andere tabel onzichtbaar
 * maken, en dan verdwijnt er stil een afwijking die iemand moet weten.
 *
 * @param {object} profiel  een profiel uit de boom, of een profielverwijzing
 */
export function omtrekVan(profiel) {
    const c = (profiel.bron && profiel.bron.catalogue) || profiel.catalogus
        || profiel.catalogue || {};
    if (profiel.table === 'DIN_EN_10278_V') return 4 * Number(c.A) / 1000;
    if (profiel.table === 'DIN_EN-10278_R') return Math.PI * Number(c.D) / 1000;
    return Number(c.MANTELFL) || 0;
}

// --- de boom ---------------------------------------------------------------

function sorteerSleutel(p) {
    const tabel = TABELLEN[p.table];
    const c = p.catalogue || {};
    if (!tabel) return [];
    return tabel.sorteer.map((kolom) => {
        const n = Number(c[kolom]);
        return Number.isFinite(n) ? n : 0;
    });
}

function vergelijk(a, b) {
    const n = Math.min(a.sleutel.length, b.sleutel.length);
    for (let i = 0; i < n; i++) {
        if (a.sleutel[i] !== b.sleutel[i]) return a.sleutel[i] - b.sleutel[i];
    }
    // Zonder sorteerkolommen (onbekende map) alfabetisch, maar wel numeriek
    // waar er cijfers in zitten: "CHS 9x2" hoort vóór "CHS 10x2".
    return a.label.localeCompare(b.label, 'en', { numeric: true });
}

/**
 * Bouwt de boom categorie -> norm -> profiel uit het manifest.
 *
 * @param {object} manifest  de inhoud van manifest.json
 * @returns {{categorieen: Array, aantallen: object, onbekendeMappen: Array}}
 *
 * De deduplicatie zit hier: binnen één map is hetzelfde profiellabel één
 * profiel, en de staalsoorten van de dubbelen worden samengevoegd. Vandaag
 * raakt dat precies één geval - `1" heavy – 33.7x4` staat twee keer in
 * EN 10255, één keer met een dubbele spatie in de naam - en daarom staan er
 * 1743 regels in het manifest en 1742 profielen in de boom.
 */
export function bouwBoom(manifest) {
    const perCategorie = new Map();
    const onbekendeMappen = new Set();
    let dubbelen = 0;

    // Eerst per map groeperen, want de deduplicatie is per map.
    const perTabel = new Map();
    for (const p of manifest.profiles || []) {
        if (!TABELLEN[p.table]) onbekendeMappen.add(p.table);
        if (!perTabel.has(p.table)) perTabel.set(p.table, []);
        perTabel.get(p.table).push(p);
    }

    for (const [table, regels] of perTabel) {
        const opLabel = new Map();
        // De categorie hoort ook ÓP het profiel: het detailpaneel laat per soort
        // andere maten zien, en dan moet je aan een profiel kunnen zien wat het
        // is zonder de boom terug te moeten lopen.
        const { sleutel: catSleutel, label: catLabel } = categorieVan(regels[0]);

        for (const regel of regels) {
            const label = profielLabel(regel);
            const bestaand = opLabel.get(label);

            if (bestaand) {
                // Eerste blijft staan, staalsoorten erbij. Op itemId ontdubbelen,
                // want dezelfde staalsoort kan in beide regels staan.
                dubbelen++;
                for (const item of regel.items || []) {
                    if (!bestaand.items.some((i) => i.itemId === item.itemId)) {
                        bestaand.items.push(item);
                    }
                }
                bestaand.samengevoegd.push(regel);
                continue;
            }

            opLabel.set(label, {
                label,
                table,
                tableId: regel.tableId,
                categorie: catSleutel,
                bestand: regel.file,
                items: [...(regel.items || [])],
                bron: regel,              // de hele manifestregel, voor het detailpaneel
                samengevoegd: [],         // regels die hierin zijn opgegaan
                sleutel: sorteerSleutel(regel),
                vorm: vormgevingVan(table),
            });
        }

        const profielen = [...opLabel.values()].sort(vergelijk);

        if (!perCategorie.has(catSleutel)) {
            perCategorie.set(catSleutel, { sleutel: catSleutel, label: catLabel, normen: [] });
        }
        perCategorie.get(catSleutel).normen.push({
            table,
            label: normLabel(table),
            vorm: vormgevingVan(table),
            profielen,
        });
    }

    // Categorieen in de vaste volgorde, onbekende erachter.
    const categorieen = [...perCategorie.values()].sort((a, b) => {
        const ia = CATEGORIE_ORDE.indexOf(a.sleutel);
        const ib = CATEGORIE_ORDE.indexOf(b.sleutel);
        if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
        return a.label.localeCompare(b.label, 'en');
    });

    // Normen binnen een categorie in de volgorde van TABELLEN. Onbekende mappen
    // erachter, op hun label.
    //
    // Hier stond eerst "op hun label, zodat 10210 vóór 10219 komt". Dat werkte
    // voor de buizen maar niet meer voor de rest: alfabetisch komen de vijf
    // DIN 1025-mappen eruit als IPN, HEB, HEA, HEM, IPE, en dat is geen volgorde
    // die iemand verwacht.
    for (const cat of categorieen) {
        cat.normen.sort((a, b) => {
            const ia = TABEL_ORDE.indexOf(a.table);
            const ib = TABEL_ORDE.indexOf(b.table);
            if (ia !== ib) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
            return a.label.localeCompare(b.label, 'en', { numeric: true });
        });
        cat.aantal = cat.normen.reduce((s, n) => s + n.profielen.length, 0);
    }

    const aantalProfielen = categorieen.reduce((s, c) => s + c.aantal, 0);

    return {
        categorieen,
        onbekendeMappen: [...onbekendeMappen],
        aantallen: {
            categorieen: categorieen.length,
            normen: categorieen.reduce((s, c) => s + c.normen.length, 0),
            profielen: aantalProfielen,
            regelsInManifest: (manifest.profiles || []).length,
            dubbelen,
        },
    };
}

// --- zoeken en filteren ----------------------------------------------------

/**
 * Past dit label bij wat er getypt is?
 *
 * Twee keer vergelijken: zoals het staat, en met alle spaties eruit. Wie
 * "shs40x40x3" typt bedoelt "SHS 40x40x3", en die moet hij vinden.
 */
export function pastBijZoekterm(label, term) {
    const z = String(term || '').trim().toLowerCase();
    if (z === '') return true;
    const l = String(label).toLowerCase();
    if (l.includes(z)) return true;
    return l.replace(/\s+/g, '').includes(z.replace(/\s+/g, ''));
}

/**
 * Filtert de boom op soort, zoektekst, vormgeving en staalsoort.
 *
 * Levert dezelfde structuur op, maar alleen met wat overblijft: lege normen en
 * lege categorieen vallen weg. Zo kan het venster gewoon tekenen wat hij
 * terugkrijgt, zonder zelf te hoeven filteren.
 */
export function filter(boom, { zoek = '', categorie = 'alle', vorm = 'alle',
                               staalsoort = 'alle' } = {}) {
    const categorieen = [];

    for (const cat of boom.categorieen) {
        if (categorie !== 'alle' && cat.sleutel !== categorie) continue;
        const normen = [];
        for (const norm of cat.normen) {
            if (vorm !== 'alle' && norm.vorm !== vorm) continue;

            const gezocht = staalsoortSleutel(staalsoort);
            const profielen = norm.profielen.filter((p) => {
                if (!pastBijZoekterm(p.label, zoek)) return false;
                // Op de gelijkgetrokken sleutel vergelijken: S355JO en S355J0
                // zijn dezelfde staalsoort, anders geschreven.
                if (staalsoort !== 'alle'
                    && !p.items.some((i) => staalsoortSleutel(i.material) === gezocht)) {
                    return false;
                }
                return true;
            });
            if (profielen.length) normen.push({ ...norm, profielen });
        }
        if (normen.length) {
            categorieen.push({
                ...cat, normen,
                aantal: normen.reduce((s, n) => s + n.profielen.length, 0),
            });
        }
    }

    return {
        categorieen,
        aantallen: {
            categorieen: categorieen.length,
            normen: categorieen.reduce((s, c) => s + c.normen.length, 0),
            profielen: categorieen.reduce((s, c) => s + c.aantal, 0),
        },
    };
}

/**
 * Alle staalsoorten die in de catalogus voorkomen, gesorteerd.
 *
 * Eén regel per staalsoort, ook als de catalogus hem op twee manieren schrijft.
 * Getoond wordt de schrijfwijze die het vaakst voorkomt; dat is de spelling die
 * de meeste gebruikers kennen.
 */
export function staalsoorten(boom) {
    const perSleutel = new Map();
    for (const cat of boom.categorieen) {
        for (const norm of cat.normen) {
            for (const p of norm.profielen) {
                for (const item of p.items) {
                    if (!item.material) continue;
                    const sleutel = staalsoortSleutel(item.material);
                    if (!perSleutel.has(sleutel)) perSleutel.set(sleutel, new Map());
                    const tellingen = perSleutel.get(sleutel);
                    tellingen.set(item.material, (tellingen.get(item.material) || 0) + 1);
                }
            }
        }
    }

    const namen = [...perSleutel.values()].map((tellingen) =>
        [...tellingen.entries()].sort((a, b) => b[1] - a[1])[0][0]);
    return namen.sort((a, b) => a.localeCompare(b, 'en'));
}

/** Alle profielen achter elkaar, handig om over de hele catalogus te lopen. */
export function alleProfielen(boom) {
    const uit = [];
    for (const cat of boom.categorieen) {
        for (const norm of cat.normen) uit.push(...norm.profielen);
    }
    return uit;
}

// --- de catalogus ophalen --------------------------------------------------

/**
 * Haalt het manifest op en bouwt de boom.
 *
 * De map staat buiten dit project, op een pad dat per pc anders kan zijn. Een
 * browserpagina kan geen pad op de C-schijf openen, dus serve.ps1 deelt hem uit
 * onder /profielen/ en vertelt via /profielen-info.json welk pad dat is. Dat
 * pad hebben we nodig om in een foutmelding te kunnen zeggen WELKE map niet
 * gevonden is.
 *
 * Er wordt hier geen enkel STEP-bestand geopend: alleen het manifest. De
 * acceptatie-eis is dat het venster binnen een seconde open staat, en 1743
 * bestanden inlezen duurt ruim een minuut.
 */
export async function laadCatalogus(basis = './profielen/') {
    let info = null;
    try {
        info = await (await fetch('./profielen-info.json')).json();
    } catch {
        // Geen info-eindpunt: dan gaan we het gewoon proberen en meldt de
        // manifest-fout hieronder zich wel.
    }

    if (info && info.beschikbaar === false) {
        throw new Error(
            `De profielmap is niet gevonden: ${info.pad}\n`
            + 'Start de server met:  .\\serve.ps1 -profielen "<pad naar de map>"');
    }

    let manifest;
    try {
        const antwoord = await fetch(basis + 'manifest.json');
        if (!antwoord.ok) throw new Error(`status ${antwoord.status}`);
        manifest = await antwoord.json();
    } catch (err) {
        const pad = info && info.pad ? info.pad : basis;
        throw new Error(`Kon manifest.json niet lezen uit ${pad}: ${err.message}`);
    }

    // De naam van het formaat wordt wel gecontroleerd maar NIET in de melding
    // herhaald: dat is een leveranciersgebonden aanduiding en die hoort niet op
    // het scherm van deze demo.
    if (manifest.format !== FORMAAT) {
        throw new Error(
            `De profielcatalogus heeft een onbekend formaat ("${manifest.format}"). `
            + 'Deze app verwacht een nieuwere of andere export.');
    }

    const boom = bouwBoom(manifest);
    const versie = manifest.exportedAt || '';

    // Onbekende mappen horen gemeld te worden, zegt de opdracht, zodat de vaste
    // tabel uitgebreid kan worden. Ze werken wel - ze vallen op de terugval
    // terug - maar met de mapnaam als normlabel in plaats van een net label.
    for (const map of boom.onbekendeMappen) {
        console.warn(`Profielcatalogus: onbekende map "${map}". `
            + 'Voeg hem toe aan TABELLEN in profielen.js voor een net label.');
    }

    return { manifest, boom, info, basis, versie };
}

/**
 * De url van een profielbestand, met het exportmoment erachter.
 *
 * Waarom dat erachter moet: de bestandsnaam van een profiel blijft bij een
 * nieuwe export hetzelfde, maar de inhoud kan veranderd zijn. Een browser die
 * `Pipe_EN_10210-2_21.3x1.4.stp` al eens opgehaald heeft mag hem dan uit zijn
 * eigen cache halen, en dan zie je een doorsnede van de vorige levering terwijl
 * de lijst de nieuwe maten noemt. Dat is precies het soort fout dat je niet
 * merkt.
 *
 * Met `?v=<exportedAt>` is het een ander adres zodra er een nieuwe export is,
 * en vervalt alles wat eronder bewaard werd vanzelf: de cache van de browser,
 * en die van profiel-geometrie.js, want die is op de url gesleuteld.
 */
export function profielUrl(basis, bestand, versie) {
    return basis + bestand + (versie ? `?v=${encodeURIComponent(versie)}` : '');
}
