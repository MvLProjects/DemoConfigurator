// Voorbeeldontwerpen: een begin met één klik.
//
// Elk voorbeeld is een ontwerp in dezelfde vorm als een gedeelde link (zie
// ontwerpAlsCode in main.js): balustradematen, trapmaten en de leuning. Een
// profiel staat er als pad binnen de catalogus in; de app zoekt de rest op.
//
// ALLEEN WAT AFWIJKT. De rest komt uit de standaardmaten, zodat er van een vorig
// ontwerp niets blijft hangen - een voorbeeld zonder sierpunt hoort er ook geen
// te krijgen omdat er toevallig nog een gekozen stond.
//
// Wat hier staat is NAGEMETEN in de zelftest: elk voorbeeld bouwt, zonder staal
// op twee plekken. Een voorbeeld dat niet werkt is de slechtst denkbare eerste
// indruk.

const CHS48 = 'DIN_EN_10210-2_R/Pipe_EN_10210-2_48.3x2.6.stp';
const UNP220 = 'DIN_1026_U/U_220.stp';
const FL80 = 'DIN_EN_10058/Fl_80x12.stp';

export const VOORBEELDEN = [
    {
        id: 'industrieel',
        naam: 'Industrieel',
        uitleg: 'Rechte trap met roostertreden, UPN-bomen en een buisleuning met liggende regels',
        wat: 'trap',
        t: { hoogte: 3000, breedte: 900, tredeMateriaal: 'rooster', tredeDikte: 30,
             boomProfiel: UNP220, platen: true },
        b: { vulling: 'horizontaal', staanderProfiel: CHS48, handregelProfiel: CHS48 },
        l: 'rechts',
    },
    {
        id: 'industrieel-trap',
        naam: 'Industriële trap',
        uitleg: 'Roostertrap met platte staanders, knieregel en dichte uiteinden, verzinkt',
        wat: 'trap',
        t: { hoogte: 3000, breedte: 900, tredeMateriaal: 'rooster', tredeDikte: 30,
             boomProfiel: UNP220 },
        b: { vulling: 'knieregel', staanderProfiel: FL80, handregelProfiel: CHS48,
             geslotenEind: 1, verzinken: true },
        l: 'rechts',
    },
    {
        id: 'modern-glas',
        naam: 'Modern glas',
        uitleg: 'Kwartslagtrap met eiken treden en glazen panelen, zwart gecoat',
        wat: 'trap',
        t: { hoogte: 3000, breedte: 1000, soort: 'kwartslag', draai: 'rechts',
             tredeMateriaal: 'eiken', tredeDikte: 40 },
        b: { vulling: 'glas', afwerking: '9005' },
        l: 'beide',
    },
    {
        id: 'klassiek',
        naam: 'Klassiek smeedwerk',
        uitleg: 'Eiken trap met stootborden, spijlen met speerpunten en sierbollen',
        wat: 'trap',
        t: { hoogte: 2800, breedte: 1000, tredeMateriaal: 'eiken', tredeDikte: 40,
             stootborden: true },
        b: { spijlOverstek: 80, spijlSierpunt: 'speerpunt', sierpunt: 'bol-rond',
             afwerking: '9005' },
        l: 'rechts',
    },
    {
        id: 'wentel',
        naam: 'Compacte wenteltrap',
        uitleg: 'Wenteltrap van 1,8 m doorsnede met traanplaat treden, antraciet',
        wat: 'trap',
        t: { hoogte: 3000, soort: 'wentel', draai: 'rechts', diameter: 1800,
             tredeMateriaal: 'traanplaat', tredeDikte: 7 },
        b: { afwerking: '7016' },
        l: 'rechts',
    },
    {
        id: 'houten-trap',
        naam: 'Houten trap',
        uitleg: 'Eiken treden in eiken trapbomen, stootborden en een eiken handregel op zwarte staanders',
        wat: 'trap',
        t: { hoogte: 2800, breedte: 1000, tredeMateriaal: 'eiken', tredeDikte: 40,
             boomMateriaal: 'eiken', stootborden: true },
        b: { handregelHout: 'eiken', afwerking: '9005' },
        l: 'rechts',
    },
    {
        id: 'wentel-muur',
        naam: 'Wenteltrap langs de muur',
        uitleg: 'Eiken treden om een spil op een voetplaat, met een wandleuning langs de ronde muur',
        wat: 'trap',
        t: { hoogte: 3000, soort: 'wentel', draai: 'rechts', diameter: 1800,
             tredeMateriaal: 'eiken', tredeDikte: 40, wandleuning: 'rechts', platen: true },
        b: { afwerking: '9005' },
        l: 'geen',
    },
    {
        id: 'rvs-balkon',
        naam: 'RVS met glas',
        uitleg: 'Balustrade van 4 m in RVS 316, met glazen panelen in klemmen tussen ronde staanders',
        wat: 'balustrade',
        b: { lengte: 4000, hoogte: 1000, vulling: 'glas', metaal: 'rvs',
             staanderProfiel: CHS48, handregelProfiel: CHS48 },
    },
    {
        id: 'balkon-glas',
        naam: 'Glazen balkon',
        uitleg: 'Balustrade van 4 m met glazen panelen tussen ronde staanders',
        wat: 'balustrade',
        b: { lengte: 4000, hoogte: 1000, vulling: 'glas', staanderProfiel: CHS48,
             handregelProfiel: CHS48, afwerking: '7016' },
    },
    {
        id: 'glas-vrij',
        naam: 'Glas zonder staanders',
        uitleg: 'Balkon van 5 m: gehard glas in een zwart bodemprofiel, met een kaplijst',
        wat: 'balustrade',
        b: { lengte: 5000, hoogte: 1000, vulling: 'glasvrij', afwerking: '9005' },
    },
    {
        id: 'industrieel-balk',
        naam: 'Industriële leuning',
        uitleg: 'Platte staanders met de buis ervoor, knieregel, schoprand en dichte uiteinden, verzinkt',
        wat: 'balustrade',
        b: { lengte: 3000, hoogte: 1100, vulling: 'knieregel', staanderProfiel: FL80,
             handregelProfiel: CHS48, regelVoor: 1, schoprand: 1, geslotenEind: 1,
             verzinken: true },
    },
    {
        id: 'hekwerk',
        naam: 'Klassiek hekwerk',
        uitleg: 'Balustrade met doorgestoken spijlen, speerpunten en sierbollen op de palen',
        wat: 'balustrade',
        b: { lengte: 3000, hoogte: 1000, spijlOverstek: 80, spijlSierpunt: 'speerpunt',
             sierpunt: 'bol-rond', afwerking: '9005' },
    },
];
