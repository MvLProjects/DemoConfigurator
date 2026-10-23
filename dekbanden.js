// Dekbanden: een geprofileerde handregel in plaats van een stalen buis.
//
// WAT HET IS. Op een stenen balustrade ligt geen buis maar een DEKBAND: een
// brede band met een geprofileerde kop, die over de balusters heen steekt. Op
// de foto waar dit vandaan komt is dat een vlakke bovenkant met een afgeronde
// neus en een stap eronder.
//
// WAAROM HET GEEN PROFIEL UIT DE CATALOGUS IS. Die catalogus heeft 2336
// STALEN profielen - buizen, kokers, balken, platstaal. Een stenen dekband zit
// daar niet in en hoort daar ook niet in: hij wordt niet gewalst maar gegoten
// of gehouwen. Daarom een eigen doorsnede.
//
// HOE HET GEMAAKT WORDT. Een gesloten veelhoek in het vlak van de DOORSNEDE,
// daarna recht uitgetrokken over de lengte. Dat is dezelfde stap als
// `maakStaaf` in profiel-geometrie.js doet met een doorsnede uit een
// STEP-bestand - alleen tekenen we de doorsnede hier zelf.
//
// Dezelfde eerlijkheid als bij de balusters: de verhoudingen hieronder zijn
// KEUZES, afgelezen van wat een dekband doet, en geen gemeten maten uit een
// catalogus of een norm.

/** Geen dekband: de handregel blijft wat hij was. */
export const GEEN = '';

/**
 * De modellen.
 *
 * `doorsnede(b, h)` levert punten [y, z] van een GESLOTEN veelhoek, met de
 * oorsprong in de hoek linksonder. `b` is de volle breedte en `h` de volle
 * hoogte, zodat de vorm precies het doosje vult dat de rest van de app voor
 * dit onderdeel heeft gereserveerd - net als een blok.
 *
 * De punten lopen tegen de klok in gezien vanaf +X, zodat het uitgetrokken
 * lichaam een nette buitenkant krijgt.
 */
export const MODELLEN = [
    {
        id: 'afgerond',
        naam: 'Afgeronde neus',
        groep: 'Eenvoudig',
        omschrijving: 'Een rechthoekige band met afgeronde bovenhoeken. De '
            + 'eenvoudigste dekband, en de prettigste om je hand over te laten '
            + 'glijden.',
        doorsnede: (b, h) => {
            const r = Math.min(b, h) * 0.3;     // de straal van de afronding
            const punten = [[0, 0], [b, 0], [b, h - r]];
            // De afronding als een paar rechte stukjes. Zeven is genoeg om
            // rond te lijken zonder er een cirkel van te maken die het niet is.
            for (let i = 1; i <= 7; i++) {
                const a = (Math.PI / 2) * (i / 7);
                punten.push([b - r + r * Math.cos(a), h - r + r * Math.sin(a)]);
            }
            for (let i = 0; i <= 7; i++) {
                const a = (Math.PI / 2) * (i / 7);
                punten.push([r - r * Math.sin(a), h - r + r * Math.cos(a)]);
            }
            punten.push([0, h - r]);
            return punten;
        },
    },
    {
        id: 'klassiek',
        naam: 'Klassieke dekband',
        groep: 'Klassiek',
        omschrijving: 'Een overstekende dekplaat met een holle keel eronder en '
            + 'een smaller lijf. Dit is de band van een stenen bordestrap: de '
            + 'plaat steekt uit zodat het regenwater vrij van de balusters valt.',
        doorsnede: (b, h) => {
            const plaat = h * 0.34;         // de dekplaat bovenop
            const keel = h * 0.26;          // de holle keel eronder
            const inkeep = b * 0.14;        // hoever het lijf naar binnen staat
            return [
                // het lijf, van linksonder naar rechts
                [inkeep, 0], [b - inkeep, 0],
                [b - inkeep, h - plaat - keel],
                // de keel loopt naar buiten toe open
                [b - inkeep * 0.5, h - plaat - keel * 0.45],
                [b, h - plaat],
                // de dekplaat, met een kleine schuine kant bovenaan zodat het
                // water eraf loopt in plaats van erop te blijven staan
                [b, h - plaat * 0.25],
                [b - b * 0.06, h],
                [b * 0.06, h],
                [0, h - plaat * 0.25],
                [0, h - plaat],
                [inkeep * 0.5, h - plaat - keel * 0.45],
                [inkeep, h - plaat - keel],
            ];
        },
    },
    {
        id: 'schuin',
        naam: 'Afwaterende band',
        groep: 'Eenvoudig',
        omschrijving: 'Een band met een schuin aflopende bovenkant, zodat er '
            + 'geen water op blijft staan. Voor buiten, waar het simpel mag.',
        doorsnede: (b, h) => [
            [0, 0], [b, 0], [b, h * 0.72], [b * 0.5, h], [0, h * 0.72],
        ],
    },
    {
        id: 'getrapt',
        naam: 'Getrapte band',
        groep: 'Modern',
        omschrijving: 'Twee rechte treden in plaats van een profiel. Strak, en '
            + 'de goedkoopste om te maken: alleen rechte sneden.',
        doorsnede: (b, h) => {
            const stap = b * 0.16;
            return [
                [stap, 0], [b - stap, 0], [b - stap, h * 0.55],
                [b, h * 0.55], [b, h], [0, h], [0, h * 0.55],
                [stap, h * 0.55],
            ];
        },
    },
];

export function modelVan(id) {
    return MODELLEN.find(m => m.id === id) || null;
}

/** De modellen gegroepeerd, voor een keuzelijst. */
export function perGroep() {
    const uit = [];
    for (const m of MODELLEN) {
        let g = uit.find(x => x.groep === m.groep);
        if (!g) uit.push(g = { groep: m.groep, modellen: [] });
        g.modellen.push(m);
    }
    return uit;
}

/**
 * De doorsnede recht uitgetrokken over `lengte`.
 *
 * De veelhoek wordt in het vlak x = 0 gelegd, met y de breedte en z de hoogte,
 * en daarna langs +X getrokken. Dat is precies hoe de rest van de app een
 * liggend onderdeel verwacht: een doosje van lengte bij breedte bij hoogte,
 * met zijn hoek op de oorsprong.
 *
 * Geeft een EIGEN compound terug, zodat de vorm van ons blijft nadat het
 * prisma-object is opgeruimd - dezelfde afspraak als maakStaaf.
 */
export function maakDekband(oc, id, { b, h, lengte }, opruimen) {
    const model = modelVan(id);
    if (!model) throw new Error(`Onbekende dekband: ${id}`);
    if (!(b > 0) || !(h > 0) || !(lengte > 0)) {
        throw new Error(`Een dekband heeft maten nodig (kreeg ${b} x ${h} x ${lengte}).`);
    }

    const punten = model.doorsnede(b, h);
    const veelhoek = new oc.BRepBuilderAPI_MakePolygon_1();
    opruimen.push(veelhoek);
    for (const [y, z] of punten) {
        const p = new oc.gp_Pnt_3(0, y, z);
        opruimen.push(p);
        veelhoek.Add_1(p);
    }
    veelhoek.Close();

    const vlak = new oc.BRepBuilderAPI_MakeFace_15(veelhoek.Wire(), false);
    const richting = new oc.gp_Vec_4(lengte, 0, 0);
    const prisma = new oc.BRepPrimAPI_MakePrism_1(vlak.Face(), richting, false, true);
    opruimen.push(vlak, richting, prisma);

    // In een eigen compound: dan blijft de vorm geldig als het prisma weg is.
    const bouwer = new oc.BRep_Builder();
    const bundel = new oc.TopoDS_Compound();
    bouwer.MakeCompound(bundel);
    bouwer.Add(bundel, prisma.Shape());
    return bundel;
}
