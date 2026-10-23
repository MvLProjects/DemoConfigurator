// STEP -> three.js viewer, met face- en edge-selectie en een configurator voor
// balustrades en trappen.
//
//   opencascade.js beta -> volledige OCCT: STEP lezen en schrijven, de echte
//                          TopoDS_Edge-topologie, en het tessellleren voor het
//                          beeld (zie brep-edges.js en tessellate.js)
//   three.js 0.186.0    -> BufferGeometry.addGroup, Raycaster.faceIndex
//                          (faceIndex = driehoeknummer, three.core.js r186)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { initOcct, laadStep, laadVorm, countMeshEdges, schrijfStep,
    huidigeVorm } from './brep-edges.js';
import { maakNavigatie } from './navigation.js';
import { bouwBalustrade, bouwBlok, bouwBalustradeOpRanden, beoordeelRanden,
    voorspelBalustrade } from './build-balustrade.js';
import { STANDAARD, valideer, VULLING, GLAS, vullingSoort } from './balustrade-rules.js';
import { parseer, noemtProfiel } from './command-parser.js';
import { bouwTrap, trapDelen, wandleuningFout, controleerWentel } from './build-trap.js';
import { maakVoorbeeld, ruimVoorbeeldOp } from './preview.js';
import { TREDESOORTEN, tredeSoortVan } from './treden.js';
import { STANDAARD as TRAP_STANDAARD, berekenTrap, beoordeelTrap,
    valideer as valideerTrap, controleerBordes } from './trap-regels.js';
import { laadCatalogus } from './profielen.js';
import * as cfg from './configuraties.js';
import * as gewoonten from './gewoonten.js';
import * as balusters from './balusters.js';
import * as kosten from './kosten.js';
import * as dekbanden from './dekbanden.js';
import * as hulp from './hulp.js';

// --- wat er misging, voor de hulpknop ---------------------------------------
//
// EEN KORTE GESCHIEDENIS, geen logboek. De hulpknop wil weten wat er net
// gebeurde; alles van het afgelopen uur bewaren maakt het rapport onleesbaar
// en zegt niets meer over de storing van nu. Vijftien is ruim genoeg.
const hulpFouten = [];
function onthoudFout(tekst) {
    hulpFouten.push(`${new Date().toLocaleTimeString('nl-NL')}  ${tekst}`);
    while (hulpFouten.length > 15) hulpFouten.shift();
}
window.addEventListener('error', (e) => onthoudFout('fout: ' + e.message));
window.addEventListener('unhandledrejection', (e) =>
    onthoudFout('belofte: ' + ((e.reason && e.reason.message) || e.reason)));
{
    // De eigen meldingen van de app gaan via console.error; die horen er net
    // zo goed in. De echte console blijft gewoon werken - hier wordt
    // meegeluisterd, niet onderschept.
    const echte = console.error.bind(console);
    console.error = (...a) => {
        onthoudFout('console: ' + a.map(v =>
            (v && v.message) ? v.message : String(v)).join(' '));
        echte(...a);
    };
}
import { maakMaatvoering } from './maatvoering.js';
import { maakBlad, BLADEN } from './kader.js';
import { kiesProfiel, maakVerwijzing } from './profielkiezer.js';
import { keurGeometrie, zoekBreder } from './controle.js';
import { jpegVanCanvas } from './pdf.js';
import { maakProductieblad } from './productie.js';
import { werkplaatsblad, onderdelenbladen } from './tekening2d.js';
import { maakIndex, zoek } from './zoeken.js';
import { kiesSierpunt } from './sierpuntkiezer.js';
import { modelVan, GEEN as SIERPUNT_GEEN } from './sierpunten.js';
import { isRond as isRondProfiel } from './profielen.js';
import { maakDxf } from './dxf.js';
import { maakZip } from './zip.js';
import { alleProfielen } from './profielen.js';
import { beschrijf, bestandsnaam, bomRegel } from './onderdelen.js';
import { maakZaaglijst, zaaglijstAlsCsv } from './zaaglijst.js';
import { materiaalSleutels, materiaalNaam,
         ralNummers, ralNaam } from './materialen.js';

// --- materiaalindexen van de geometry-groups -------------------------------
//
// De eerste drie liggen vast. Daarachter komt er per MATERIAAL dat in het model
// voorkomt één bij: een houten trede moet je kunnen zien. Die lijst wordt per
// model opgebouwd, want welke materialen erin zitten hangt van het model af.
const MAT_GAP = 0;       // driehoeken die bij geen enkele b-rep face horen
const MAT_FACE = 1;      // normale face, zonder eigen materiaal
const MAT_SELECTED = 2;  // geselecteerde face
const MAT_EERSTE_VRIJ = 3;

const statusEl = document.getElementById('status');

// --- bezig met bouwen -------------------------------------------------------
//
// OCCT REKENT SYNCHROON OP DE HOOFDDRAAD. Zolang hij bezig is tekent de
// browser niets: geen animatie, geen hover, geen scroll. Dat is geen fout maar
// een eigenschap van WebAssembly zonder Worker.
//
// Daar volgen twee dingen uit, en allebei zitten ze hieronder verwerkt:
//
//   1. Een DRAAIEND spinnertje zou precies tijdens het wachten bevriezen, en
//      een bevroren animatie ziet er kapotter uit dan helemaal geen melding.
//      Daarom een balk die per stap VERSPRINGT, zonder overgang.
//
//   2. Een melding die je zet vlak voordat je gaat rekenen wordt NOOIT
//      getekend - de draad gaat meteen op slot. Daarom `adem()`: twee keer
//      wachten op een beeldopbouw, zodat wat je net hebt gezet ook echt op het
//      scherm staat voordat het werk begint.
//
// Gemeten op 22-10: een gewone balustrade bouwt in 0,39 s, een van twaalf
// meter in 1,31 s en het meshen komt daar nog bij. Lang genoeg om te willen
// weten dat er iets gebeurt.
const bezigVak = document.getElementById('bezigVak');
const bezigTekstEl = document.getElementById('bezigTekst');
const bezigCijferEl = document.getElementById('bezigCijfer');
const bezigBladen = [document.getElementById('bezigBlad1'),
                     document.getElementById('bezigBlad2')];

// HOE LANG DE MELDING MINSTENS BLIJFT STAAN. Een bouw van 0,4 s liet hem
// eerder even opflitsen en weer verdwijnen; dat leest als een storing. Nu
// draait de ring altijd even rond en vervaagt hij daarna.
const BEZIG_MINIMAAL = 350;
const BEZIG_VERVAGEN = 180;     // moet overeenkomen met de css-overgang
let bezigSinds = 0;
let bezigWegTimer = 0;

/**
 * De ring op een deel van de rondte zetten. `deel` is 0..1, of null als we
 * niet weten hoe ver het is - dan blijft de ring leeg en het cijfer weg, en
 * zegt alleen de draaiende veeg dat er gewerkt wordt. Liever niets tonen dan
 * een percentage verzinnen.
 *
 * De twee bladen draaien: het eerste doet de eerste helft (0-180°), het
 * tweede de rest. `meteen` slaat de overgang over - nodig bij het terugzetten
 * op nul, want anders draait de ring zichtbaar terug.
 */
function zetRing(deel, meteen = false) {
    if (!bezigBladen[0]) return;
    const vast = (deel === null || deel === undefined)
        ? null : Math.max(0, Math.min(1, deel));
    const graden = (vast === null ? 0 : vast) * 360;
    bezigBladen.forEach((blad, i) => {
        // Het blad is de LINKERhelft van een ring. Voor de eerste helft ligt
        // het venster rechts, dus op 0° valt het er net buiten en draait het
        // er vanaf 12 uur in. Voor de tweede helft ligt het venster links -
        // daar zou 0° het juist helemaal vullen. Die begint dus op 180°,
        // buiten beeld, en draait vanaf 6 uur binnen.
        const hoek = i === 0
            ? Math.min(180, graden)
            : 180 + Math.max(0, Math.min(180, graden - 180));
        if (meteen) {
            blad.style.transition = 'none';
            blad.style.transform = `rotate(${hoek}deg)`;
            void blad.offsetWidth;          // afdwingen vóór de overgang terug
            blad.style.transition = '';
        } else {
            blad.style.transform = `rotate(${hoek}deg)`;
        }
    });
    bezigCijferEl.textContent = vast === null ? '' : Math.round(vast * 100) + '%';
}

/**
 * Eén beeldopbouw afwachten, zodat het scherm bijgewerkt is vóór het werk.
 *
 * Met twee uitwegen, want wachten op een frame is NIET veilig:
 * - staat het tabblad op de achtergrond, dan tekent Chrome niets meer en komt
 *   er dus ook geen frame. Er valt dan ook niets te laten zien, dus we wachten
 *   niet;
 * - en komt er tóch geen frame terwijl de pagina zichtbaar heet te zijn (de
 *   zelftest draait onder `--virtual-time-budget`, en daar vuurt rAF precies
 *   één keer), dan neemt de timer het over. Gemeten op 22-10: zonder dit
 *   vangnet bleef de bouw daar voorgoed hangen en liep de zelftest vast.
 */
const adem = () => {
    if (document.hidden) return Promise.resolve();
    return new Promise((klaar) => {
        let af = false;
        const eenmaal = () => { if (!af) { af = true; klaar(); } };
        requestAnimationFrame(() => requestAnimationFrame(eenmaal));
        setTimeout(eenmaal, 150);
    });
};

/** De melding tonen en hem laten tekenen voordat de hoofddraad op slot gaat. */
async function bezigStart(wat) {
    if (!bezigVak) return;
    if (bezigWegTimer) { clearTimeout(bezigWegTimer); bezigWegTimer = 0; }
    bezigTekstEl.textContent = wat + '…';
    zetRing(null, true);
    bezigVak.hidden = false;
    // Eerst een frame mét `display`, anders heeft de doorzichtigheid geen
    // beginwaarde om vanaf te vervagen en springt hij er in één keer in.
    await adem();
    bezigVak.classList.add('aan');
    bezigSinds = Date.now();
    await adem();
}

/**
 * Eén stap verder. Wordt als `melden` aan de bouwers meegegeven.
 *
 * Geeft een belofte terug die pas klaar is als het scherm bijgewerkt is; de
 * bouwer wacht die af. Zonder dat zou de balk pas aan het eind in één keer
 * naar 100% springen - en dan had je hem net zo goed weg kunnen laten.
 */
async function bezigStap(n, van, tekst) {
    if (!bezigVak || bezigVak.hidden) return;
    zetRing(n / Math.max(1, van));
    if (tekst) bezigTekstEl.textContent = tekst;
    await adem();
}

/**
 * De melding opruimen: eerst uitvagen, dan pas verbergen.
 *
 * Mislukt de bouw, dan wordt de ring NIET alsnog volgedraaid. Hij vervaagt
 * op de stand waar het werk bleef steken; dat is waar het misging.
 */
function bezigKlaar() {
    if (!bezigVak || bezigVak.hidden) return;
    if (bezigWegTimer) clearTimeout(bezigWegTimer);
    const resterend = Math.max(0, BEZIG_MINIMAAL - (Date.now() - bezigSinds));
    bezigWegTimer = setTimeout(() => {
        bezigVak.classList.remove('aan');
        bezigWegTimer = setTimeout(() => {
            bezigVak.hidden = true;
            bezigWegTimer = 0;
        }, BEZIG_VERVAGEN);
    }, resterend);
}
const edgeStatusEl = document.getElementById('edgeStatus');
const viewportEl = document.getElementById('viewport');

// --- three.js basisopzet ---------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf2f4f6);

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10000);
// Z is omhoog. Dat is de afspraak in HiCAD, Onshape en STEP; three.js gaat
// standaard uit van Y-omhoog, waardoor modellen op hun kant lijken te liggen.
camera.up.set(0, 0, 1);

// preserveDrawingBuffer: anders is de tekenbuffer leeg zodra het beeld is
// samengesteld, en levert een schermafdruk van de viewer een wit vlak op. Dat
// is nodig om het 3D-aanzicht in een tekening te kunnen zetten. Het kost wat
// geheugen; op een model van deze omvang is dat niet te merken.
const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
viewportEl.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.0));
const headLight = new THREE.DirectionalLight(0xffffff, 1.5);
scene.add(headLight);

// De wortel waar het geimporteerde model onder hangt.
let modelRoot = new THREE.Group();
scene.add(modelRoot);

// Losse wortel voor de b-rep edges, zodat ze apart te raycasten en te verbergen zijn.
let edgeRoot = new THREE.Group();
scene.add(edgeRoot);

document.getElementById('showEdges').addEventListener('change', (e) => {
    edgeRoot.visible = e.target.checked;
    if (!e.target.checked) clearEdgeSelection();
});

// --- STEP exporteren -------------------------------------------------------
//
// HIER STOND EEN KNOP "STEP exporteren" in de bovenbalk. Die is weg: het
// productiepakket onder Resultaat levert diezelfde STEP van het geheel
// (balustrade.stp) én een STEP per onderdeel, de DXF's van de plaatdelen, het
// productieblad en de stuklijst. Twee knoppen naast elkaar waarvan de ene
// minder geeft dan de andere is een keuze die niemand hoeft te maken.
//
// WAT ERMEE VERVALT, eerlijk opgeschreven: een model dat je met "Model openen…"
// van schijf haalt en waar je verder niets mee doet, kun je nu niet meer als
// STEP terugschrijven. Dat was een rondje van bestand naar hetzelfde bestand.
// Bouw je er een leuning op met "Op geselecteerde randen", dan is er wél een
// onderdelenlijst en werkt het productiepakket gewoon.

// --- paneel links: balustrade samenstellen ---------------------------------
// hoogteverschil staat niet in regels.json: het is geen norm maar een keuze
// van de gebruiker. 0 betekent een vlakke balustrade.
// hoogteverschil en verschuiving staan niet in regels.json: het zijn geen
// normen maar keuzes van de gebruiker. Allebei 0 = zoals het altijd was.
const BEGINWAARDEN = { ...STANDAARD, hoogteverschil: 0, verschuiving: 0 };

const velden = Object.fromEntries(
    Object.keys(BEGINWAARDEN).map(naam => [naam, document.getElementById('p_' + naam)]));
const afgeleidEls = {
    aantal: document.getElementById('a_aantal'),
    doorgang: document.getElementById('a_doorgang'),
    steek: document.getElementById('a_steek'),
    helling: document.getElementById('a_helling'),
    strip: document.getElementById('a_strip'),
};
// De kopjes van de eerste drie rijen. Die veranderen mee met de vulling; de
// helling en de stripbreedte heten altijd hetzelfde.
const afgeleidKoppen = {
    aantal: document.getElementById('a_aantalKop'),
    doorgang: document.getElementById('a_doorgangKop'),
    steek: document.getElementById('a_steekKop'),
};
const paneelFoutEl = document.getElementById('paneelFout');
const vullingLetEl = document.getElementById('vullingLet');
const genereerKnop = document.getElementById('genereer');

// Een aan/uit-keuze hoort een vinkje te zijn en geen veldje waar je 0 of 1 in
// typt. De rest van de machinerie rekent met getallen, dus een vinkje wordt
// hier naar 0/1 vertaald en terug.
const isVinkje = (veld) => veld.type === 'checkbox';
// En een KEUZE uit een lijst is geen getal maar een woord. De vulling is de
// eerste van dat soort: 'spijlen', 'horizontaal' of 'geen'. Zonder dit kwam
// er valueAsNumber uit en dus NaN, en viel de hele balustrade stil op een
// foutmelding over een veld dat de gebruiker niet eens als getal ziet.
const isKeuze = (veld) => veld.tagName === 'SELECT';
// En een TEKSTveld is ook geen getal. De hoeken zijn de eerste: daar typ je
// "90, 1500" in, en valueAsNumber maakt daar NaN van.
const isTekst = (veld) => veld.tagName === 'INPUT' && veld.type === 'text';
const leesVeld = (veld) => isVinkje(veld) ? (veld.checked ? 1 : 0)
    : (isKeuze(veld) || isTekst(veld)) ? veld.value : veld.valueAsNumber;

for (const [naam, veld] of Object.entries(velden)) {
    if (isVinkje(veld)) veld.checked = BEGINWAARDEN[naam] !== 0;
    else veld.value = BEGINWAARDEN[naam];
    veld.addEventListener('input', werkAfgeleideBij);
    veld.addEventListener('change', werkAfgeleideBij);
}

// Een profiel PER ONDERDEEL. Eerst was er één keuze voor alles tegelijk, en dat
// gaf een leuning met spijlen zo dik als de staanders - 30 stuks van 48,3 mm.
// Een echte leuning heeft juist een zware staander en een dunne spijl.
//
// Staat hier bovenaan en niet bij de knoppen verderop: huidigeMaten() gebruikt
// het, en die wordt al aangeroepen voordat de pagina klaar is met opbouwen.
const profielen = { staander: null, handregel: null, spijl: null, boom: null };

// De poedercoatkleur. Eén keuze voor het hele werk - balustrade én trap - want
// zo wordt het ook gecoat: in één bad, in één kleur. Staat buiten `velden`
// omdat het een keuzelijst is en geen getal.
const afwerkingEl = document.getElementById('p_afwerking');
{
    const geen = document.createElement('option');
    geen.value = '';
    geen.textContent = 'blank (geen coating)';
    afwerkingEl.append(geen);
    for (const nummer of ralNummers()) {
        const optie = document.createElement('option');
        optie.value = nummer;
        optie.textContent = ralNaam(nummer);
        afwerkingEl.append(optie);
    }
}
afwerkingEl.addEventListener('change', () => { werkAfgeleideBij(); werkTrapBij(); });

/**
 * De ingevulde maten, met de gekozen profielen erbij.
 *
 * De profielen moeten hier mee, want ze veranderen de uitkomst: een dikkere
 * spijl betekent minder spijlen. Zonder dit zou het voorbeeld in het paneel iets
 * anders voorspellen dan er gebouwd wordt.
 */
function huidigeMaten() {
    return {
        ...Object.fromEntries(
            Object.entries(velden).map(([naam, veld]) => [naam, leesVeld(veld)])),
        staanderProfiel: profielen.staander,
        handregelProfiel: profielen.handregel,
        spijlProfiel: profielen.spijl,
        afwerking: afwerkingEl.value || null,
        // Het sierpunt is een keuze uit een bibliotheek, net als een profiel,
        // en staat daarom niet in een invulveld.
        sierpunt: sierpuntKeuze,
        // En de punt op de SPIJLEN. Een tweede keuze, want het is een ander
        // onderdeel met een andere maat: de punt op een staaf van 20 mm hoort
        // niet zo groot te zijn als die op een paal van 40.
        spijlSierpunt: spijlPuntKeuze,
    };
}

/**
 * Deze bouw meetellen in wat de gebruiker het meest kiest.
 *
 * PAS NA HET BOUWEN, en dat is de hele truc. Zou dit bij elke toetsaanslag
 * gebeuren, dan telde een hoogte van 1100 ook als 1, 11 en 110 mee - je komt
 * daar onderweg langs tijdens het typen. Het bouwen is het moment waarop je
 * het meende.
 *
 * Nooit een reden om de bouw te laten mislukken: wat hier fout gaat is een
 * gemak dat niet lukt, geen onderdeel dat niet klopt. Zie gewoonten.js.
 */
function onthoudGewoonten() {
    try {
        gewoonten.onthoud({
            profielen,
            sierpunt: sierpuntKeuze,
            spijlSierpunt: spijlPuntKeuze,
            maten: huidigeMaten(),
        });
        werkMijnStandaardBij();
    } catch (err) {
        console.error(err);
    }
}

/**
 * De knop "mijn standaard" aan of uit zetten, met erbij waar hij op slaat.
 *
 * ZEG WAAR HET OP GEBASEERD IS. Een knop die ongevraagd twintig velden zet
 * zonder te zeggen waarom is een verrassing en geen gemak. Daarom staat er
 * hoeveel keer je iets gebouwd hebt en welke keuzes eruit komen; dan kun je
 * zien of het klopt vóór je hem indrukt.
 */
function werkMijnStandaardBij() {
    const knop = document.getElementById('gw_toepassen');
    const wis = document.getElementById('gw_vergeet');
    const hint = document.getElementById('gw_hint');
    if (!knop || !hint) return;

    let mijn;
    try {
        mijn = gewoonten.mijnStandaard();
    } catch {
        return;         // opslag weigert: laat de knop gewoon uit staan
    }

    const stukken = [];
    for (const [onderdeel, p] of Object.entries(mijn.profielen)) {
        if (p) stukken.push(`${onderdeel} ${p.englishLabel || p.bestand}`);
    }
    for (const [naam, waarde] of Object.entries(mijn.maten)) {
        stukken.push(`${naam} ${waarde}`);
    }
    if (mijn.sierpunt) stukken.push(`punt ${mijn.sierpunt}`);
    if (mijn.spijlSierpunt) stukken.push(`spijlpunt ${mijn.spijlSierpunt}`);

    const iets = stukken.length > 0;
    knop.disabled = !iets;
    wis.disabled = !iets;
    hint.textContent = iets
        ? `Uit ${mijn.gebaseerdOp}× bouwen: ${stukken.join(', ')}.`
        : 'De app kijkt af wat je het vaakst kiest en zet dat hier klaar. '
          + 'Nog niets geleerd — bouw eerst een paar keer iets.';

    // Dezelfde levensloop: de hoekknopjes veranderen op precies dezelfde
    // momenten als deze knop - na een bouw, na vergeten, en bij het openen.
    // Eén aanroeppunt in plaats van twee lijstjes die uit de pas gaan lopen.
    werkHoekknopjesBij();
}

/**
 * Je eerder gebruikte hoeken als knopjes onder het veld.
 *
 * WAAROM JUIST DIT VELD. "90, 1500" is een schrijfwijze die je moet onthouden:
 * paren, hoek eerst, min is de andere kant op. Bij een getalveld zie je aan de
 * eenheid wel wat er moet staan; hier niet. Een knopje met wat je vorige week
 * typte haalt dat weg zonder iets te verbergen - het veld blijft gewoon een
 * veld waar je zelf in kunt typen.
 */
function werkHoekknopjesBij() {
    const vak = document.getElementById('gw_hoeken');
    if (!vak || !velden.vervolg) return;

    let lijst = [];
    try {
        lijst = gewoonten.top(gewoonten.lees().hoek, 4);
    } catch {
        return;
    }

    vak.textContent = '';
    vak.hidden = lijst.length === 0;
    for (const h of lijst) {
        const knop = document.createElement('button');
        knop.type = 'button';
        knop.title = `${h.sleutel} — ${h.aantal}× gebruikt`;
        const tekst = document.createElement('span');
        tekst.textContent = h.sleutel;
        const keer = document.createElement('span');
        keer.className = 'gw_keer';
        keer.textContent = `${h.aantal}×`;
        knop.append(tekst, keer);
        knop.addEventListener('click', () => {
            velden.vervolg.value = h.sleutel;
            // Via een echte gebeurtenis, zodat het paneel precies hetzelfde
            // doet als wanneer je het zelf intypt: narekenen, keuren, en de
            // bouwknop aan of uit zetten.
            velden.vervolg.dispatchEvent(new Event('input', { bubbles: true }));
        });
        vak.append(knop);
    }
}

/**
 * Alles zetten op wat deze gebruiker het vaakst kiest.
 *
 * ALLEEN WAT ER GELEERD IS. Een veld dat je nooit anders hebt gezet blijft
 * staan zoals het staat; `mijnStandaard()` laat het weg en hier wordt er dus
 * niets mee gedaan. Zo kan deze knop nooit stilletjes iets veranderen waar je
 * niet om gevraagd hebt - dat zou van een gemak een valkuil maken.
 */
async function pasMijnStandaardToe() {
    const mijn = gewoonten.mijnStandaard();

    for (const [naam, waarde] of Object.entries(mijn.maten)) {
        const veld = velden[naam];
        if (!veld) continue;
        if (isVinkje(veld)) veld.checked = Number(waarde) !== 0;
        else veld.value = waarde;
    }

    if (mijn.sierpunt) { sierpuntKeuze = mijn.sierpunt; toonSierpunt(); }
    if (mijn.spijlSierpunt) { spijlPuntKeuze = mijn.spijlSierpunt; toonSpijlPunt(); }

    // De catalogus alleen inlezen als er echt een profiel terug te zetten is:
    // 2336 profielen ophalen voor niets is geen gemak.
    const wil = Object.values(mijn.profielen).some(Boolean);
    if (wil) {
        const { basis, versie } = await catalogusKlaar();
        for (const onderdeel of ['staander', 'handregel', 'spijl', 'boom']) {
            const bewaard = mijn.profielen[onderdeel];
            if (!bewaard) continue;
            profielen[onderdeel] = cfg.naarProfiel(bewaard, basis, versie);
            toonProfiel(onderdeel);
        }
    }

    werkAfgeleideBij();
    werkTrapBij();
    werkConfiguratiesBij();
    statusEl.textContent = `Mijn standaard toegepast — uit ${mijn.gebaseerdOp}× `
        + 'bouwen. Druk op Genereer balustrade.';
}

document.getElementById('gw_toepassen').addEventListener('click', async () => {
    const knop = document.getElementById('gw_toepassen');
    knop.disabled = true;
    try {
        await pasMijnStandaardToe();
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Mijn standaard toepassen mislukt: ' + err.message;
    } finally {
        werkMijnStandaardBij();
    }
});

document.getElementById('gw_vergeet').addEventListener('click', () => {
    // GEEN VRAAG VOORAF, WEL TERUG TE DRAAIEN? Nee - dit is niet terug te
    // draaien, dus hier hoort wel een vraag. Wat de app van je geleerd heeft
    // kun je niet uit een bestand terughalen.
    if (!confirm('Vergeten wat de app van je geleerd heeft? '
        + 'Je bewaarde configuraties en instellingen blijven staan.')) return;
    gewoonten.vergeet();
    werkMijnStandaardBij();
    statusEl.textContent = 'De geleerde voorkeuren zijn gewist.';
});

// Meteen in de goede stand bij het openen.
werkMijnStandaardBij();

// --- startscherm: trap of balustrade ---------------------------------------
//
// De eerste vraag is WAT je gaat maken, en daarna staat het goede kopje open.
// Het paneel heeft zeven groepen; zonder deze vraag begin je altijd bij
// Balustrade, ook als je voor een trap kwam.
//
// Dit zet NIETS vast. Beide groepen blijven in het paneel staan, dus je kunt
// altijd de andere openklappen. Het is een kortere weg, geen stand.

/** Klapt één groep open en de rest dicht; `naam` is de tekst van de kop. */
function openGroep(naam) {
    for (const g of document.querySelectorAll('#panel details.groep')) {
        const kop = g.querySelector('summary');
        g.open = kop && kop.textContent.trim() === naam;
    }
    werkTabsBij();
}

// --- sierpunten en paalkoppen ----------------------------------------------
//
// Het gekozen model staat in een eigen variabele en niet in een invulveld: het
// is een keuze uit een bibliotheek, net als een profiel. De hoogte en de vraag
// op welke staanders ze komen zijn wél gewone velden.
let sierpuntKeuze = SIERPUNT_GEEN;

/** Het gekozen sierpunt in het paneel zetten. */
function toonSierpunt() {
    const el = document.getElementById('pr_sierpunt');
    const model = modelVan(sierpuntKeuze);
    el.textContent = model ? model.naam : '— geen';
    el.classList.toggle('leeg', !model);
    document.getElementById('wis_sierpunt').disabled = !model;
    // De hoogte en 'waar' doen alleen iets als er een model staat.
    for (const id of ['p_sierpuntHoogte', 'p_sierpuntWaar']) {
        document.getElementById(id).disabled = !model;
    }
}

document.getElementById('kies_sierpunt').addEventListener('click', async () => {
    const knop = document.getElementById('kies_sierpunt');
    knop.disabled = true;
    try {
        // Of de staander rond is bepaalt welke modellen passen. Zonder profiel
        // is hij een massief blok, en dus vierkant.
        const rond = isRondProfiel(profielen.staander);
        const gekozen = await kiesSierpunt(sierpuntKeuze, rond);
        if (!gekozen) return;
        sierpuntKeuze = gekozen;
        toonSierpunt();
        werkAfgeleideBij();
        werkConfiguratiesBij();
        statusEl.textContent = `Sierpunt: ${modelVan(gekozen).naam} — druk op `
            + 'Genereer balustrade.';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Sierpunt kiezen mislukt: ' + err.message;
    } finally {
        knop.disabled = false;
    }
});

document.getElementById('wis_sierpunt').addEventListener('click', () => {
    sierpuntKeuze = SIERPUNT_GEEN;
    toonSierpunt();
    werkAfgeleideBij();
    werkConfiguratiesBij();
});

// Meteen bij het openen in de goede stand: zonder sierpunt staan de hoogte en
// de plaatskeuze uit.
toonSierpunt();

// --- gedraaide balusters ---------------------------------------------------
//
// De keuzelijst wordt uit de bibliotheek zelf gevuld. Geen tweede lijst met
// namen die achter kan gaan lopen: komt er morgen een model bij in
// balusters.js, dan staat het hier vanzelf.
{
    const keuze = document.getElementById('p_spijlModel');
    const geen = document.createElement('option');
    geen.value = balusters.RECHT;
    geen.textContent = 'rechte spijlen (geen baluster)';
    keuze.append(geen);
    for (const { groep, modellen } of balusters.perGroep()) {
        const vak = document.createElement('optgroup');
        vak.label = groep;
        for (const m of modellen) {
            const optie = document.createElement('option');
            optie.value = m.id;
            optie.textContent = m.naam;
            optie.title = m.omschrijving;
            vak.append(optie);
        }
        keuze.append(vak);
    }
}

/**
 * De melding onder de balusterkeuze.
 *
 * WAARSCHUW ALS HET NIET KAN, en zeg hoeveel het scheelt. Een baluster van 100
 * mm breed heeft hoogte nodig om een buik in te kunnen draaien; past hij niet,
 * dan weigert de bouw met een melding - maar dan heb je al op Genereer gedrukt.
 * Hier staat het terwijl je nog aan het kiezen bent.
 */
function toonBalusterLet(veld) {
    const let_ = document.getElementById('spijlModelLet');
    const keuze = velden.spijlModel;
    if (!let_ || !keuze) return;

    // Het materiaal doet alleen iets bij een baluster; bij rechte spijlen
    // staat het uit in plaats van een keuze te beloven die niets doet.
    const mat = velden.spijlMateriaal;
    if (mat) mat.disabled = !keuze.value;

    const vast = 'Rechte spijlen worden gedraaide balusters, zoals op een '
        + 'stenen bordestrap. De spijlbreedte is dan de maat van het vierkante '
        + 'voetblokje — reken op 80 à 120 mm, niet op 20.';
    if (!keuze.value) { let_.textContent = vast; return; }

    // De hoogte die een baluster krijgt is wat er tussen de regels overblijft,
    // en dat weet alleen het paneel nadat het heeft doorgerekend.
    const vrij = veld ? veld.vrijeHoogte : null;
    const breedte = Number(leesVeld(velden.spijlBreedte)) || 0;
    const reden = vrij ? balusters.pastBij(breedte, vrij) : null;
    if (reden) {
        let_.textContent = `Deze baluster past hier niet: ${reden}. Maak hem `
            + 'smaller of de leuning hoger.';
        return;
    }

    // DE VERHOUDING, en dat is het stuk dat ontbrak. Met de standaard
    // spijlbreedte van 20 mm wordt een klassieke vaasbaluster 1 op 33: een
    // breinaald met een bultje. Hij bouwt prima, dus weigeren zou verkeerd
    // zijn - maar er niets over zeggen ook.
    const advies = vrij ? balusters.slankheidsadvies(breedte, vrij) : null;

    // EN HET VULRAAMWERK. Dat zet twee extra regels per veld neer, en op een
    // stenen balustrade zitten die er niet: daar lopen de balusters van de
    // vloer tot onder de dekband. Alleen melden als het aanstaat, anders is
    // het ongevraagd advies over iets wat al goed staat.
    const raam = velden.vulraamwerk && isVinkje(velden.vulraamwerk)
        && velden.vulraamwerk.checked;
    const raamTekst = raam
        ? 'Het vulraamwerk zet nog twee regels tussen de staanders. Op een '
          + 'stenen balustrade zitten die er niet — zet het uit als je de '
          + 'balusters van de vloer tot onder de dekband wilt.'
        : '';

    let_.textContent = [advies, raamTekst].filter(Boolean).join(' ') || vast;
}

// --- de dekband ------------------------------------------------------------
//
// Zelfde opzet als de balusters: de keuzelijst wordt uit de bibliotheek zelf
// gevuld, zodat een nieuw model er vanzelf in staat.
{
    const keuze = document.getElementById('p_handregelModel');
    const geen = document.createElement('option');
    geen.value = dekbanden.GEEN;
    geen.textContent = 'gewone handregel (geen dekband)';
    keuze.append(geen);
    for (const { groep, modellen } of dekbanden.perGroep()) {
        const vak = document.createElement('optgroup');
        vak.label = groep;
        for (const m of modellen) {
            const optie = document.createElement('option');
            optie.value = m.id;
            optie.textContent = m.naam;
            optie.title = m.omschrijving;
            vak.append(optie);
        }
        keuze.append(vak);
    }
}

/** Het dekbandmateriaal doet alleen iets als er een dekband is. */
function toonDekbandLet() {
    const keuze = velden.handregelModel;
    const mat = velden.handregelMateriaal;
    if (!keuze || !mat) return;
    mat.disabled = !keuze.value;
}

// --- punten op de SPIJLEN --------------------------------------------------
//
// Een tweede keuze naast de punt op de paal, en dat is geen dubbelop. Op een
// smeedijzeren hek staat op elke staaf een punt terwijl op de paal een bol
// staat - twee verschillende onderdelen, met twee verschillende maten, want de
// punt volgt de breedte van wat eronder staat.
let spijlPuntKeuze = SIERPUNT_GEEN;

/** De gekozen spijlpunt in het paneel zetten, en de melding eronder. */
function toonSpijlPunt() {
    const el = document.getElementById('pr_spijlSierpunt');
    const model = modelVan(spijlPuntKeuze);
    el.textContent = model ? model.naam : '— geen';
    el.classList.toggle('leeg', !model);
    document.getElementById('wis_spijlSierpunt').disabled = !model;

    // WAARSCHUW ALS DE KEUZE NIETS DOET, in plaats van hem stil te negeren.
    //
    // Twee gevallen. Zonder overstek steekt de spijl nergens uit en zou de punt
    // IN de handregel staan; die wordt dus niet gebouwd. En zonder spijlen -
    // bij glas, liggende regels of een lege vulling - is er niets om een punt
    // op te zetten. Allebei makkelijk per ongeluk te doen, en zonder melding
    // druk je op Genereer en zie je niet waarom er niets gebeurt.
    const let_ = document.getElementById('spijlPuntLet');
    const overstek = Number(leesVeld(velden.spijlOverstek)) || 0;
    const soort = vullingSoort(velden.vulling ? velden.vulling.value : 'spijlen');
    let melding = '';
    if (soort !== 'spijlen' && (overstek > 0 || model)) {
        melding = 'Er staan geen spijlen in deze vulling, dus het overstek en '
            + 'de punt doen niets. Zet de vulling op verticale spijlen.';
    } else if (model && overstek <= 0) {
        melding = 'Zet een spijloverstek, anders staat de punt in de '
            + 'handregel en wordt hij niet gebouwd.';
    } else if (overstek > 0 && !model) {
        melding = 'De spijlen steken nu kaal boven de regel uit. Kies een punt '
            + 'als er iets op moet.';
    }
    let_.textContent = melding;
    let_.style.display = melding ? 'block' : 'none';
}

document.getElementById('kies_spijlSierpunt').addEventListener('click', async () => {
    const knop = document.getElementById('kies_spijlSierpunt');
    knop.disabled = true;
    try {
        // Of de SPIJL rond is, niet de staander: hier gaat het om de staaf
        // waar de punt op komt.
        const gekozen = await kiesSierpunt(spijlPuntKeuze,
            isRondProfiel(profielen.spijl));
        if (!gekozen) return;
        spijlPuntKeuze = gekozen;
        toonSpijlPunt();
        werkAfgeleideBij();
        werkConfiguratiesBij();
        statusEl.textContent = `Punt op de spijlen: ${modelVan(gekozen).naam} — `
            + 'druk op Genereer balustrade.';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Punt kiezen mislukt: ' + err.message;
    } finally {
        knop.disabled = false;
    }
});

document.getElementById('wis_spijlSierpunt').addEventListener('click', () => {
    spijlPuntKeuze = SIERPUNT_GEEN;
    toonSpijlPunt();
    werkAfgeleideBij();
    werkConfiguratiesBij();
});

toonSpijlPunt();

// --- zoeken in het paneel --------------------------------------------------
//
// De index wordt bij ELKE zoekopdracht opnieuw uit het paneel gelezen. Dat is
// niet duur - het zijn een paar tientallen elementen - en het betekent dat er
// nooit een tweede lijst met veldnamen bestaat die achter kan gaan lopen. Een
// veld dat er morgen bij komt is meteen te vinden.
const zoekVeld = document.getElementById('zoek');
const zoekLijst = document.getElementById('zoekLijst');
let zoekTreffers = [];
let zoekActief = -1;

function zoekSluit() {
    zoekLijst.hidden = true;
    zoekLijst.innerHTML = '';
    zoekTreffers = [];
    zoekActief = -1;
}

function zoekToon() {
    const treffers = zoek(maakIndex(document), zoekVeld.value);
    zoekTreffers = treffers;
    zoekActief = treffers.length ? 0 : -1;

    if (!zoekVeld.value.trim()) { zoekSluit(); return; }

    zoekLijst.innerHTML = '';
    if (treffers.length === 0) {
        const leeg = document.createElement('li');
        leeg.className = 'niets';
        leeg.textContent = 'Niets gevonden voor "' + zoekVeld.value.trim() + '".';
        zoekLijst.appendChild(leeg);
    }
    treffers.forEach((t, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.setAttribute('aria-selected', i === zoekActief ? 'true' : 'false');
        li.textContent = t.titel;
        // Waar het staat erbij, want dat is de helft van het antwoord.
        const waar = document.createElement('span');
        waar.className = 'waar';
        waar.textContent = `  ${t.soort} · ${t.groep}`;
        li.appendChild(waar);
        li.addEventListener('mousedown', (e) => { e.preventDefault(); gaNaar(t); });
        zoekLijst.appendChild(li);
    });
    zoekLijst.hidden = false;
}

/** Naar een treffer toe: het juiste tabblad open, in beeld, en even oplichten. */
function gaNaar(treffer) {
    if (treffer.groep) openGroep(treffer.groep);
    zoekSluit();
    zoekVeld.blur();

    const el = treffer.element;
    // ELKE INGEKLAPTE SECTIE ERBOVEN OPEN. Velden die niet bij elke leuning
    // nodig zijn staan onder "meer opties"; stuurde het zoeken je daarheen
    // zonder die sectie open te klappen, dan sta je op het goede tabblad te
    // kijken naar iets wat dicht zit - en dat is erger dan niets vinden.
    for (let d = el.closest('details'); d; d = d.parentElement?.closest('details')) {
        d.open = true;
    }
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    // Opnieuw starten als je twee keer hetzelfde zoekt: zonder het eerst weg
    // te halen speelt de animatie niet nog een keer af.
    el.classList.remove('zoekGevonden');
    void el.offsetWidth;
    el.classList.add('zoekGevonden');
    setTimeout(() => el.classList.remove('zoekGevonden'), 2000);
    if (treffer.focus) treffer.focus.focus({ preventScroll: true });
}

zoekVeld.addEventListener('input', zoekToon);
zoekVeld.addEventListener('focus', () => { if (zoekVeld.value) zoekToon(); });
zoekVeld.addEventListener('blur', () => setTimeout(zoekSluit, 120));
zoekVeld.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { zoekVeld.value = ''; zoekSluit(); return; }
    if (!zoekTreffers.length) return;
    if (e.key === 'Enter') { e.preventDefault(); gaNaar(zoekTreffers[zoekActief]); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    zoekActief = (zoekActief + (e.key === 'ArrowDown' ? 1 : -1) + zoekTreffers.length)
        % zoekTreffers.length;
    [...zoekLijst.children].forEach((li, i) =>
        li.setAttribute('aria-selected', i === zoekActief ? 'true' : 'false'));
});

// Ctrl-K of Cmd-K zet de cursor in het zoekveld, waar je ook bent. Dat is wat
// iedereen uit andere programma's gewend is.
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        zoekVeld.focus();
        zoekVeld.select();
    }
});

// --- de tabbalk ------------------------------------------------------------
//
// De groepen zijn tabbladen geworden. Er is hiervoor GEEN tweede lijst met
// namen aangelegd: de balk wordt gevuld uit de groepen zelf, dus een groep
// erbij zetten in de HTML is genoeg. Twee lijsten die allebei de namen kennen
// lopen vroeg of laat uit de pas.
//
// Onder water blijft het <details open>. Dat is precies wat een tabblad doet,
// het stond er al, en alles wat eraan hing - de startkeuze, het openklappen
// van Resultaat na het bouwen, de zelftest - blijft zo werken.
const tabBalk = document.getElementById('tabs');
const groepen = [...document.querySelectorAll('#panel details.groep')];

const groepNaam = (g) => {
    const kop = g.querySelector('summary');
    return kop ? kop.textContent.trim() : '';
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

/**
 * Het icoontje van een groep, of null als hij er geen heeft.
 *
 * Welk icoon erbij hoort staat als `data-icoon` op de groep zelf, en de
 * tekening ervan staat als <symbol> bovenin index.html. Hier wordt alleen de
 * verwijzing gelegd. Geen innerHTML met een lap SVG erin: dan zou de tekening
 * op twee plekken staan en kan er één achterlopen.
 */
function maakIcoon(groep) {
    const naam = groep.dataset.icoon;
    if (!naam) return null;
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16');
    svg.setAttribute('aria-hidden', 'true');
    const gebruik = document.createElementNS(SVG_NS, 'use');
    gebruik.setAttribute('href', '#ic-' + naam);
    // Oudere Safari kent alleen de xlink-vorm. Allebei zetten kost niets.
    gebruik.setAttributeNS(XLINK_NS, 'xlink:href', '#ic-' + naam);
    svg.appendChild(gebruik);
    return svg;
}

const tabKnoppen = groepen.map((groep) => {
    const knop = document.createElement('button');
    knop.type = 'button';
    knop.className = 'tabknop';
    knop.setAttribute('role', 'tab');

    const icoon = maakIcoon(groep);
    if (icoon) knop.appendChild(icoon);
    // De naam in een eigen span, want naast het icoon en de stip moet hij als
    // los stukje tekst te herkennen blijven.
    const naam = document.createElement('span');
    naam.className = 'naam';
    naam.textContent = groepNaam(groep);
    knop.appendChild(naam);

    knop.addEventListener('click', () => openGroep(groepNaam(groep)));
    tabBalk.appendChild(knop);
    return { knop, groep };
});

// Of er iets in Resultaat staat. Een stipje op dat tabblad als het er is en je
// ergens anders kijkt: als zijpaneelgroep klapte Resultaat vanzelf open en zag
// je het staan, maar een tabblad dat niet voorligt is onzichtbaar.
let heeftResultaat = false;

/** Zet het actieve tabblad in de balk, en het stipje op Resultaat. */
function werkTabsBij() {
    for (const { knop, groep } of tabKnoppen) {
        knop.setAttribute('aria-selected', groep.open ? 'true' : 'false');

        const hoortStip = heeftResultaat && !groep.open
            && groepNaam(groep) === 'Resultaat';
        const stip = knop.querySelector('.stip');
        if (hoortStip && !stip) {
            const nieuw = document.createElement('span');
            nieuw.className = 'stip';
            knop.appendChild(nieuw);
        } else if (!hoortStip && stip) {
            stip.remove();
        }
    }
}

werkTabsBij();

// GEEN MATEN VERANDEREN MET HET MUISWIEL. Staat de cursor in een getalveld en
// scrol je met de muis erboven, dan telt de browser de waarde stilletjes op of
// af. Bij het scrollen door het paneel veranderde zo de traphoogte zonder dat
// iemand het merkte - en verscheen er een trap op een werkplek die leeg hoorde
// te zijn. Het veld verliest daarom zijn focus zodra het wiel erover draait:
// de waarde blijft staan en het paneel scrolt gewoon door. Typen en de
// pijltjes werken zoals altijd.
document.addEventListener('wheel', (e) => {
    const veld = e.target;
    if (veld instanceof HTMLInputElement && veld.type === 'number'
            && veld === document.activeElement) {
        veld.blur();
    }
}, { passive: true });

// Het verborgen bestandsveld achter een gewone knop. Het veld zelf blijft
// staan; alleen de knop die de browser er zelf omheen tekent is weg.
document.getElementById('openModel')
    .addEventListener('click', () => document.getElementById('file').click());

const startDialoog = document.getElementById('startDialoog');

function kiesStart(naam) {
    openGroep(naam);
    if (startDialoog.open) startDialoog.close();
    // De statusregel meebewegen met de keuze, zodat er staat wat je nú moet
    // doen in plaats van een algemene zin.
    statusEl.textContent = 'Vul de maten in en druk op Genereer '
        + (naam === 'Trap' ? 'trap' : 'balustrade') + '.';
    // De cursor meteen in het eerste veld van die groep, zodat je kunt typen
    // zonder eerst te klikken.
    const eerste = document.querySelector(
        `#panel details.groep[open] input[type=number]`);
    if (eerste) eerste.focus();
    // GEEN voorbeeld bij het kiezen. Hier verscheen meteen een complete trap,
    // en de opdrachtgever wil een lege werkplek om mee te beginnen. Het
    // voorbeeld komt pas als je zelf iets aan de trap verandert.
}

document.getElementById('startTrap')
    .addEventListener('click', () => kiesStart('Trap'));
document.getElementById('startBalustrade')
    .addEventListener('click', () => kiesStart('Balustrade'));

// Escape of buiten klikken sluit het venster ook; dan blijft het staan zoals de
// pagina begint, met Balustrade open. Geen keuze is dus ook een keuze, en geen
// doodlopend scherm.
startDialoog.showModal();

// Meteen meerekenen tijdens het typen. Je ziet dan direct dat het aantal
// spijlen geen invoer is maar een gevolg: maak het veld langer en er komen
// spijlen bij, zonder dat je iets aanwijst.
function werkAfgeleideBij() {
    const maten = huidigeMaten();
    const fouten = valideer(maten);

    // De melding bij de spijlpunt hangt af van de vulling en van het overstek,
    // en allebei kunnen hier net gewijzigd zijn. Vóór de foutafhandeling, want
    // juist bij een fout wil je zien dat die keuze niets doet.
    toonSpijlPunt();

    if (fouten.length) {
        paneelFoutEl.textContent = fouten.join('\n');
        paneelFoutEl.style.display = 'block';
        genereerKnop.disabled = true;
        for (const el of Object.values(afgeleidEls)) el.textContent = '–';
        return null;
    }

    paneelFoutEl.style.display = 'none';
    genereerKnop.disabled = false;

    // Langs dezelfde weg als het bouwen zelf, anders klopt het voorbeeld niet.
    // Een te steile helling komt hier als fout naar buiten.
    let veld;
    try {
        veld = voorspelBalustrade(maten);
        toonBalusterLet(veld);
        toonDekbandLet();
    } catch (err) {
        toonBalusterLet(null);
        toonDekbandLet();
        paneelFoutEl.textContent = err.message;
        paneelFoutEl.style.display = 'block';
        genereerKnop.disabled = true;
        for (const el of Object.values(afgeleidEls)) el.textContent = '–';
        return null;
    }

    // WELK GETAL HIER STAAT HANGT VAN DE VULLING AF. Bij horizontale regels
    // zijn er geen spijlen; dan zou "0 spijlen, doorgang 0,0 mm" er staan en
    // dat is geen uitkomst maar een leugen. Hier komt dan het aantal liggende
    // regels te staan en de opening die daar tussen overblijft.
    // DE KOPJES BEWEGEN MEE MET DE GETALLEN. Eerst deden alleen de getallen
    // dat, en dan stond er bij glas "hart op hart: 621 × 728 × 10,76 mm" en
    // bij horizontale regels "aantal spijlen: 6 regels". Een label dat niet
    // hoort bij wat ernaast staat is erger dan geen label: het getal klopte
    // wel, maar je leest het verkeerd.
    const lig = veld.vulling === 'horizontaal' && veld.liggend;
    const glas = veld.vulling === 'glas' && veld.glas;
    const toon = lig ? veld.liggend : veld.spijlen;

    const rijen = glas ? {
        aantal: ['ruiten', '1 per veld'],
        doorgang: ['vrije opening', `${veld.glas.vrijeHoogte.toFixed(0)} mm`],
        steek: ['bestelmaat ruit',
            `${veld.glas.lengte.toFixed(0)} × ${veld.glas.hoogte.toFixed(0)}`
            + ` × ${veld.glas.dikte} mm`],
    } : lig ? {
        aantal: ['liggende regels', String(toon.aantal)],
        doorgang: ['opening verticaal', toon.doorgang.toFixed(1) + ' mm'],
        steek: ['hart op hart', toon.steek.toFixed(1) + ' mm'],
    } : veld.vulling === 'geen' ? {
        aantal: ['vulling', 'geen'],
        doorgang: ['vrije doorgang', '–'],
        steek: ['hart op hart', '–'],
    } : {
        aantal: ['aantal spijlen', String(toon.aantal)],
        doorgang: ['vrije doorgang', toon.doorgang.toFixed(1) + ' mm'],
        steek: ['hart op hart', toon.steek.toFixed(1) + ' mm'],
    };
    for (const [naam, [kop, waarde]] of Object.entries(rijen)) {
        afgeleidKoppen[naam].textContent = kop;
        afgeleidEls[naam].textContent = waarde;
    }
    // ALLEEN ALS DE VELDEN VAN ELKAAR VERSCHILLEN. Met een hoek erin zijn ze
    // niet even lang en krijgt elk zijn eigen aantal uit de veiligheidsregel;
    // hierboven staat dat van het eerste. Zonder deze melding leest het als
    // een getal voor het hele werk.
    //
    // Bij een recht stuk zijn alle velden gelijk en zegt "veld 1 van 3" niets
    // - dat is ruis bij elke gewone balustrade, want 2000 mm met een maximale
    // staanderafstand van 850 heeft er al drie.
    if (veld.veldenVerschillen) {
        afgeleidKoppen.aantal.textContent += ' (veld 1 van ' + veld.aantalVelden + ')';
    }

    // De waarschuwing bij een vulling die iets van de gebruiker vraagt. Die
    // staat hier en niet alleen in regels.json, want wie dit kiest moet het
    // zien zonder een bestand open te slaan.
    const let_ = {
        horizontaal:
            'Let op: horizontale regels zijn beklimbaar — een kind kan er zijn '
            + 'voet op zetten. Verschillende normen staan ze daarom niet toe '
            + 'waar kinderen komen, of eisen een andere maximale opening. De '
            + 'app rekent met ' + VULLING.maxDoorgangHorizontaal + ' mm; dat is '
            + 'een aanname en geen getoetste norm. Het vulraamwerk staat bij '
            + 'deze keuze vanzelf aan, want de regels moeten ergens tussen.',
        glas:
            'Let op: een leuning van glas hoort GELAAGD veiligheidsglas te zijn '
            + '— breekt een enkele ruit, dan is er geen leuning meer. De app '
            + 'tekent ' + GLAS.dikte + ' mm gelaagd en rekent met ' + GLAS.speling
            + ' mm speling rondom, maar maakt GEEN sterkteberekening: welke '
            + 'dikte je nodig hebt hangt af van de ruitmaat en de belasting. '
            + 'De ruit wordt op maat besteld en staat daarom niet in de '
            + 'zaaglijst en niet bij de snijdelen.',
    }[veld.vulling];
    vullingLetEl.style.display = let_ ? 'block' : 'none';
    if (let_) vullingLetEl.textContent = let_;
    afgeleidEls.helling.textContent = veld.helling < 0.01
        ? 'vlak' : veld.helling.toFixed(1) + '°';
    // Uit het veld zelf en niet opnieuw uitgerekend: padDelen geeft de maat
    // terug die er ECHT gebouwd wordt, inclusief een gekozen regelprofiel en
    // een handmatige invoer. Zonder vulraamwerk zijn er geen strips.
    afgeleidEls.strip.textContent = veld.stripBreedte === null
        ? 'geen raamwerk' : veld.stripBreedte.toFixed(1) + ' mm';
    return maten;
}

werkAfgeleideBij();

// --- technische keuring ----------------------------------------------------
//
// Derde opdracht. Dit is iets anders dan `valideer`: die kijkt of elk ingevuld
// GETAL binnen zijn grenzen valt. Deze keuring kijkt of de ONDERDELEN op elkaar
// passen - of een handregel breed genoeg is voor de paal waar hij overheen
// ligt, bijvoorbeeld. Dat werd nergens gecontroleerd, en het is in dit project
// vijf keer op rij misgegaan.

const keuringVak = document.getElementById('keuringVak');
const keuringLijstEl = document.getElementById('keuringLijst');
const autoCorrectieEl = document.getElementById('p_autoCorrectie');

/** Toont de bevindingen, of verbergt het vak als er niets is. */
function toonKeuring(bevindingen, gecorrigeerd = []) {
    keuringLijstEl.textContent = '';
    if (!bevindingen.length && !gecorrigeerd.length) {
        keuringVak.style.display = 'none';
        return;
    }
    keuringVak.style.display = 'block';

    for (const tekst of gecorrigeerd) {
        const p = document.createElement('p');
        p.className = 'hint';
        p.style.color = '#1a7f37';
        p.textContent = '✓ ' + tekst;
        keuringLijstEl.append(p);
    }

    // Dezelfde bevinding komt bij elke aansluiting terug - vier staanders
    // onder dezelfde te smalle regel geeft vier keer hetzelfde. Eén regel per
    // soort probleem, met het aantal erbij.
    const perTitel = new Map();
    for (const b of bevindingen) {
        const bestaand = perTitel.get(b.titel);
        if (bestaand) bestaand.aantal++;
        else perTitel.set(b.titel, { b, aantal: 1 });
    }

    for (const { b, aantal } of perTitel.values()) {
        const blok = document.createElement('div');
        blok.style.marginBottom = '8px';
        const kop = document.createElement('b');
        kop.textContent = b.titel + (aantal > 1 ? ` (${aantal}× )` : '');
        const regel = document.createElement('div');
        regel.className = 'hint';
        regel.style.marginTop = '2px';
        regel.textContent = `${b.tekst} Huidig: ${b.gemeten.toFixed(1)} mm. `
            + `Benodigd: ${b.nodig.toFixed(1)} mm.`
            + (b.voorstel ? ` Voorstel: ${b.voorstel.label}.` : '');
        blok.append(kop, regel);
        if (!b.voorstel) {
            const geen = document.createElement('div');
            geen.className = 'hint';
            geen.textContent = 'Geen automatische correctie beschikbaar: er is '
                + 'geen maat in dezelfde norm die voldoet.';
            blok.append(geen);
        }
        keuringLijstEl.append(blok);
    }
}

/**
 * Het uiterlijk met de afgekeurde onderdelen OPGELICHT.
 *
 * Punt 4 van de opdracht: "De gebruiker moet ook kunnen zien welk onderdeel het
 * probleem veroorzaakt. Markeer dit onderdeel in de 3D-viewer."
 *
 * De lijst `uiterlijk` loopt gelijk op met de solids in de vorm. Ligt er al een
 * model onder de balustrade, dan staan die solids er vóór en schuiven de onze
 * op; dat verschil is precies `uiterlijk.length - delen.length`. Zonder die
 * verschuiving zou bij een balustrade op een ingeladen plaat het verkeerde
 * onderdeel oplichten.
 *
 * Alleen het HOOFDDEEL licht op - het onderdeel dat de bevinding veroorzaakt -
 * en niet allebei. Lichtte de staander ook op, dan lijkt het alsof die
 * vervangen moet worden terwijl de handregel te smal is.
 */
function metAandacht(uiterlijk, delen, bevindingen) {
    if (!bevindingen.length || !Array.isArray(uiterlijk)) return uiterlijk;
    const verschuiving = uiterlijk.length - delen.length;
    const kopie = [...uiterlijk];
    for (const b of bevindingen) {
        const i = verschuiving + b.hoofddeel;
        if (i >= 0 && i < kopie.length) {
            kopie[i] = { sleutel: 'aandacht', kleur: 0xe8710a, ruwheid: 0.55 };
        }
    }
    return kopie;
}

/**
 * Keurt het gebouwde model en corrigeert zo nodig.
 *
 * CORRECTIES GRIJPEN AAN OP DE INVOER, niet op de geometrie. Een correctie is
 * "kies dit profiel in plaats van dat", waarna alles opnieuw gerekend wordt.
 * Daardoor kloppen de stuklijst, de zaaglengtes en de STEP-export vanzelf, en
 * is een visueel trucje onmogelijk - precies wat punt 7 van de opdracht eist.
 *
 * LUSBEWAKING: hoogstens een paar rondes, en nooit twee keer dezelfde
 * correctie. Zonder dat kan een correctie die een nieuw probleem maakt, dat
 * nieuwe probleem weer "oplossen" met de oude waarde, en dan blijft hij heen
 * en weer stuiteren.
 */
const MAX_CORRECTIERONDES = 3;

/**
 * @param gebouwd  wat er net gebouwd is
 * @param herbouw  bouwt opnieuw met de HUIDIGE profielkeuze. Een functie en
 *                 geen vaste aanroep, want er zijn vier manieren om te bouwen -
 *                 een losse balustrade, een trap met leuning, op geselecteerde
 *                 randen, en via een getypte opdracht - en ze moeten alle vier
 *                 gekeurd worden. Dat deden ze niet: de keuring hing alleen
 *                 aan de knop "Genereer balustrade", en op een TRAP (waar alles
 *                 schuin ligt en het dus eerder misgaat) gebeurde er niets.
 */
async function keurEnCorrigeer(gebouwd, herbouw) {
    const gedaan = [];
    const gebruikt = new Set();

    for (let ronde = 0; ronde <= MAX_CORRECTIERONDES; ronde++) {
        const verslag = keurGeometrie(gebouwd.delen, gebouwd.verbindingen);
        if (verslag.goed) {
            toonKeuring([], gedaan);
            return { gebouwd, bevindingen: [] };
        }

        // Bij elke bevinding het voorstel erbij zoeken, zodat de gebruiker het
        // ziet ook als automatisch corrigeren uit staat.
        //
        // De catalogus is hier al geladen als er een profiel gekozen is; is hij
        // dat niet, dan is er ook geen familie om in te zoeken en blijft het
        // bij de melding. Geen voorstel is beter dan een profiel uit een
        // willekeurige norm.
        const voorraad = catalogus ? alleProfielen(catalogus.boom) : [];
        for (const b of verslag.bevindingen) {
            const rauw = b.wens && b.wens.wat === 'breedte'
                ? zoekBreder(voorraad,
                    gebouwd.delen[b.wens.deel].profiel, b.wens.minstens)
                : null;
            // Omzetten naar dezelfde verwijzing die de profielkiezer oplevert,
            // zodat een automatisch gekozen profiel in niets verschilt van een
            // met de hand gekozen profiel.
            b.voorstel = rauw
                ? { ...maakVerwijzing(rauw, catalogus.info, catalogus.basis,
                                      catalogus.versie),
                    label: rauw.label }
                : null;
        }

        const eerste = verslag.bevindingen[0];
        const mag = autoCorrectieEl && autoCorrectieEl.checked;
        if (!mag || !eerste.voorstel || ronde === MAX_CORRECTIERONDES) {
            toonKeuring(verslag.bevindingen, gedaan);
            return { gebouwd, bevindingen: verslag.bevindingen };
        }

        // Welk invoerveld hoort bij het onderdeel dat te smal is?
        const soort = gebouwd.delen[eerste.wens.deel].soort;
        const sleutel = { handregel: 'handregel', staander: 'staander',
                          spijl: 'spijl' }[soort];
        const stempel = `${sleutel}:${eerste.voorstel.label}`;
        if (!sleutel || gebruikt.has(stempel)) {
            toonKeuring(verslag.bevindingen, gedaan);
            return { gebouwd, bevindingen: verslag.bevindingen };
        }
        gebruikt.add(stempel);

        // De correctie: een ander profiel kiezen en ALLES opnieuw bouwen.
        profielen[sleutel] = eerste.voorstel;
        toonProfiel(sleutel);
        gedaan.push(`${soort} vervangen door ${eerste.voorstel.label} `
            + `(was ${eerste.gemeten.toFixed(1)} mm, nodig `
            + `${eerste.nodig.toFixed(1)} mm).`);
        gebouwd = await herbouw();
    }
    return { gebouwd, bevindingen: [] };
}

genereerKnop.addEventListener('click', async () => {
    let maten = werkAfgeleideBij();
    if (!maten) return;

    genereerKnop.disabled = true;
    try {
        statusEl.textContent = 'Model wordt opgebouwd…';
        await bezigStart('Balustrade bouwen');

        // De gekozen profielen zitten al in `maten`; zie huidigeMaten(). Per
        // onderdeel, want een spijl hoort dunner te zijn dan een staander.
        let gebouwd = await bouwBalustrade(maten, bezigStap);

        // TECHNISCHE KEURING, en eventueel corrigeren. Dit gebeurt NA het
        // bouwen en vóór het tonen, zodat wat er in beeld komt het resultaat
        // is van de eventuele correctie - en niet het beeld dat je net hebt
        // afgekeurd. Zie keurEnCorrigeer.
        await bezigStap(3, 5, 'technisch keuren…');
        const keuring = await keurEnCorrigeer(gebouwd,
            async () => bouwBalustrade(huidigeMaten()));
        gebouwd = keuring.gebouwd;
        maten = huidigeMaten();
        // NA de keuring, want die kan nog iets gecorrigeerd hebben. Dan telt
        // mee wat er gebouwd IS, niet wat je had ingevuld.
        onthoudGewoonten();

        await bezigStap(4, 5, 'beeld opbouwen…');
        await toonVorm(gebouwd.shape, 'balustrade',
            metAandacht(gebouwd.uiterlijk, gebouwd.delen, keuring.bevindingen),
            gebouwd.delen);
        toonStuklijst(gebouwd.stuklijst);
        toonOnderdelen(gebouwd.onderdelen, gebouwd.boom);
        // De ring volmaken, maar alleen hier: op de goede afloop. Mislukt het,
        // dan blijft hij staan waar het werk bleef steken.
        zetRing(1);

        const gekozen = ['staander', 'handregel', 'spijl']
            .filter(k => profielen[k])
            .map(k => `${k} ${profielen[k].englishLabel}`);
        // De vulling in woorden die bij de keuze passen. "0 spijlen" bij een
        // leuning met liggende regels is geen uitkomst maar een leugen.
        const eersteVeld = (gebouwd.velden && gebouwd.velden[0]) || null;
        const vullingTekst =
            !eersteVeld || eersteVeld.vulling === 'spijlen'
                ? `${gebouwd.spijlen.aantal} spijlen, `
                  + `doorgang ${gebouwd.spijlen.doorgang.toFixed(1)} mm`
            : eersteVeld.vulling === 'geen' ? 'geen vulling'
            : eersteVeld.vulling === 'glas' && eersteVeld.glas
                ? `glas ${eersteVeld.glas.lengte.toFixed(0)}×`
                  + `${eersteVeld.glas.hoogte.toFixed(0)}×${eersteVeld.glas.dikte} mm`
            : eersteVeld.liggend
                ? `${eersteVeld.liggend.aantal} liggende regels, `
                  + `opening ${eersteVeld.liggend.doorgang.toFixed(1)} mm`
                : 'liggende regels';
        statusEl.textContent =
            `Balustrade ${maten.lengte}×${maten.hoogte} mm — ${vullingTekst}, ` +
            `${gebouwd.aantalDelen} delen. ` +
            (gekozen.length ? gekozen.join(', ') + '. ' : '') +
            'Exporteren kan met de knop rechts.';
    } catch (err) {
        console.error(err);
        paneelFoutEl.textContent = err.message;
        paneelFoutEl.style.display = 'block';
        statusEl.textContent = 'Bouwen mislukt.';
    } finally {
        // IN `finally`, niet na het tonen. Mislukt de bouw, dan moet de
        // melding net zo goed weg - anders blijft er een "bezig"-venster over
        // een foutmelding heen staan die je niet kunt lezen.
        bezigKlaar();
        genereerKnop.disabled = false;
    }
});

// --- trap ------------------------------------------------------------------
// Zelfde opzet als de balustrade: je geeft de hoogte, de regels bepalen het
// aantal treden, de optrede en de aantrede. Die drie zijn niet in te vullen.
const trapVelden = Object.fromEntries(
    Object.keys(TRAP_STANDAARD).map(naam => [naam, document.getElementById('t_' + naam)]));
const trapAfgeleid = {
    treden: document.getElementById('t_a_treden'),
    optreden: document.getElementById('t_a_optreden'),
    optrede: document.getElementById('t_a_optrede'),
    aantrede: document.getElementById('t_a_aantrede'),
    aanzet: document.getElementById('t_a_aanzet'),
    helling: document.getElementById('t_a_helling'),
};
const trapFoutEl = document.getElementById('trapFout');
const trapLetEl = document.getElementById('trapLet');
const trapKnop = document.getElementById('genereerTrap');

for (const [naam, veld] of Object.entries(trapVelden)) {
    veld.value = TRAP_STANDAARD[naam];
    veld.addEventListener('input', trapGewijzigd);
}

// Het materiaal van de treden. Staat BUITEN trapVelden omdat dat een keuzelijst
// is en geen getal; net als de leuningkeuze hieronder.
//
// DE SOORTEN TREDE, niet alle materialen. Hier stond de hele materiaallijst,
// en daar zat steen in - wat op een trede stil staal werd. Nu staat er alleen
// wat als trede gebouwd kan worden; zie treden.js.
const tredeMateriaalEl = document.getElementById('t_tredeMateriaal');
for (const soort of TREDESOORTEN) {
    const optie = document.createElement('option');
    optie.value = soort.materiaal;
    optie.textContent = soort.naam;
    tredeMateriaalEl.append(optie);
}
tredeMateriaalEl.value = 'staal';
// Een andere soort brengt zijn eigen dikte mee: een glazen trede van 8 mm
// bestaat niet. Alleen bij een KEUZE in de lijst, niet bij het terugzetten van
// een opgeslagen instelling - daar staat de dikte al goed bij.
tredeMateriaalEl.addEventListener('change', () => {
    trapVelden.tredeDikte.value = tredeSoortVan(tredeMateriaalEl.value).dikte;
    trapGewijzigd();
});
document.getElementById('t_leuning').addEventListener('change', trapGewijzigd);
const wandleuningEl = document.getElementById('t_wandleuning');
const stootbordenEl = document.getElementById('t_stootborden');
const platenEl = document.getElementById('t_platen');
for (const el of [wandleuningEl, stootbordenEl, platenEl,
                  document.getElementById('t_soort'), document.getElementById('t_draai')]) {
    el.addEventListener('change', trapGewijzigd);
}

function huidigeTrapMaten() {
    return {
        ...Object.fromEntries(
            Object.entries(trapVelden).map(([naam, veld]) => [naam, veld.valueAsNumber])),
        tredeMateriaal: tredeMateriaalEl.value,
        // Het gekozen profiel voor de trapboom.
        //
        // Dit ontbrak. Je kon bij Trap een UPN 220 uitzoeken, het paneel zette
        // hem netjes neer, en daarna bouwde "Genereer trap" toch een plaat -
        // want build-trap.js leest p.boomProfiel en dat kwam hier nooit vandaan.
        // De zelftest zag het niet, omdat die bouwTrap rechtstreeks aanriep met
        // een profiel erin in plaats van via de knop. Deel T doet het nu wél via
        // de knop.
        boomProfiel: profielen.boom,
        afwerking: afwerkingEl.value || null,
        soort: document.getElementById('t_soort').value,
        draai: document.getElementById('t_draai').value,
        // De losse trapdelen; zie regels.json onder trap.onderdelen.
        wandleuning: wandleuningEl.value,
        stootborden: stootbordenEl.checked,
        platen: platenEl.checked,
    };
}

function werkTrapBij() {
    const maten = huidigeTrapMaten();
    // Of een bordes kan hangt af van het AANTAL optreden, en dat volgt pas uit
    // de hoogte. Die controle staat daarom los van de gewone grenzen.
    const fouten = [...valideerTrap(maten), ...controleerBordes(maten),
                    ...controleerWentel(maten)];
    const wandFout = wandleuningFout(maten.wandleuning,
        document.getElementById('t_leuning').value, maten.soort);
    if (wandFout) fouten.push(wandFout);

    if (fouten.length) {
        trapFoutEl.textContent = fouten.join('\n');
        trapFoutEl.style.display = 'block';
        trapLetEl.style.display = 'none';
        trapKnop.disabled = true;
        for (const el of Object.values(trapAfgeleid)) el.textContent = '–';
        return null;
    }

    trapFoutEl.style.display = 'none';
    trapKnop.disabled = false;

    const t = berekenTrap(maten);
    trapAfgeleid.treden.textContent = t.bordes
        ? `${t.treden - 1} + bordes` : String(t.treden);
    trapAfgeleid.optreden.textContent = t.optreden;
    trapAfgeleid.optrede.textContent = t.optrede.toFixed(1) + ' mm';
    trapAfgeleid.aantrede.textContent = t.aantrede.toFixed(1) + ' mm';
    trapAfgeleid.aanzet.textContent = Math.round(t.aanzet) + ' mm';
    trapAfgeleid.helling.textContent = t.helling.toFixed(1) + '°';

    // Waarschuwingen zijn geen fouten: de trap mag wel, hij loopt alleen minder
    // prettig. Daarom geel en niet rood, en de knop blijft aan.
    const opmerkingen = beoordeelTrap(t);
    if (opmerkingen.length) {
        trapLetEl.textContent = opmerkingen.join('\n');
        trapLetEl.style.display = 'block';
    } else {
        trapLetEl.style.display = 'none';
    }

    return maten;
}

/**
 * Een trapmaat is veranderd: het paneel bijwerken en het voorbeeld tekenen.
 *
 * Los van werkTrapBij, want die wordt ook aangeroepen als de afwerking of een
 * balustradeprofiel verandert. Dan staat er misschien een gebouwde balustrade
 * in beeld, en die hoort niet door een trap vervangen te worden.
 */
function trapGewijzigd() {
    const maten = werkTrapBij();
    if (!maten) return;
    const leuning = document.getElementById('t_leuning').value;
    try {
        const { delen } = trapDelen(maten,
            leuning === 'geen' ? null : huidigeMaten(), leuning);
        toonVoorbeeld(delen, 'trap');
    } catch (err) {
        // Het voorbeeld is een gemak; mislukt het, dan blijft het beeld staan
        // en zegt Genereer wat er mis is.
        console.error(err);
    }
}

werkTrapBij();

trapKnop.addEventListener('click', async () => {
    const maten = werkTrapBij();
    if (!maten) return;

    trapKnop.disabled = true;
    try {
        statusEl.textContent = 'Model wordt opgebouwd…';
        const leuning = document.getElementById('t_leuning').value;

        // De leuningmaten komen uit het balustradekopje hierboven. Zo stel je
        // de leuning op een plek in, of hij nu los staat of op een trap.
        const leuningMaten = leuning === 'geen' ? null : huidigeMaten();
        let gebouwd = await bouwTrap(maten, leuningMaten, leuning);

        // Ook een TRAPLEUNING keuren. Juist daar ligt alles schuin, dus juist
        // daar gaat het mis - en hier gebeurde eerst helemaal niets.
        const keuring = await keurEnCorrigeer(gebouwd, async () =>
            bouwTrap(maten, leuning === 'geen' ? null : huidigeMaten(), leuning));
        gebouwd = keuring.gebouwd;
        onthoudGewoonten();

        await toonVorm(gebouwd.shape, 'trap',
            metAandacht(gebouwd.uiterlijk, gebouwd.delen, keuring.bevindingen),
            gebouwd.delen);
        toonStuklijst(gebouwd.stuklijst);
        toonOnderdelen(gebouwd.onderdelen, gebouwd.boom);

        const t = gebouwd.trap;
        statusEl.textContent =
            `Trap ${maten.hoogte} mm hoog — ${t.treden} treden, optrede `
            + `${t.optrede.toFixed(1)} mm, aantrede ${t.aantrede.toFixed(1)} mm, `
            + `aanzet ${Math.round(t.aanzet)} mm, ${t.helling.toFixed(1)}°`
            + (leuning === 'geen' ? '.' : `, leuning ${leuning}.`);
    } catch (err) {
        console.error(err);
        trapFoutEl.textContent = err.message;
        trapFoutEl.style.display = 'block';
        statusEl.textContent = 'Bouwen mislukt.';
    } finally {
        trapKnop.disabled = false;
    }
});

// --- stuklijst -------------------------------------------------------------
// Wat de werkplaats nodig heeft: welk profiel, welke zaaglengte, hoeveel stuks.
// De lijst komt uit dezelfde beschrijving als de geometrie, dus hij kan niet
// afwijken van wat er geexporteerd wordt.
const stuklijstVak = document.getElementById('stuklijstVak');
const stuklijstTabel = document.getElementById('stuklijstTabel');
let laatsteStuklijst = null;

const onderdelenVak = document.getElementById('onderdelenVak');
const onderdelenTabel = document.getElementById('onderdelenTabel');
let laatsteOnderdelen = null;

const zaaglijstVak = document.getElementById('zaaglijstVak');
const zaaglijstInhoud = document.getElementById('zaaglijstInhoud');
let laatsteZaaglijst = null;

const boomVak = document.getElementById('boomVak');
const boomTekstEl = document.getElementById('boomTekst');

const mm = (v) => Math.round(v).toLocaleString('nl');

/**
 * De samenstellingsboom tonen.
 *
 * Dit is géén derde lijst met eigen getallen: het zijn dezelfde
 * productieonderdelen als in de tabel eronder, alleen gegroepeerd zoals je ze
 * in elkaar zet. Zie samenstelling.js.
 *
 * Alles wat hier in de pagina komt is opgebouwd met textContent en niet met
 * ingeplakte HTML. De namen komen uit onze eigen code en niet uit invoer, maar
 * er staat verderop al een ontsnapfunctie voor het tekeningkader juist omdat
 * dat onderscheid makkelijk vervaagt.
 */
function toonBoom(boom) {
    if (!boom || !boom.kinderen || boom.kinderen.length === 0) {
        boomVak.style.display = 'none';
        return;
    }

    boomTekstEl.textContent = '';

    const wortel = document.createElement('div');
    wortel.className = 'wortel';
    wortel.textContent = boom.naam;
    boomTekstEl.appendChild(wortel);

    const regel = (klasse, aantal, naam, bij) => {
        const el = document.createElement('div');
        el.className = klasse;
        const st = document.createElement('span');
        st.className = 'st';
        st.textContent = `${aantal}× `;
        el.appendChild(st);
        el.appendChild(document.createTextNode(naam));
        if (bij) {
            const nr = document.createElement('span');
            nr.className = 'nr';
            nr.textContent = '  ' + bij;
            el.appendChild(nr);
        }
        return el;
    };

    for (const k of boom.kinderen) {
        if (k.type === 'onderdeel') {
            boomTekstEl.appendChild(
                regel('tak', k.aantal, k.naam, `nr ${String(k.nummer).padStart(3, '0')}`));
            continue;
        }
        boomTekstEl.appendChild(regel('tak', k.aantal, k.naam));
        for (const r of k.inhoud) {
            boomTekstEl.appendChild(
                regel('blad', r.aantal, r.soort,
                    `nr ${String(r.nummer).padStart(3, '0')} · ${mm(r.lengte)} mm`));
        }
    }

    boomVak.style.display = 'block';
}

/**
 * De unieke productieonderdelen tonen.
 *
 * Verschil met de stuklijst erboven: die groepeert op profiel en lengte, deze op
 * de GEOMETRIE van het onderdeel zelf. Zit er in één exemplaar een gat of een
 * verstek, dan splitst deze lijst wel en die niet.
 */
function toonOnderdelen(lijst, boom) {
    laatsteOnderdelen = lijst;
    // De boom hoort bij dezelfde onderdelen, dus hij wordt hier neergezet en
    // niet op zes losse plekken. Komt er geen boom mee, dan verdwijnt hij -
    // beter niets dan een boom van het vorige model.
    toonBoom(boom || null);

    if (!lijst || lijst.length === 0) {
        onderdelenVak.style.display = 'none';
        heeftResultaat = false;
        werkTabsBij();
        return;
    }
    // Resultaat MARKEREN, niet openzetten.
    //
    // Als zijpaneelgroep klapte dit vanzelf open: je had net gegenereerd en
    // moest het kunnen zien. Als tabblad zou datzelfde je wegtrekken van de
    // maten waar je mee bezig bent, en precies het 3D-beeld wegduwen waar je
    // na het bouwen naar wilt kijken. Een stipje op het tabblad zegt hetzelfde
    // zonder je ergens heen te slepen. Zie werkTabsBij.
    heeftResultaat = true;
    werkTabsBij();

    const totaal = lijst.reduce((s, u) => s + u.aantal, 0);

    onderdelenTabel.innerHTML =
        '<thead><tr><th>nr</th><th>onderdeel</th>'
        + '<th class="getal">st</th><th></th></tr></thead><tbody>'
        + lijst.map((u) => {
            const r = bomRegel(u);
            // Onder de naam alles wat je nodig hebt om het te maken: profiel,
            // zaaglengte, en daaronder materiaal, zaaghoek en afwerking. Het
            // paneel is smal, dus op regels onder elkaar; de volledige BOM met
            // elk gegeven in een eigen kolom zit in de CSV.
            const extra = [
                r.materiaal,
                r.zaaghoeken && r.zaaghoeken !== 'recht' ? `verstek ${r.zaaghoeken}` : '',
                r.afwerking,
            ].filter(Boolean).join(' · ');
            return `<tr><td class="nr">${r.positie}</td>`
                + `<td>${r.soort}<br><span class="maat">${r.profiel} · `
                + `${mm(r.zaaglengte)} mm</span>`
                + `${extra ? `<br><span class="maat">${extra}</span>` : ''}</td>`
                + `<td class="getal">${u.aantal}</td>`
                + `<td><button data-nr="${u.nummer}">STEP</button></td></tr>`;
        }).join('')
        + `</tbody><tfoot><tr><td colspan="2">${lijst.length} uniek</td>`
        + `<td class="getal">${totaal}</td><td></td></tr></tfoot>`;

    for (const knop of onderdelenTabel.querySelectorAll('button')) {
        knop.addEventListener('click',
            () => exporteerOnderdeel(Number(knop.dataset.nr)));
    }
    onderdelenVak.style.display = 'block';

    // Hier en niet op vijf plekken: elke bouwer komt via toonOnderdelen langs,
    // dus de zaaglijst hoort niet apart aangeroepen te worden. Dat is precies
    // waar de keuring eerder op stukliep - die zat maar in één van de vijf.
    toonZaaglijst(lijst);
    // Dezelfde onderdelenlijst, dus hier en niet apart aangeroepen - om
    // precies dezelfde reden als de zaaglijst hierboven.
    toonKosten(lijst);
}

/**
 * De kostenraming tonen.
 *
 * NOOIT ÉÉN BEDRAG WAAR EEN SCHATTING BEDOELD IS. De hoeveelheden komen uit
 * de gemeten geometrie en zijn hard; de tarieven komen van internet en lopen
 * per bron uiteen. Een regel met "€ 142,50" erachter leest als een prijs, en
 * dat is dit niet. Daarom een bereik, met de bron erbij.
 *
 * En een post zonder tarief wordt WEL getoond, in het rood, met "tarief niet
 * ingevuld". Hem weglaten zou het totaal te laag maken zonder dat iemand het
 * ziet - dat is het soort stille fout waar deze app niet van houdt.
 */
async function toonKosten(onderdelen) {
    const vak = document.getElementById('kostenVak');
    const inhoud = document.getElementById('kostenInhoud');
    const kop = document.getElementById('kostenKop');
    const slot = document.getElementById('kostenSlot');
    if (!vak) return;

    let raming;
    try {
        await kosten.laadTarieven();
        raming = kosten.berekenKosten(onderdelen, {});
    } catch (err) {
        console.error(err);
        vak.style.display = 'block';
        inhoud.textContent = '';
        kop.textContent = 'De tarieven zijn niet in te lezen: ' + err.message;
        slot.textContent = '';
        return;
    }

    kop.textContent = 'Richtprijzen, geen offerte. De hoeveelheden komen uit '
        + 'het model; de tarieven zijn opgezocht op ' + raming.gezien
        + ' en staan in tarieven.json.';

    inhoud.textContent = '';
    const regel = (naam, aantal, bedrag, klasse, bron) => {
        const r = document.createElement('div');
        r.className = 'ksRegel' + (klasse ? ' ' + klasse : '');
        const n = document.createElement('span');
        n.className = 'ksNaam';
        n.textContent = naam;
        if (bron) {
            const b = document.createElement('span');
            b.className = 'ksBron';
            b.textContent = ' · ' + bron;
            n.append(b);
        }
        const a = document.createElement('span');
        a.className = 'ksAantal';
        a.textContent = aantal;
        const g = document.createElement('span');
        g.className = 'ksBedrag';
        g.textContent = bedrag;
        r.append(n, a, g);
        inhoud.append(r);
    };

    for (const r of raming.regels) {
        regel(r.naam, `${r.hoeveelheid} ${r.eenheid}`,
              kosten.bereikTekst(r.laag, r.hoog),
              r.laag === null ? 'ksLeeg' : '',
              r.tarief && r.tarief.eigen ? 'eigen prijs' : (r.bron || ''));
    }
    regel('Totaal materiaal', '', kosten.bereikTekst(raming.laag, raming.hoog),
          'ksTotaal');

    const stukken = [];
    if (!raming.volledig) {
        stukken.push('Dit is een MATERIAALBEGROTING en geen kostprijs: '
            + 'arbeid, transport en montage zitten er niet in.');
    }
    if (raming.ontbreekt.length) {
        stukken.push('Zonder tarief: ' + raming.ontbreekt.join(', ')
            + '. Vul ze in tarieven.json in.');
    }
    if (raming.controle) {
        stukken.push(`Ter vergelijking, dezelfde `
            + `${raming.hoeveelheden.staalKg} kg tegen de prijs van een `
            + `afgewerkte constructie: `
            + `${kosten.bereikTekst(raming.controle.laag, raming.controle.hoog)}. `
            + 'Dat getal heeft arbeid er wél in zitten, dus het hoort hoger '
            + 'uit te komen.');
    }
    if (raming.hoeveelheden.onbekend.length) {
        stukken.push('Buiten de telling gebleven (geen gemeten vorm): '
            + raming.hoeveelheden.onbekend.join(', ') + '.');
    }
    slot.textContent = stukken.join(' ');
    vak.style.display = 'block';
    // De uitnodiging om eerst iets te bouwen kan weg zodra er iets staat.
    const leeg = document.getElementById('kostenLeeg');
    if (leeg) leeg.style.display = 'none';

    toonLeveranciers(raming);
}

// De lijst wordt één keer gelezen en daarna hergebruikt.
let leveranciers = null;

/**
 * Welke leveranciers bij DIT model horen.
 *
 * ALLEEN DE SOORTEN DIE ER ECHT IN ZITTEN. Een glasleverancier tonen bij een
 * leuning zonder glas is ruis; dan moet je door een lijst heen waar het meeste
 * niet voor jou is.
 *
 * EN GEEN AFSTANDEN. "Bedrijven bij jou in de buurt" zou vragen om je locatie
 * en om een adressendienst van buiten - geen van beide is hier, en een lijst
 * die doet alsof hij weet wie er dichtbij zit terwijl hij dat niet weet, is
 * erger dan een lijst zonder afstanden. Waar een plaats bekend is staat hij
 * erbij, en verder niets.
 */
async function toonLeveranciers(raming) {
    const vak = document.getElementById('levVak');
    const kop = document.getElementById('levKop');
    const inhoud = document.getElementById('levInhoud');
    if (!vak) return;

    try {
        if (!leveranciers) {
            leveranciers = await (await fetch('./leveranciers.json')).json();
        }
    } catch (err) {
        console.error(err);
        vak.style.display = 'none';
        return;
    }

    // Wat dit model nodig heeft: staal als er kilo's zijn, coating als er
    // gecoat wordt, en verder wat er besteld moet worden.
    const nodig = new Set();
    if (raming.hoeveelheden.staalKg > 0) nodig.add('staal');
    if (raming.hoeveelheden.coatM2 > 0) nodig.add('coating');
    for (const soort of Object.keys(raming.hoeveelheden.besteld)) nodig.add(soort);

    inhoud.textContent = '';
    let getoond = 0;
    for (const [soort, omschrijving] of Object.entries(leveranciers.soorten)) {
        if (!nodig.has(soort)) continue;
        const rij = (leveranciers.bedrijven || [])
            .filter(b => (b.soorten || []).includes(soort));
        if (!rij.length) continue;

        const titel = document.createElement('div');
        titel.className = 'levSoort';
        titel.textContent = omschrijving;
        inhoud.append(titel);

        for (const b of rij) {
            getoond++;
            const el = document.createElement('div');
            el.className = 'levRij';
            const a = document.createElement('a');
            a.href = b.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.textContent = b.naam;
            el.append(a);
            if (b.plaats) {
                const p = document.createElement('span');
                p.className = 'levPlaats';
                p.textContent = ' · ' + b.plaats;
                el.append(p);
            }
            const z = document.createElement('span');
            z.className = 'levZegt';
            z.textContent = b.zegt || '';
            el.append(z);
            if (b.onzeker) {
                const o = document.createElement('span');
                o.className = 'levOnzeker';
                o.textContent = 'Let op: ' + b.onzeker;
                el.append(o);
            }
            inhoud.append(el);
        }
    }

    kop.textContent = `Gevonden op ${leveranciers.gevonden} met een zoekopdracht `
        + 'en overgeschreven van hun eigen site. Niets van gecontroleerd: niet of '
        + 'ze nog bestaan, niet of ze leveren wat je nodig hebt, niet of ze goed '
        + 'of betaalbaar zijn. Een vertrekpunt om te bellen, geen keuze — en een '
        + 'bedrijf dat jullie kennen hoort hier bovenaan, niet een naam die een '
        + 'zoekmachine toevallig als eerste gaf.';
    vak.style.display = getoond > 0 ? 'block' : 'none';
}

/**
 * De zaaglijst tonen: per profiel de stangen met wat erin ligt.
 *
 * De balken staan op schaal van de stanglengte, dus de verhoudingen zijn echt.
 * Wat er niet in de balk zit is het positienummer van elk stuk zodra het te
 * smal wordt om te lezen; dat staat voluit in de CSV.
 */
function toonZaaglijst(lijst) {
    laatsteZaaglijst = null;
    if (!lijst || lijst.length === 0) {
        zaaglijstVak.style.display = 'none';
        return;
    }

    let z;
    try {
        z = maakZaaglijst(lijst);
    } catch (err) {
        // NIET STIL FALEN. Gaat dit stuk, dan staat het op het scherm en in de
        // console, zodat de zelftest erover valt in plaats van het te missen.
        console.error(err);
        zaaglijstInhoud.innerHTML =
            `<p class="zlTeLang">Zaaglijst maken mislukt: ${err.message}</p>`;
        zaaglijstVak.style.display = 'block';
        return;
    }
    laatsteZaaglijst = z;

    if (z.groepen.length === 0 && z.teLang.length === 0) {
        zaaglijstVak.style.display = 'none';
        return;
    }

    const pct = (v) => (v / z.stanglengte * 100).toFixed(4) + '%';
    const stukken = [];

    if (z.teLang.length) {
        stukken.push('<p class="zlTeLang"><b>Past niet in een stang.</b> '
            + z.teLang.map(t => `nr ${t.positie} is ${mm(t.lengte)} mm`).join(', ')
            + `, en een stang is ${mm(z.stanglengte)} mm. Hier moet een las in, `
            + 'of er zijn langere stangen nodig.</p>');
    }

    for (const g of z.groepen) {
        const kop = `<div class="zlKop">${g.profiel}`
            + (g.norm ? ` <span class="norm">${g.norm}</span>` : '') + '</div>';
        const kilo = g.gewicht === null ? ''
            : ` · ${g.gewicht.toFixed(1)} kg staal, `
              + `${g.gewichtBesteld.toFixed(1)} kg besteld`;
        const totaal = `<div class="zlTotaal">${g.aantalStangen} `
            + `stang${g.aantalStangen === 1 ? '' : 'en'} · ${g.aantalStukken} `
            + `stuk${g.aantalStukken === 1 ? '' : 'ken'} · `
            + `${(g.afvalDeel * 100).toFixed(1)}% afval${kilo}</div>`;

        const balken = g.stangen.map((s, i) => {
            const delen = s.stukken.map((stuk, k) => {
                // De zaagsnede als eigen streepje vóór elk stuk behalve het
                // eerste: een stang heeft al een recht einde. Het is 3 mm op
                // 6000, dus je ziet het nauwelijks - maar het is staal dat
                // wegvalt, en dan hoort het in de balk en niet alleen in de som.
                const snede = k > 0 && z.snede > 0
                    ? `<div class="zlSnede" style="width:${pct(z.snede)}"></div>` : '';
                const breed = stuk.lengte / z.stanglengte;
                return snede + `<div class="zlStuk" style="width:${pct(stuk.lengte)}" `
                    + `title="nr ${stuk.positie} · ${mm(stuk.lengte)} mm`
                    + `${stuk.hoeken ? ' · ' + stuk.hoeken : ''}">`
                    + `${breed > 0.06 ? stuk.positie : ''}</div>`;
            }).join('');
            return `<div class="zlStang"><span class="nr">${i + 1}</span>`
                + `<div class="zlBalk">${delen}</div>`
                + `<span class="zlRest">rest ${mm(s.rest)}</span></div>`;
        }).join('');

        stukken.push(`<div class="zlGroep">${kop}${totaal}${balken}</div>`);
    }

    // DE AANNAMES ERBIJ. Zonder deze regel ziet 4,8% afval eruit als een gemeten
    // feit, terwijl het uit twee getallen komt die nog bevestigd moeten worden.
    stukken.push(`<p class="zlAanname">Gerekend met stangen van `
        + `${mm(z.stanglengte)} mm en een zaagsnede van `
        + `${String(z.snede).replace('.', ',')} mm — allebei aannames, `
        + `aan te passen in regels.json. Eén snede per tussenruimte: een stang `
        + `heeft al een recht einde.</p>`);

    if (z.platen.length) {
        stukken.push(`<p class="zlAanname">${z.platen.length} plaatdeel`
            + `${z.platen.length === 1 ? '' : 'en'} staat hier niet in — die `
            + `worden uit plaat gesneden en zitten als DXF in het `
            + `productiepakket.</p>`);
    }

    zaaglijstInhoud.innerHTML = stukken.join('');
    zaaglijstVak.style.display = 'block';
}

document.getElementById('zaaglijstCsv').addEventListener('click', () => {
    if (!laatsteZaaglijst) return;
    downloadBestand(zaaglijstAlsCsv(laatsteZaaglijst), 'zaaglijst.csv');
    statusEl.textContent = `zaaglijst.csv opgeslagen — `
        + `${laatsteZaaglijst.aantalStangen} stangen, `
        + `${(laatsteZaaglijst.afvalDeel * 100).toFixed(1)}% afval.`;
});

/** De zaaglijst van het laatst gebouwde model, voor de zelftest. */
export const laatsteZaaglijstNu = () => laatsteZaaglijst;

/** Eén uniek onderdeel wegschrijven: de LOKALE vorm, niet de geplaatste. */
async function exporteerOnderdeel(nummer) {
    const u = laatsteOnderdelen && laatsteOnderdelen.find(x => x.nummer === nummer);
    if (!u) return;
    try {
        const bytes = await schrijfStep(u.vorm);
        downloadBestand(bytes, bestandsnaam(u.nummer));
        statusEl.textContent =
            `${bestandsnaam(u.nummer)} opgeslagen — ${beschrijf(u.deel).soort}, `
            + `${u.aantal}x nodig (${(bytes.length / 1024).toFixed(0)} kB).`;
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Onderdeel exporteren mislukt: ' + err.message;
    }
}

document.getElementById('onderdelenAlles').addEventListener('click', async () => {
    if (!laatsteOnderdelen) return;
    // Eén voor één, met een pauze ertussen. Browsers blokkeren een reeks
    // downloads die in één keer wordt afgevuurd; met een tussenpoos vraagt hij
    // het één keer en gaat de rest door.
    for (const u of laatsteOnderdelen) {
        await exporteerOnderdeel(u.nummer);
        await new Promise((klaar) => setTimeout(klaar, 400));
    }
    statusEl.textContent =
        `${laatsteOnderdelen.length} onderdelen opgeslagen als losse STEP-bestanden.`;
});

// --- het productiepakket ---------------------------------------------------
//
// Alles wat de werkplaats nodig heeft, in één ZIP. De losse knoppen hierboven
// blijven bestaan: soms wil je alleen de BOM, of alleen de STEP.
//
// WAT ERIN ZIT en waarom:
//   balustrade.stp        het geheel, om in te laden en na te meten
//   step/onderdeel_NNN    per uniek onderdeel, voor de werkvoorbereiding
//   dxf/onderdeel_NNN     de plaatdelen, voor de laser of de plasmatafel
//   productieblad.pdf     vier aanzichten met maten, titelblok en stuklijst
//   bom.csv               dezelfde stuklijst, om in te lezen
//
// De NAMEN komen overeen: onderdeel_003.stp, onderdeel_003.dxf en de regel met
// positie 003 in bom.csv gaan over hetzelfde stuk staal. Dat is het hele punt
// van een pakket - zonder die koppeling moet iemand het uitzoeken.

document.getElementById('productie').addEventListener('click', async () => {
    const knop = document.getElementById('productie');
    if (!laatsteOnderdelen || !laatsteOnderdelen.length) {
        statusEl.textContent =
            'Genereer eerst een balustrade of een trap; dan is er iets te maken.';
        return;
    }
    knop.disabled = true;
    try {
        const bestanden = await maakProductiepakket((t) => {
            statusEl.textContent = t;
        });
        const zip = maakZip(bestanden);
        const naam = (kaderGegevens().nummer || 'productie')
            .replace(/[^\w.-]+/g, '_') + '.zip';
        downloadBestand(zip, naam);
        statusEl.textContent = `${naam} opgeslagen — ${bestanden.length} bestanden, `
            + `${(zip.length / 1024).toFixed(0)} kB.`;
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Productiepakket maken mislukt: ' + err.message;
    } finally {
        knop.disabled = false;
    }
});

/**
 * Verzamelt alle bestanden van het pakket.
 *
 * Apart van de knop, zodat de zelftest hem kan aanroepen zonder dat er een
 * download start. Een test die downloads afvuurt is geen test.
 */
export async function maakProductiepakket(meld = () => {}) {
    const bestanden = [];

    meld('Productiepakket: STEP van het geheel...');
    const geheel = await schrijfStep(huidigeVorm());
    bestanden.push({ naam: 'balustrade.stp', data: geheel });

    meld('Productiepakket: STEP per onderdeel...');
    for (const u of laatsteOnderdelen) {
        bestanden.push({
            naam: 'step/' + bestandsnaam(u.nummer),
            data: await schrijfStep(u.vorm),
        });
    }

    // DXF alleen voor PLAATdelen. Een profiel wordt gezaagd, niet gesneden;
    // daar hoort een zaaglengte bij en geen snijbestand. maakDxf geeft null
    // voor alles wat geen plaat is, dus die beslissing staat op één plek.
    meld('Productiepakket: DXF van de plaatdelen...');
    let platen = 0;
    for (const u of laatsteOnderdelen) {
        const dxf = maakDxf(u.deel);
        if (!dxf) continue;
        platen++;
        bestanden.push({
            naam: 'dxf/' + bestandsnaam(u.nummer).replace(/\.stp$/, '.dxf'),
            data: dxf,
        });
    }

    // ÉÉN render, en alleen het isometrische beeld. Er stonden er vier op het
    // stuklijstblad, maar sinds er een getekende samenstelling in het pakket
    // zit lieten die precies hetzelfde zien. Wat een render wél kan en een
    // lijntekening niet, is kleur en materiaal laten zien; daarvoor is één
    // beeld genoeg.
    meld('Productiebestanden: het beeld opbouwen…');
    const aanzichten = [];
    const isoKeuze = AANZICHTEN.find(a => /isometr/i.test(a.naam));
    const isoBeeld = isoKeuze && rendersAanzicht(isoKeuze.richting, 1100, 760);
    if (isoBeeld) aanzichten.push({ naam: isoKeuze.naam, ...isoBeeld });

    meld('Productiepakket: het blad opmaken...');
    const bom = laatsteOnderdelen.map(bomRegel);
    // UIT DE ONDERDELEN, niet uit wat er op het scherm staat. Zo levert de knop
    // hetzelfde pakket of je het zaaglijstvak nu opengeklapt hebt of niet.
    const zaag = maakZaaglijst(laatsteOnderdelen);
    const k = kaderGegevens();
    const titel = {
        bedrijf: k.bedrijf, opdracht: k.opdracht, nummer: k.nummer,
        omschrijving: k.omschrijving, getekend: k.getekend, datum: k.datum,
    };

    // De getekende bladen. Dit is de enige stap in het pakket die na het bouwen
    // nog OCCT nodig heeft: elke projectie kost zo'n 130 ms, en bij vijf
    // onderdelen met elk twee aanzichten zijn dat er al veertien.
    const formaat = k.blad === 'A4' ? 'A4' : 'A3';
    const oc = await initOcct();

    // EERST DE ONDERDELEN, dan de samenstelling. Hoeveel onderdeelbladen het
    // worden hangt van de onderdelen zelf af; pas daarna is bekend wat er in
    // "blad 1 van ..." op de samenstelling hoort te staan. Erachter komen nog
    // twee bladen: de stuklijst en het zaagplan.
    meld(`Productiepakket: ${laatsteOnderdelen.length} onderdelen tekenen...`);
    const losseBladen = onderdelenbladen(oc, laatsteOnderdelen, {
        formaat, titel, voorAantal: 1, naAantal: 2,
    });
    const totaal = 1 + losseBladen.length + 2;

    meld('Productiepakket: de samenstelling projecteren...');
    const tekenblad = werkplaatsblad(oc, huidigeVorm(), {
        formaat, titel, delen: laatsteDelen,
        bladnummer: `blad 1 van ${totaal}`,
    });

    bestanden.push({
        naam: 'productieblad.pdf',
        data: maakProductieblad({
            formaat,
            aanzichten,
            bom,
            zaaglijst: zaag,
            vooraf: [tekenblad.tekeningen, ...losseBladen.map(b => b.tekeningen)],
            titel,
        }),
    });

    bestanden.push({ naam: 'bom.csv', data: bomAlsCsv(bom) });
    bestanden.push({ naam: 'zaaglijst.csv', data: zaaglijstAlsCsv(zaag) });

    meld(`Productiepakket: ${bestanden.length} bestanden `
        + `(${platen} plaatdelen met DXF).`);
    return bestanden;
}

/**
 * De BOM als CSV: één regel per uniek productieonderdeel.
 *
 * Verschil met de stuklijst-CSV erboven: die telt per SOORT en lengte, deze per
 * VORM. Zit er in één van de vier staanders een gat, dan staan hier twee
 * regels met elk hun eigen STEP-bestand, en daar telt de stuklijst er vier van
 * dezelfde.
 *
 * De kolom `step` koppelt elke regel aan het bestand dat de knop ernaast
 * wegschrijft. Zo weet de werkplaats welke tekening bij welke regel hoort.
 */
/**
 * De BOM-rijen als CSV-tekst.
 *
 * Losgetrokken uit de knop, zodat het productiepakket dezelfde CSV kan
 * meesturen. Twee keer dezelfde kolommen opschrijven gaat vroeg of laat uit
 * elkaar lopen, en dan verschilt de losse download van wat er in de ZIP zit.
 */
function bomAlsCsv(bom) {
    const komma = (v) => Number(v).toFixed(1).replace('.', ',');
    const regels = [
        ['positie', 'aantal', 'onderdeel', 'materiaal', 'profiel', 'norm',
         'zaaglengte (mm)', 'zaaghoeken', 'afwerking', 'step'],
        ...bom.map(r => [
            r.positie, r.aantal, r.soort, r.materiaal,
            r.profiel.replace(' × ', 'x'), r.norm,
            komma(r.zaaglengte), r.zaaghoeken, r.afwerking, r.bestand,
        ]),
    ];
    return regels.map(r => r.join(';')).join('\r\n');
}

document.getElementById('bomCsv').addEventListener('click', () => {
    if (!laatsteOnderdelen) return;
    downloadBestand(bomAlsCsv(laatsteOnderdelen.map(bomRegel)), 'bom.csv');
    statusEl.textContent = 'Onderdelenlijst opgeslagen als bom.csv — '
        + `${laatsteOnderdelen.length} unieke onderdelen.`;
});

function toonStuklijst(regels) {
    laatsteStuklijst = regels;
    if (!regels || regels.length === 0) {
        stuklijstVak.style.display = 'none';
        return;
    }

    const totaalStuks = regels.reduce((s, r) => s + r.aantal, 0);
    const totaalMeter = regels.reduce((s, r) => s + r.totaalLengte, 0) / 1000;

    stuklijstTabel.innerHTML =
        '<thead><tr><th>onderdeel</th><th>profiel</th>'
        + '<th class="getal">lengte</th><th class="getal">st</th></tr></thead><tbody>'
        // De norm klein onder de profielnaam. Bij een profiel uit de catalogus
        // hoort die erbij: "CHS 48.3x2.6" bestaat in twee normen, warm- en
        // koudgevormd, en die zijn niet hetzelfde profiel.
        + regels.map(r =>
            `<tr><td>${r.soort}</td>`
            + `<td>${r.profiel}`
            + `${r.norm ? `<br><span class="norm">${r.norm}</span>` : ''}`
            // Het materiaal alleen tonen als het GEEN staal uit de catalogus
            // is: bij een profiel staat de staalsoort al bij de norm, en een
            // stalen trede hoeft niet overal "Staal" te krijgen.
            + `${r.materiaalSleutel && r.materiaalSleutel !== 'staal'
                ? `<br><span class="norm">${r.materiaal}</span>` : ''}`
            // En de afwerking eronder. Die hoort erbij: hetzelfde profiel in
            // twee kleuren zijn twee bewerkingen in de werkplaats.
            + `${r.afwerking ? `<br><span class="norm">${r.afwerking}</span>` : ''}</td>`
            + `<td class="getal">${mm(r.lengte)}</td>`
            + `<td class="getal">${r.aantal}</td></tr>`).join('')
        + `</tbody><tfoot><tr><td colspan="2">totaal</td>`
        + `<td class="getal">${totaalMeter.toFixed(2)} m</td>`
        + `<td class="getal">${totaalStuks}</td></tr></tfoot>`;

    stuklijstVak.style.display = 'block';
}

document.getElementById('stuklijstCsv').addEventListener('click', () => {
    if (!laatsteStuklijst) return;

    // Puntkomma als scheidingsteken en een komma als decimaalteken: zo opent
    // Nederlandse Excel het bestand zonder dat je iets hoeft in te stellen.
    const komma = (v) => v.toFixed(1).replace('.', ',');
    // Norm en staalsoort erbij: met alleen een profielnaam kun je niet bestellen.
    // Leeg bij onderdelen die nog niet uit de catalogus komen.
    const regels = [
        ['onderdeel', 'profiel', 'norm', 'materiaal', 'afwerking',
         'lengte (mm)', 'aantal', 'totale lengte (mm)'],
        ...laatsteStuklijst.map(r => [
            r.soort,
            r.profiel.replace(' × ', 'x'),
            r.norm || '',
            r.materiaal || '',
            r.afwerking || '',
            komma(r.lengte),
            String(r.aantal),
            komma(r.totaalLengte),
        ]),
    ];
    const csv = regels.map(r => r.join(';')).join('\r\n') + '\r\n';

    // De BOM vooraan zorgt dat Excel de tekst als UTF-8 leest, zodat accenten
    // en het maal-teken niet verhaspelen.
    downloadBestand('﻿' + csv, 'stuklijst.csv');
});

// --- balustrade op een geselecteerde rand ----------------------------------
// Dit verbindt de twee helften van de viewer: de rand die je aanklikt in een
// ingeladen model levert de lengte en de richting, en daar wordt de balustrade
// op gebouwd. De plaat blijft staan; leuning en plaat komen samen in beeld en
// gaan samen mee in de export.
const opRandKnop = document.getElementById('opRand');
const opRandHint = document.getElementById('opRandHint');

function werkRandKnopBij() {
    const randen = gekozenRanden();
    if (randen.length === 0) {
        opRandKnop.disabled = true;
        opRandKnop.textContent = 'Op geselecteerde randen';
        opRandHint.textContent = 'Laad een STEP-model en klik op een liggende rand. '
            + 'Houd Shift ingedrukt om er meer bij te kiezen; om een hoek heen werkt ook.';
        return;
    }

    // Vooraf beoordelen, zodat je niet op een knop klikt die toch niet kan.
    const oordeel = beoordeelRanden(randen, huidigeMaten());
    if (oordeel.fout) {
        opRandKnop.disabled = true;
        opRandKnop.textContent = 'Op geselecteerde randen';
        opRandHint.textContent = oordeel.fout;
        return;
    }

    opRandKnop.disabled = false;
    opRandKnop.textContent = randen.length === 1
        ? 'Op geselecteerde rand' : `Op ${randen.length} randen`;

    const vorm = oordeel.gesloten ? 'gesloten rondom'
        : (oordeel.hoeken === 0 ? 'recht' : `${oordeel.hoeken} hoek(en)`);
    const spijlen = oordeel.velden.reduce((s, v) => s + v.spijlen.aantal, 0);
    opRandHint.textContent =
        `${oordeel.velden.length} veld(en), ${vorm}, samen `
        + `${Math.round(oordeel.totaleLengte)} mm. `
        + `${oordeel.punten.length} staanders, ${spijlen} spijlen.`;
}

opRandKnop.addEventListener('click', async () => {
    const randen = gekozenRanden();
    if (randen.length === 0) return;

    opRandKnop.disabled = true;
    try {
        statusEl.textContent = 'Balustrade op de randen bouwen...';
        let resultaat = await bouwBalustradeOpRanden(
            randen, huidigeMaten(), huidigeVorm());

        // Ook deze weg keuren. Hier ligt er bovendien al een model onder, dus
        // het oplichten moet de verschuiving meenemen; zie metAandacht.
        const keuring = await keurEnCorrigeer(resultaat, async () =>
            bouwBalustradeOpRanden(randen, huidigeMaten(), huidigeVorm()));
        resultaat = keuring.gebouwd;
        onthoudGewoonten();

        await toonVorm(resultaat.shape, 'model-met-balustrade',
            metAandacht(resultaat.uiterlijk, resultaat.delen, keuring.bevindingen),
            resultaat.delen);
        toonStuklijst(resultaat.stuklijst);
        toonOnderdelen(resultaat.onderdelen, resultaat.boom);

        const doorgangen = resultaat.velden.map(v => v.spijlen.doorgang);
        statusEl.textContent =
            `Balustrade op ${randen.length} rand(en) — ${resultaat.velden.length} veld(en), `
            + `${resultaat.hoeken} hoek(en), ${resultaat.aantalDelen} delen. `
            + `Grootste doorgang ${Math.max(...doorgangen).toFixed(1)} mm.`;
    } catch (err) {
        console.error(err);
        paneelFoutEl.textContent = err.message;
        paneelFoutEl.style.display = 'block';
        statusEl.textContent = 'Bouwen mislukt.';
    } finally {
        werkRandKnopBij();
    }
});

// --- instellingen bewaren en terughalen ------------------------------------
// Alle invulvelden in één JSON-bestand. Bewust géén browseropslag: een bestand
// kun je meesturen, in een map bij een project zetten, of aan een collega geven.
// Wat in je browser zit is alleen van jou en verdwijnt bij het legen van je
// cache.
const INSTEL_VERSIE = 1;

document.getElementById('instelOpslaan').addEventListener('click', () => {
    const instellingen = {
        versie: INSTEL_VERSIE,
        opgeslagen: new Date().toISOString(),
        balustrade: huidigeMaten(),
        trap: huidigeTrapMaten(),
        leuning: document.getElementById('t_leuning').value,
    };
    downloadBestand(JSON.stringify(instellingen, null, 2), 'instellingen.json');
    statusEl.textContent = 'Instellingen opgeslagen als instellingen.json.';
});

document.getElementById('instelLaden').addEventListener('click', () => {
    document.getElementById('instelBestand').click();
});

document.getElementById('instelBestand').addEventListener('change', async (event) => {
    const bestand = event.target.files[0];
    if (!bestand) return;
    event.target.value = ''; // zodat hetzelfde bestand nog eens gekozen kan worden

    try {
        const inhoud = JSON.parse(await bestand.text());

        // Een bestand van een latere versie kan velden bevatten die wij niet
        // kennen. Dat is geen ramp, maar wel iets om te melden in plaats van
        // stilletjes de helft te negeren.
        if (inhoud.versie > INSTEL_VERSIE) {
            statusEl.textContent =
                `Let op: dit bestand is van versie ${inhoud.versie}, deze app kent `
                + `versie ${INSTEL_VERSIE}. Onbekende instellingen zijn overgeslagen.`;
        }

        const gezet = vulVelden(velden, inhoud.balustrade)
                    + vulVelden(trapVelden, inhoud.trap);
        if (inhoud.leuning) document.getElementById('t_leuning').value = inhoud.leuning;
        if (inhoud.trap && inhoud.trap.tredeMateriaal) {
            tredeMateriaalEl.value = inhoud.trap.tredeMateriaal;
        }
        // De losse trapdelen. Een ouder bestand kent ze niet; dan staan ze uit,
        // zoals de trap toen ook was.
        if (inhoud.trap) {
            document.getElementById('t_soort').value = inhoud.trap.soort || 'recht';
            document.getElementById('t_draai').value = inhoud.trap.draai || 'rechts';
            wandleuningEl.value = inhoud.trap.wandleuning || 'geen';
            stootbordenEl.checked = Boolean(inhoud.trap.stootborden);
            platenEl.checked = Boolean(inhoud.trap.platen);
        }
        // De afwerking staat in allebei de maatsets, want het is één keuze voor
        // het hele werk. De balustrade is de bron; leeg betekent blank.
        if (inhoud.balustrade && 'afwerking' in inhoud.balustrade) {
            afwerkingEl.value = inhoud.balustrade.afwerking || '';
        }

        // En de PROFIELKEUZES. Die gingen al mee het bestand in - ze zitten in
        // huidigeMaten() - maar werden bij het laden nooit teruggezet. Je laadde
        // dus een ontwerp en kreeg stilletjes massieve blokken terug, terwijl de
        // maten wel klopten. Dat viel niet op omdat het model er nog steeds
        // uitzag als een leuning.
        //
        // De url wordt opnieuw opgebouwd met het exportmoment van de catalogus
        // die er NU ligt; het pad binnen de catalogus is de echte sleutel.
        await herstelProfielen(inhoud.balustrade, inhoud.trap);

        werkAfgeleideBij();
        werkTrapBij();

        if (inhoud.versie <= INSTEL_VERSIE) {
            statusEl.textContent = `${gezet} instellingen geladen uit ${bestand.name}.`;
        }
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Kon dit bestand niet lezen: ' + err.message;
    }
});

/**
 * De drie profielkeuzes uit een instellingenbestand terugzetten.
 *
 * Stil overslaan als er niets in staat: een bestand van vóór deze versie heeft
 * ze niet, en dat is geen fout. Lukt de catalogus niet, dan blijven de maten
 * wel geladen - dat is beter dan het hele bestand weigeren omdat een profiel
 * niet gevonden wordt.
 */
async function herstelProfielen(maten, trapMaten) {
    const bron = {
        staander: maten && maten.staanderProfiel,
        handregel: maten && maten.handregelProfiel,
        spijl: maten && maten.spijlProfiel,
        // De trapboom zit in de TRAPmaten en niet bij de balustrade. Hij werd
        // hier eerst helemaal niet teruggezet: je laadde een ontwerp met een
        // UPN 220 als boom en kreeg stilletjes een plaat terug.
        boom: trapMaten && trapMaten.boomProfiel,
    };
    if (!Object.values(bron).some(Boolean)) return;

    try {
        const { basis, versie } = await catalogusKlaar();
        for (const onderdeel of ['staander', 'handregel', 'spijl', 'boom']) {
            profielen[onderdeel] = bron[onderdeel]
                ? cfg.naarProfiel(cfg.uitProfiel(bron[onderdeel]), basis, versie)
                : null;
            toonProfiel(onderdeel);
        }
        werkAfgeleideBij();
        werkTrapBij();          // de boom raakt de trapmaten
    } catch (err) {
        console.error(err);
        statusEl.textContent =
            'De maten zijn geladen, maar de profielen niet: ' + err.message;
    }
}

/** Zet waarden in invulvelden, en negeert wat er niet in past. */
function vulVelden(doelVelden, waarden) {
    if (!waarden) return 0;
    let aantal = 0;
    for (const [naam, veld] of Object.entries(doelVelden)) {
        const waarde = waarden[naam];
        if (typeof waarde === 'number' && Number.isFinite(waarde)) {
            if (isVinkje(veld)) veld.checked = waarde !== 0;
            else veld.value = waarde;
            aantal++;
        }
    }
    return aantal;
}

// --- opdracht in woorden ---------------------------------------------------
// De zin wordt omgezet naar parameters, en die gaan door dezelfde validatie en
// dezelfde bouwers als het formulier hierboven. Er is dus geen tweede weg naar
// de geometrie: wat je typt komt uit bij precies dezelfde code.
const chatLog = document.getElementById('chatLog');
const chatInvoer = document.getElementById('chatInvoer');

function schrijfChat(klasse, html) {
    const regel = document.createElement('div');
    regel.className = klasse;
    regel.innerHTML = html;
    chatLog.appendChild(regel);
    chatLog.scrollTop = chatLog.scrollHeight;
}

const ontsnap = (s) => String(s).replace(/[<>&]/g,
    c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

// Wat er als laatste gemaakt is, zodat "maak hem hoger" ergens op slaat.
let laatsteOpdracht = null;

/**
 * Een getypte opdracht uitvoeren.
 *
 * De bezig-melding wordt hier in de `finally` weggehaald en niet in het
 * werk zelf. Deze functie heeft vijf korte wegen naar buiten - zin niet
 * begrepen, maten afgekeurd, catalogus stuk - en bij elk daarvan hoort de
 * melding net zo goed te verdwijnen als bij een geslaagde bouw.
 */
async function voerOpdrachtUit(tekst) {
    try {
        await voerOpdrachtKern(tekst);
    } finally {
        bezigKlaar();
    }
}

async function voerOpdrachtKern(tekst) {
    schrijfChat('ik', ontsnap(tekst));

    // NOEMT DE ZIN EEN PROFIEL, DAN MOET DE CATALOGUS ER EERST ZIJN. Hij wordt
    // pas bij de eerste keer geladen - 1743 bestanden - dus zonder dit zou
    // "staanders CHS 48,3" de eerste keer niets doen en de tweede keer wel.
    // Dat is precies het soort verschil waar je een uur naar zoekt.
    if (noemtProfiel(tekst) && !catalogus) {
        try {
            // 1743 bestanden: dit is de langste wachttijd van de hele chat en
            // tot nu toe de stilste. Daarom krijgt hij zijn eigen melding.
            await bezigStart('Profielcatalogus laden');
            await catalogusKlaar();
        } catch (err) {
            // Geen catalogus is geen reden om de hele zin te laten vallen: de
            // maten kunnen er prima uit, alleen het profiel niet.
            schrijfChat('nee', 'Profielcatalogus niet beschikbaar: '
                + ontsnap(err.message) + '<br>Ik lees de rest van de zin wel.');
        }
    }

    const gelezen = parseer(tekst, laatsteOpdracht,
        { profielen: catalogus ? alleProfielen(catalogus.boom) : [] });
    if (gelezen.fout) {
        schrijfChat('nee', ontsnap(gelezen.fout)
            + (gelezen.tip ? '<br>' + ontsnap(gelezen.tip) : ''));
        return;
    }

    // WAT ER NIET KON, METEEN ZEGGEN. Een zin die half begrepen wordt en half
    // stilletjes wordt weggegooid is erger dan een zin die wordt afgewezen:
    // dan bouw je iets anders dan je gevraagd hebt zonder dat je het ziet.
    for (const melding of gelezen.genegeerd || []) {
        schrijfChat('nee', ontsnap(melding));
    }

    // De profielen uit de zin toepassen alsof je ze in het paneel had gekozen.
    // Eén weg naar hetzelfde resultaat: dezelfde verwijzing als de
    // profielkiezer oplevert, dus de rest van de app merkt geen verschil.
    for (const [onderdeel, rauw] of Object.entries(gelezen.profielen || {})) {
        if (!rauw || !catalogus) continue;
        profielen[onderdeel] = {
            ...maakVerwijzing(rauw, catalogus.info, catalogus.basis, catalogus.versie),
            label: rauw.label,
        };
        toonProfiel(onderdeel);
    }
    if (gelezen.sierpunt) {
        sierpuntKeuze = gelezen.sierpunt;
        toonSierpunt();
    }
    if (gelezen.spijlSierpunt) {
        spijlPuntKeuze = gelezen.spijlSierpunt;
        toonSpijlPunt();
    }
    if (gelezen.sierpunt || gelezen.spijlSierpunt
        || Object.values(gelezen.profielen || {}).some(Boolean)) {
        werkConfiguratiesBij();
    }
    // De coatkleur geldt voor het hele werk, dus net als in het paneel één
    // keuze. Niet genoemd = laten staan wat er stond; '' = blank.
    if (gelezen.afwerking !== undefined) afwerkingEl.value = gelezen.afwerking;

    // Laten zien wat eruit kwam. Dat is niet alleen aardig voor de gebruiker:
    // het maakt zichtbaar dat er parameters tussen de zin en het model zitten.
    schrijfChat('uit', `Begrepen: ${ontsnap(gelezen.uitleg)}<br><code>`
        + ontsnap(JSON.stringify(gelezen.params)) + '</code>');

    // Onthouden, zodat een volgende zin als "maak hem hoger" hierop slaat.
    laatsteOpdracht = {
        actie: gelezen.actie,
        params: { ...gelezen.params },
        leuning: gelezen.leuning,
    };

    try {
        if (gelezen.actie === 'trap') {
            // Het paneel bijwerken, zodat je ziet wat er gebeurd is en het
            // daarna met de hand kunt bijstellen.
            for (const [naam, veld] of Object.entries(trapVelden)) {
                if (gelezen.params[naam] !== undefined) veld.value = gelezen.params[naam];
            }
            document.getElementById('t_leuning').value = gelezen.leuning;
            // De keuzes die geen getalveld zijn: tredesoort, stootborden,
            // platen, wandleuning. Een zin beschrijft de hele trap, dus wat
            // niet genoemd is gaat terug naar de standaard - net als de maten.
            const p = gelezen.params;
            if (p.tredeMateriaal !== undefined) tredeMateriaalEl.value = p.tredeMateriaal;
            if (p.stootborden !== undefined) stootbordenEl.checked = p.stootborden;
            if (p.platen !== undefined) platenEl.checked = p.platen;
            if (p.wandleuning !== undefined) wandleuningEl.value = p.wandleuning;
            if (p.soort !== undefined) document.getElementById('t_soort').value = p.soort;
            if (p.draai !== undefined) document.getElementById('t_draai').value = p.draai;
            // Wat er over de LEUNING gezegd is - overstek, balustervorm,
            // dekband, spijlbreedte - komt in het balustradepaneel: daar haalt
            // de trapleuning zijn maten vandaan.
            for (const [naam, veld] of Object.entries(velden)) {
                const w = (gelezen.leuningMaten || {})[naam];
                if (w !== undefined) veld.value = w;
            }
            const maten = werkTrapBij();
            if (!maten) {
                schrijfChat('nee', 'Die maten komen niet door de controle. '
                    + 'Zie de melding bij het kopje Trap.');
                return;
            }

            statusEl.textContent = 'Model wordt opgebouwd…';
            // bouwTrap meldt zelf nog geen stappen, dus de boog blijft leeg;
            // de draaiende veeg laat zien dat er gewerkt wordt. Liever dat dan
            // een percentage dat ik verzin.
            await bezigStart('Trap bouwen');
            const leuningMaten = gelezen.leuning === 'geen' ? null : huidigeMaten();
            let gebouwd = await bouwTrap(maten, leuningMaten, gelezen.leuning);

            // Ook via een getypte opdracht wordt er gekeurd. Anders hangt het
            // ervan af hóe je bouwt of de app je waarschuwt, en dat is geen
            // controle maar een loterij.
            await bezigStap(1, 2, 'technisch keuren…');
            const keuring = await keurEnCorrigeer(gebouwd, async () =>
                bouwTrap(maten, gelezen.leuning === 'geen' ? null : huidigeMaten(),
                         gelezen.leuning));
            gebouwd = keuring.gebouwd;
            onthoudGewoonten();

            await bezigStap(2, 2, 'beeld opbouwen…');
            await toonVorm(gebouwd.shape, 'trap',
                metAandacht(gebouwd.uiterlijk, gebouwd.delen, keuring.bevindingen),
                gebouwd.delen);
            toonStuklijst(gebouwd.stuklijst);
        toonOnderdelen(gebouwd.onderdelen, gebouwd.boom);

            const t = gebouwd.trap;
            statusEl.textContent =
                `Trap ${maten.hoogte} mm hoog — ${t.treden} treden, optrede `
                + `${t.optrede.toFixed(1)} mm, aantrede ${t.aantrede.toFixed(1)} mm, `
                + `aanzet ${Math.round(t.aanzet)} mm, ${t.helling.toFixed(1)}°.`;

            schrijfChat('uit', `Klaar. ${t.treden} treden van ${t.optrede.toFixed(1)} mm, `
                + `aanzet ${Math.round(t.aanzet)} mm — berekend uit de hoogte.`
                + (gebouwd.opmerkingen.length
                    ? '<br>' + ontsnap(gebouwd.opmerkingen.join(' ')) : ''));
            return;
        }

        if (gelezen.actie === 'blok') {
            statusEl.textContent = 'Model wordt opgebouwd…';
            // Een blok is zo gemaakt, maar is het de eerste bouw van de
            // sessie, dan wordt hier wel de 48 MB OCCT geladen.
            await bezigStart('Blok bouwen');
            const { shape } = await bouwBlok(gelezen.params);
            await toonVorm(shape, 'blok');
            const p = gelezen.params;
            statusEl.textContent =
                `Blok ${p.breedte}×${p.diepte}×${p.hoogte} mm. Exporteren kan met de knop rechts.`;
            schrijfChat('uit', 'Klaar. Staat in beeld.');
            return;
        }

        // balustrade: het formulier bijwerken, zodat je ziet wat er gebeurd is
        // en het daarna met de hand kunt bijstellen.
        for (const [naam, veld] of Object.entries(velden)) {
            if (gelezen.params[naam] !== undefined) veld.value = gelezen.params[naam];
        }
        const maten = werkAfgeleideBij();
        if (!maten) {
            schrijfChat('nee', 'Die maten komen niet door de controle. Zie de melding hierboven.');
            return;
        }

        statusEl.textContent = 'Model wordt opgebouwd…';
        await bezigStart('Balustrade bouwen');
        let gebouwd = await bouwBalustrade(maten, bezigStap);
        await bezigStap(3, 5, 'technisch keuren…');
        const keuringB = await keurEnCorrigeer(gebouwd,
            async () => bouwBalustrade(huidigeMaten()));
        gebouwd = keuringB.gebouwd;
        onthoudGewoonten();
        await bezigStap(4, 5, 'beeld opbouwen…');
        await toonVorm(gebouwd.shape, 'balustrade',
            metAandacht(gebouwd.uiterlijk, gebouwd.delen, keuringB.bevindingen),
            gebouwd.delen);
        toonStuklijst(gebouwd.stuklijst);
        toonOnderdelen(gebouwd.onderdelen, gebouwd.boom);
        zetRing(1);
        statusEl.textContent =
            `Balustrade ${maten.lengte}×${maten.hoogte} mm — ${gebouwd.spijlen.aantal} spijlen, `
            + `doorgang ${gebouwd.spijlen.doorgang.toFixed(1)} mm, ${gebouwd.aantalDelen} delen.`;
        schrijfChat('uit', `Klaar. ${gebouwd.spijlen.aantal} spijlen, `
            + `doorgang ${gebouwd.spijlen.doorgang.toFixed(1)} mm — berekend, niet door mij verzonnen.`
            + '<br>Stuklijst staat in het paneel.');
    } catch (err) {
        console.error(err);
        schrijfChat('nee', ontsnap(err.message));
        statusEl.textContent = 'Bouwen mislukt.';
    }
}

document.getElementById('chatVerstuur').addEventListener('click', () => {
    const tekst = chatInvoer.value;
    if (!tekst.trim()) return;
    chatInvoer.value = '';
    voerOpdrachtUit(tekst);
});

chatInvoer.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('chatVerstuur').click();
});

schrijfChat('uit', 'Probeer bijvoorbeeld:<br>'
    + '<code>maak een kubus van 300 mm</code><br>'
    + '<code>blok van 300 bij 200 bij 150</code><br>'
    + '<code>balustrade van 2,5 meter lang en 1 meter hoog</code><br>'
    + '<code>trap van 3 meter hoog met leuning</code><br>'
    + 'Er mag meer in één zin:<br>'
    + '<code>balustrade van 3 meter lang, staanders CHS 48,3x3,2, '
    + '90 graden na 1500 mm, 80 mm spijloverstek en een speerpunt '
    + 'op de spijlen</code><br>'
    + 'En daarna bijstellen met <code>maak hem 200 hoger</code>');

// --- het tekeningkader -----------------------------------------------------
//
// Een blad met het 3D-aanzicht, de stuklijst en een titelblok. Zie kader.js,
// ook voor waarom dit niet het echte MvL-kader is.
//
// De bedrijfsgegevens en het logo blijven in de browser bewaard, net als een
// profielconfiguratie: ze horen bij het bedrijf en niet bij één order, dus je
// wilt ze niet bij elke tekening opnieuw intypen.
const KADER_SLEUTEL = 'railing-configurator/tekeningkader/1';

function leesKaderVast() {
    try { return JSON.parse(localStorage.getItem(KADER_SLEUTEL) || '{}') || {}; }
    catch { return {}; }
}
function schrijfKaderVast(waarden) {
    try { localStorage.setItem(KADER_SLEUTEL, JSON.stringify(waarden)); }
    catch { /* privévenster; dan vul je het per keer in */ }
}

const bedrijfEl = document.getElementById('k_bedrijf');
const logoInvoer = document.getElementById('k_logo');
let logoData = null;

{
    const vast = leesKaderVast();
    bedrijfEl.value = vast.bedrijf || '';
    logoData = vast.logo || null;
}

bedrijfEl.addEventListener('change', () =>
    schrijfKaderVast({ bedrijf: bedrijfEl.value, logo: logoData }));

logoInvoer.addEventListener('change', async () => {
    const bestand = logoInvoer.files[0];
    if (!bestand) return;
    // Als data-url, zodat hij mee kan naar het printvenster. Een blob-url zou
    // daar niet gelden: dat is een ander document.
    logoData = await new Promise((klaar, mis) => {
        const lezer = new FileReader();
        lezer.onload = () => klaar(lezer.result);
        lezer.onerror = () => mis(new Error('kon het logo niet lezen'));
        lezer.readAsDataURL(bestand);
    }).catch((err) => { statusEl.textContent = err.message; return null; });

    schrijfKaderVast({ bedrijf: bedrijfEl.value, logo: logoData });
    statusEl.textContent = logoData ? 'Logo bewaard.' : 'Logo niet gelezen.';
});

document.getElementById('k_logoWis').addEventListener('click', () => {
    logoData = null;
    logoInvoer.value = '';
    schrijfKaderVast({ bedrijf: bedrijfEl.value, logo: null });
    statusEl.textContent = 'Logo weggehaald.';
});

document.getElementById('k_maak').addEventListener('click', () => {
    if (!laatsteOnderdelen || !laatsteOnderdelen.length) {
        statusEl.textContent =
            'Genereer eerst een balustrade of een trap; dan is er iets te tekenen.';
        return;
    }
    try {
        const venster = window.open('', '_blank');
        if (!venster) {
            statusEl.textContent =
                'De browser blokkeerde het venster. Sta pop-ups toe voor deze pagina.';
            return;
        }
        venster.document.write(maakBlad(kaderGegevens()));
        venster.document.close();
        statusEl.textContent = 'Tekening geopend in een nieuw venster.';
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Tekening maken mislukt: ' + err.message;
    }
});

/** Alles wat er op het blad komt, bij elkaar. */
function kaderGegevens() {
    const bom = (laatsteOnderdelen || []).map(bomRegel);
    const stuks = bom.reduce((s, r) => s + r.aantal, 0);
    return {
        blad: document.getElementById('k_blad').value,
        bedrijf: bedrijfEl.value,
        logo: logoData,
        opdracht: document.getElementById('k_opdracht').value,
        nummer: document.getElementById('k_nummer').value,
        omschrijving: document.getElementById('k_omschrijving').value,
        getekend: document.getElementById('k_getekend').value,
        datum: new Date().toLocaleDateString('nl'),
        afbeelding: aanzichtAlsAfbeelding(),
        bom,
        samenvatting: `${bom.length} uniek, ${stuks} stuks`,
    };
}

/**
 * Het 3D-beeld als afbeelding.
 *
 * Dit werkt alleen omdat de renderer met `preserveDrawingBuffer` is gemaakt;
 * anders is de tekenbuffer leeg zodra het beeld is samengesteld en krijg je
 * een wit vlak. Voor de zekerheid wordt er eerst nog één keer getekend.
 */
function aanzichtAlsAfbeelding() {
    try {
        renderer.render(scene, camera);
        return renderer.domElement.toDataURL('image/png');
    } catch (err) {
        console.error(err);
        return null;
    }
}

// --- aanzichten voor het productieblad -------------------------------------
//
// De vier kanten die een werkplaats wil zien, plus een iso om te snappen wat
// het is. De richtingen zijn de kijkRICHTING van de camera naar het model toe,
// in het assenstelsel van dit project: Z omhoog, -Y de voorkant.
/**
 * De onderdelen van het laatst gebouwde model.
 *
 * Geëxporteerd zodat de zelftest het productieblad kan nabouwen met dezelfde
 * gegevens als de knop gebruikt. Zonder dit zou de test zijn eigen stuklijst
 * moeten verzinnen, en dan test hij niet wat er uit de app komt.
 */
export const laatsteOnderdelenNu = () => laatsteOnderdelen;

export const AANZICHTEN = [
    { naam: 'Vooraanzicht', richting: [0, -1, 0] },
    { naam: 'Zijaanzicht',  richting: [1, 0, 0] },
    { naam: 'Bovenaanzicht', richting: [0, 0, 1] },
    { naam: 'Isometrisch',  richting: [1, -1, 0.8] },
];

/**
 * Rendert het model vanuit één richting en geeft de JPEG terug.
 *
 * ZET DE MAATVOERING AAN, ongeacht het vinkje in de balk. Op een
 * productieblad horen de maten erbij; of je ze op het scherm aan hebt staan is
 * een andere vraag. Daarna gaat alles terug zoals het stond - camera, formaat
 * en zichtbaarheid - want anders staat het beeld na het exporteren ineens
 * ergens anders en lijkt het alsof de knop het model heeft verzet.
 */
export function rendersAanzicht(richting, breedtePx, hoogtePx) {
    const was = {
        positie: camera.position.clone(),
        doel: controls.target.clone(),
        omhoog: camera.up.clone(),
        aspect: camera.aspect,
        near: camera.near,
        far: camera.far,
        maten: matenGroep ? matenGroep.visible : null,
        formaat: new THREE.Vector2(),
    };
    renderer.getSize(was.formaat);

    try {
        if (matenGroep) matenGroep.visible = true;
        renderer.setSize(breedtePx, hoogtePx, false);
        camera.aspect = breedtePx / hoogtePx;
        camera.updateProjectionMatrix();

        const kijk = new THREE.Vector3(...richting).normalize();
        // BIJ EEN BOVENAANZICHT kijkt de camera langs zijn eigen omhoog-as. Het
        // kruisproduct van die twee is dan nul, en daar komt NaN uit: geen
        // beeld, of een beeld vanuit het niets. Voor dat ene geval wijst
        // "omhoog" op het blad naar het noorden, zoals op een plattegrond.
        if (Math.abs(kijk.dot(was.omhoog)) > 0.999) camera.up.set(0, 1, 0);
        richtCameraOp(modelRoot, kijk);
        renderer.render(scene, camera);
        return jpegVanCanvas(renderer.domElement, 0.92);
    } catch (err) {
        console.error(err);
        return null;
    } finally {
        renderer.setSize(was.formaat.x, was.formaat.y, false);
        camera.aspect = was.aspect;
        camera.near = was.near;
        camera.far = was.far;
        camera.up.copy(was.omhoog);
        camera.position.copy(was.positie);
        camera.updateProjectionMatrix();
        controls.target.copy(was.doel);
        controls.update();
        if (matenGroep && was.maten !== null) matenGroep.visible = was.maten;
    }
}

// --- de profielkiezer ------------------------------------------------------
// De catalogus wordt één keer gelezen en daarna hergebruikt. Het venster mag
// geen STEP-bestand openen: de acceptatie-eis is dat het binnen een seconde
// open staat, en 1743 bestanden inlezen duurt ruim een minuut.
let catalogus = null;

/** Laadt de catalogus één keer en houdt hem vast. */
async function catalogusKlaar() {
    if (catalogus) return catalogus;
    statusEl.textContent = 'Profielcatalogus laden...';
    catalogus = await laadCatalogus();
    const a = catalogus.boom.aantallen;
    console.log(`Profielcatalogus: ${a.profielen} profielen in ${a.normen} `
        + `normen (${a.regelsInManifest} regels, ${a.dubbelen} dubbel)`);
    return catalogus;
}

function toonProfiel(onderdeel) {
    const el = document.getElementById('pr_' + onderdeel);
    const p = profielen[onderdeel];
    // De trapboom valt terug op een plaat, de rest op een massief blok.
    el.textContent = p ? p.englishLabel
        : (onderdeel === 'boom' ? '— plaat op maat' : '— massief blok');
    el.title = p ? `${p.englishLabel} · ${p.standardLabel}` : '';
    el.classList.toggle('leeg', !p);
    document.getElementById('wis_' + onderdeel).disabled = !p;
}

// --- bewaarde profielconfiguraties -----------------------------------------
//
// De vijf keuzes die bij een werkplaats meestal vastliggen: drie profielen, het
// materiaal van de treden en de coatkleur. Onder een naam bewaren en later in
// één klik terughalen. Zie configuraties.js, ook voor waarom dit wél in de
// browser bewaard wordt en de instellingen niet.
const cfgKeuze = document.getElementById('cfg_keuze');
const cfgNaam = document.getElementById('cfg_naam');

/** De zes keuzes zoals ze nu staan. */
function huidigeConfiguratie() {
    return {
        staander: cfg.uitProfiel(profielen.staander),
        handregel: cfg.uitProfiel(profielen.handregel),
        spijl: cfg.uitProfiel(profielen.spijl),
        // De trapboom hoort er net zo goed bij: ook dat is een profiel dat bij
        // een werkplaats vastligt. Hij ontbrak, dus wie een UPN 220 koos en
        // zijn configuratie bewaarde, kreeg hem later niet terug.
        boom: cfg.uitProfiel(profielen.boom),
        tredeMateriaal: tredeMateriaalEl.value,
        afwerking: afwerkingEl.value || null,
        // Het sierpunt hoort er net zo goed bij: ook dat is een keuze die bij
        // een werkplaats vastligt. Alleen het MODEL-ID gaat mee - de vorm zelf
        // komt uit sierpunten.js, dus een bewaarde configuratie blijft werken
        // als een model wordt bijgewerkt.
        sierpunt: sierpuntKeuze,
        // En de punt op de spijlen, om precies dezelfde reden.
        spijlSierpunt: spijlPuntKeuze,
    };
}

/** De keuzelijst opnieuw vullen, en de wisknop aan of uit zetten. */
function werkConfiguratiesBij() {
    const huidige = cfgKeuze.value;
    const lijst = cfg.namen();
    cfgKeuze.innerHTML = '<option value="">— kies een configuratie —</option>'
        + lijst.map(n => `<option>${n}</option>`).join('');
    cfgKeuze.value = lijst.includes(huidige) ? huidige : '';
    document.getElementById('cfg_wis').disabled = !cfgKeuze.value;
}

/** Een bewaarde configuratie toepassen. */
async function pasConfiguratieToe(naam) {
    const c = cfg.haal(naam);
    if (!c) return;

    // De url van een profiel wordt opnieuw gemaakt met het exportmoment van de
    // catalogus die er NU ligt. Een configuratie van vorige maand wijst zo
    // vanzelf naar de nieuwe levering, in plaats van naar een versie die er
    // niet meer is.
    const { basis, versie } = await catalogusKlaar();
    for (const onderdeel of ['staander', 'handregel', 'spijl', 'boom']) {
        profielen[onderdeel] = cfg.naarProfiel(c[onderdeel], basis, versie);
        toonProfiel(onderdeel);
    }
    if (c.tredeMateriaal) tredeMateriaalEl.value = c.tredeMateriaal;
    afwerkingEl.value = c.afwerking || '';
    // Een model dat niet meer bestaat valt terug op geen sierpunt, in plaats
    // van de bouw te laten vastlopen op een onbekend id.
    sierpuntKeuze = c.sierpunt && modelVan(c.sierpunt) ? c.sierpunt : SIERPUNT_GEEN;
    toonSierpunt();
    spijlPuntKeuze = c.spijlSierpunt && modelVan(c.spijlSierpunt)
        ? c.spijlSierpunt : SIERPUNT_GEEN;
    toonSpijlPunt();

    werkAfgeleideBij();
    werkTrapBij();
    statusEl.textContent = `Configuratie "${naam}" toegepast.`;
}

cfgKeuze.addEventListener('change', async () => {
    document.getElementById('cfg_wis').disabled = !cfgKeuze.value;
    if (!cfgKeuze.value) return;
    try {
        await pasConfiguratieToe(cfgKeuze.value);
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Configuratie toepassen mislukt: ' + err.message;
    }
});

document.getElementById('cfg_bewaar').addEventListener('click', () => {
    const naam = cfgNaam.value.trim();
    if (!naam) {
        statusEl.textContent = 'Geef de configuratie eerst een naam.';
        cfgNaam.focus();
        return;
    }
    const bestond = cfg.namen().includes(naam);
    if (!cfg.bewaar(naam, huidigeConfiguratie())) {
        // Privévenster, cookies uit, of een volle opslag. Niet stilzwijgend
        // laten mislukken: je denkt dat je iets bewaard hebt.
        statusEl.textContent =
            'Deze browser bewaart niets. Gebruik Opslaan bij Instellingen; '
            + 'daar zitten dezelfde keuzes in.';
        return;
    }
    cfgNaam.value = '';
    werkConfiguratiesBij();
    cfgKeuze.value = naam;
    document.getElementById('cfg_wis').disabled = false;
    statusEl.textContent = bestond
        ? `Configuratie "${naam}" bijgewerkt.`
        : `Configuratie "${naam}" bewaard.`;
});

document.getElementById('cfg_wis').addEventListener('click', () => {
    const naam = cfgKeuze.value;
    if (!naam) return;
    cfg.verwijder(naam);
    werkConfiguratiesBij();
    statusEl.textContent = `Configuratie "${naam}" verwijderd.`;
});

werkConfiguratiesBij();

// 'boom' staat erbij: de trapboom kan ook een profiel zijn, bijvoorbeeld een
// UPN 220. De knoppen zitten bij het kopje Trap en niet bij Profielen, want hij
// hoort bij de trap.
for (const onderdeel of ['staander', 'handregel', 'spijl', 'boom']) {
    toonProfiel(onderdeel);

    document.getElementById('kies_' + onderdeel).addEventListener('click', async () => {
        const knop = document.getElementById('kies_' + onderdeel);
        knop.disabled = true;
        try {
            // Wat je voor DIT onderdeel het vaakst koos gaat mee het venster
            // in. Apart per onderdeel, want een spijlprofiel is zelden een
            // goede staander. De kiezer rekent zelf niets uit; hij krijgt een
            // lijstje en toont het.
            const gekozen = await kiesProfiel(await catalogusKlaar(), {
                vaak: gewoonten.top(gewoonten.lees().profiel[onderdeel], 5),
            });
            if (!gekozen) return;          // annuleren laat de vorige keuze staan
            profielen[onderdeel] = gekozen;
            toonProfiel(onderdeel);
            werkAfgeleideBij();            // het voorbeeld meteen bijwerken
            if (onderdeel === 'boom') trapGewijzigd();
            else werkTrapBij();            // de trapboom raakt de trapmaten
            werkConfiguratiesBij();
            statusEl.textContent = `${onderdeel}: ${gekozen.englishLabel} — druk op `
                + (onderdeel === 'boom' ? 'Genereer trap.' : 'Genereer balustrade.');
        } catch (err) {
            console.error(err);
            // De foutmelding van laadCatalogus noemt het ingestelde pad; dat is
            // het enige wat je nodig hebt om dit op te lossen.
            statusEl.textContent = 'Profielcatalogus: ' + err.message;
        } finally {
            knop.disabled = false;
        }
    });

    document.getElementById('wis_' + onderdeel).addEventListener('click', () => {
        profielen[onderdeel] = null;
        toonProfiel(onderdeel);
        werkConfiguratiesBij();
        werkAfgeleideBij();
        if (onderdeel === 'boom') trapGewijzigd();
        else werkTrapBij();
    });
}

// --- hulp vragen -----------------------------------------------------------
//
// De knop verzamelt alleen; versturen doet de gebruiker. Zie hulp.js voor
// waarom er geen mail uit de app zelf gaat.
{
    const dialoog = document.getElementById('hulpDialoog');
    const waaromEl = document.getElementById('hulp_waarom');
    const adresEl = document.getElementById('hulp_adres');
    const rapportEl = document.getElementById('hulp_rapport');
    const meldingEl = document.getElementById('hulp_melding');

    /** Het rapport opnieuw opbouwen uit wat er NU in de app staat. */
    const verversRapport = () => {
        let maten = {};
        try { maten = huidigeMaten(); } catch { /* het paneel klopt niet */ }
        const fout = document.getElementById('paneelFout');
        rapportEl.value = hulp.maakRapport({
            waarom: waaromEl.value.trim(),
            maten,
            profielen,
            keuzes: {
                sierpunt: sierpuntKeuze,
                spijlSierpunt: spijlPuntKeuze,
                afwerking: afwerkingEl.value || null,
            },
            status: statusEl.textContent,
            melding: fout && fout.style.display !== 'none'
                ? fout.textContent.trim() : '',
            fouten: hulpFouten,
        });
    };

    document.getElementById('hulpKnop').addEventListener('click', () => {
        adresEl.value = hulp.leesAdres();
        meldingEl.textContent = '';
        verversRapport();
        dialoog.showModal();
        waaromEl.focus();
    });

    // Typen in "wat ging er mis" hoort meteen in het rapport te staan: anders
    // kopieer je een rapport zonder de zin die je net hebt getypt.
    waaromEl.addEventListener('input', verversRapport);
    adresEl.addEventListener('change', () => hulp.schrijfAdres(adresEl.value.trim()));

    document.getElementById('hulp_kopieer').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(rapportEl.value);
            meldingEl.textContent = 'Gekopieerd. Plak het in een mail, '
                + 'WhatsApp of waar je het kwijt wilt.';
        } catch {
            // Het klembord mag geweigerd worden; dan is selecteren de weg.
            rapportEl.select();
            meldingEl.textContent = 'Kopiëren mag niet in deze browser. De '
                + 'tekst staat geselecteerd — gebruik Ctrl+C.';
        }
    });

    document.getElementById('hulp_bestand').addEventListener('click', () => {
        const stempel = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
        downloadBestand(rapportEl.value, `hulpvraag-${stempel}.txt`);
        meldingEl.textContent = 'Bewaard. Stuur het bestand mee als bijlage.';
    });

    document.getElementById('hulp_mail').addEventListener('click', () => {
        const adres = adresEl.value.trim();
        hulp.schrijfAdres(adres);
        const { url, afgekapt } = hulp.maakMailto(
            adres, waaromEl.value.trim(), rapportEl.value);
        window.location.href = url;
        // EERLIJK ZIJN OVER AFKAPPEN. Mailprogramma's knippen een lang adres
        // af, en dan mist precies de melding waar het om ging. Dan hoort er te
        // staan dat je het rapport erbij moet plakken.
        meldingEl.textContent = afgekapt
            ? 'Je mailprogramma opent. Het rapport is te lang voor een '
              + 'mail-adres, dus kopieer het hierboven en plak het erbij.'
            : 'Je mailprogramma opent met alles ingevuld. Jij drukt op '
              + 'versturen.';
    });
}

function downloadBestand(inhoud, naam) {
    const blob = new Blob([inhoud], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = naam;
    link.click();
    // De browser heeft het adres nog even nodig om het bestand op te halen.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

resize();
window.addEventListener('resize', resize);

const navigatie = maakNavigatie({ renderer, camera, controls, viewportEl });

renderer.setAnimationLoop(() => {
    controls.update();
    navigatie.update();
    headLight.position.copy(camera.position); // licht volgt de camera
    renderer.render(scene, camera);
    navigatie.teken(); // assenkruis en navigatiekubus over het beeld heen
});

function resize() {
    const w = viewportEl.clientWidth;
    const h = viewportEl.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
}

// --- STEP inlezen ----------------------------------------------------------

document.getElementById('file').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
        await laadStepBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Fout: ' + err.message;
    }
});

/**
 * Een STEP-bestand van buiten naar beeld.
 *
 * Alleen voor ingelezen bestanden. Wat we zelf bouwen gaat via toonVorm: dat
 * heeft de vorm al in handen en hoeft niet eerst door een tekstbestand heen.
 */
async function laadStepBytes(bytes, naam) {
    statusEl.textContent = 'Bezig met laden...';
    // Een ingeladen bestand heeft geen stuklijst; die hoort bij iets dat wij
    // zelf hebben samengesteld. De bouwers zetten hem hierna weer neer.
    toonStuklijst(null);
    toonOnderdelen(null);

    await initOcct();
    // Geen onderdelenlijst bij een ingeladen bestand: we weten niet wat de
    // delen zijn, alleen de vorm. De maatvoering valt dan terug op de
    // buitenmaten, en dat is precies wat er over zo'n model te zeggen valt.
    laatsteDelen = null;
    toonGeladen(await laadStep(bytes), naam);
}

/**
 * Een zelfgebouwde vorm naar beeld, zonder STEP-omweg.
 *
 * De bouwers gaven eerst STEP-bytes terug, die we hier meteen weer ontleedden.
 * Dat ontleden kostte bij een trap van 81 delen 1,8 s - meer dan het bouwen en
 * tekenen samen. De vorm is er al; er is geen reden hem eerst op te schrijven.
 * Bij exporteren wordt er nog steeds een echt STEP-bestand geschreven, uit
 * dezelfde vorm.
 */
async function toonVorm(shape, naam, materialen = null, delen = null) {
    statusEl.textContent = 'Bezig met laden...';
    toonStuklijst(null);
    toonOnderdelen(null);

    await initOcct();
    laatsteDelen = delen;
    toonGeladen(await laadVorm(shape), naam, materialen);
}

/**
 * Het voorbeeld naar beeld: de onderdelenlijst als doosjes, zonder OCCT.
 *
 * Zie preview.js. Dit is GEEN gebouwd model: er zijn geen sneden, geen vlakken
 * om aan te klikken en geen randen. Daarom gaan ook de stuklijst en de
 * onderdelen van een eerdere bouw weg - anders levert het productiepakket het
 * vorige model terwijl er een ander in beeld staat.
 *
 * De camera springt bij het EERSTE voorbeeld, en daarna alleen als het model
 * meer dan een kwart groter of kleiner wordt (een leuning erbij, een meter
 * hoger). Bij gewoon doortypen blijft het beeld staan waar je het neergezet
 * hebt.
 */
let voorbeeldMaat = 0;
function toonVoorbeeld(delen, naam) {
    clearSelection();
    clearEdgeSelection();
    toonStuklijst(null);
    toonOnderdelen(null);

    const wasVoorbeeld = Boolean(modelRoot.userData.voorbeeld);
    ruimVoorbeeldOp(modelRoot);
    scene.remove(modelRoot);
    modelRoot = maakVoorbeeld(delen);
    scene.add(modelRoot);

    // Randen horen bij een gebouwd model; die van de vorige bouw kloppen niet
    // meer bij wat er nu staat.
    scene.remove(edgeRoot);
    edgeRoot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    edgeRoot = new THREE.Group();
    edgeRoot.visible = document.getElementById('showEdges').checked;
    scene.add(edgeRoot);

    const grootte = new THREE.Box3().setFromObject(modelRoot)
        .getSize(new THREE.Vector3());
    let modelSize = Math.max(grootte.x, grootte.y, grootte.z);
    if (!wasVoorbeeld || Math.abs(modelSize - voorbeeldMaat) > 0.25 * voorbeeldMaat) {
        modelSize = fitCameraToObject(modelRoot);
        voorbeeldMaat = modelSize;
    }

    laatsteDelen = delen;
    bouwMaatvoering(modelSize);

    statusEl.textContent = `Voorbeeld van de ${naam} — zonder sneden, nog niet `
        + `gebouwd. Druk op Genereer ${naam} voor het echte model.`;
}

// --- maatvoering -----------------------------------------------------------
//
// De maten worden opnieuw gebouwd zodra er een model in beeld komt, uit
// dezelfde onderdelenlijst waar de geometrie uit komt. Daarmee zijn ze vanzelf
// bijgewerkt: er is geen tweede plek die ze onthoudt en kan achterlopen.
let laatsteDelen = null;
let matenGroep = null;
const maatSchakelaar = document.getElementById('showMaten');

function bouwMaatvoering(modelSize) {
    if (matenGroep) {
        scene.remove(matenGroep);
        matenGroep = null;
    }
    if (!modelRoot) return;

    const doos = new THREE.Box3().setFromObject(modelRoot);
    matenGroep = maakMaatvoering(laatsteDelen, doos, modelSize || 1000);
    matenGroep.visible = maatSchakelaar.checked;
    scene.add(matenGroep);
}

// Alleen de zichtbaarheid omzetten; het beeld wordt doorlopend opnieuw
// getekend door setAnimationLoop, dus er hoeft hier niets getekend te worden.
maatSchakelaar.addEventListener('change', () => {
    if (matenGroep) matenGroep.visible = maatSchakelaar.checked;
});

/** Zet een ingelezen of gebouwd model in beeld. */
function toonGeladen({ meshes, edges, counts }, naam, materialen = null) {
    const modelSize = showResult({ meshes }, naam, materialen);
    showEdges(edges, counts, modelSize, meshes, naam);
    // Na het model, want de maatvoering heeft de omhullende doos nodig.
    bouwMaatvoering(modelSize);
}

function showResult(result, fileName, materialen = null) {
    clearSelection();
    ruimVoorbeeldOp(modelRoot);
    scene.remove(modelRoot);
    modelRoot = new THREE.Group();

    let faceCount = 0;
    for (const resultMesh of result.meshes) {
        const mesh = buildMesh(resultMesh, materialen);
        faceCount += mesh.userData.brepFaces.length;
        modelRoot.add(mesh);
    }
    scene.add(modelRoot);

    const size = fitCameraToObject(modelRoot);
    statusEl.textContent =
        `${fileName} — ${faceCount} vlakken.`;
    return size;
}

// --- b-rep edges ophalen en tekenen ----------------------------------------
function showEdges(edges, counts, modelSize, meshes, fileName) {
    clearEdgeSelection();
    scene.remove(edgeRoot);
    // Een echt HiCAD-onderdeel levert al gauw honderden lijnen op; die horen bij een
    // volgend bestand niet op de GPU te blijven staan.
    edgeRoot.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    edgeRoot = new THREE.Group();
    edgeRoot.visible = document.getElementById('showEdges').checked;
    scene.add(edgeRoot);

    edgeRadius = Math.max(modelSize / 350, 1e-4);
    for (const edge of edges) edgeRoot.add(buildEdgeLine(edge));

    // Controle dat dit topologie is en geen tessellatie: het aantal unieke randen
    // van de driehoeken hoort duidelijk af te wijken van het aantal b-rep edges.
    const meshEdgeCount = countMeshEdges(meshes);
    console.log('B-rep topologie (opencascade.js):', counts);
    console.log('Controle — b-rep edges:', counts.EDGE,
        '| unieke randen in de driehoeken:', meshEdgeCount,
        '|', counts.EDGE === meshEdgeCount
            ? 'LET OP: gelijk, verdacht' : 'verschillend, dus geen mesh-data');
    console.log('Edges:', edges);

    statusEl.textContent =
        // DE TELLING BLIJFT, DE VAKTAAL NIET. Hoeveel vlakken en randen een
        // model heeft is voor de gebruiker zinnig - het zegt of het goede
        // bestand openstaat. "b-rep edges" en "mesh" zeggen hem niets; die
        // vergelijking staat hierboven in de console, waar ze thuishoort.
        `${fileName} — ${counts.FACE} vlakken, ${counts.EDGE} randen, `
        + `${counts.VERTEX} hoekpunten. Klik op een rand.`;
}

/** De curvenaam uit de rekenkern in gewone taal. Onbekend = gebogen. */
function soortRand(curveType) {
    return { Line: 'recht', Circle: 'rond', Ellipse: 'ovaal' }[curveType]
        || 'gebogen';
}

function buildEdgeLine(edge) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(edge.points, 3));
    const line = new THREE.Line(geometry, edgeMaterial);
    line.userData.edge = edge; // bewaart edgeId, punten, curveType en lengte
    return line;
}

// --- van occt-resultaat naar een three.js Mesh -----------------------------
// De groepsindeling komt uit het officiele voorbeeld van occt-import-js
// (examples/three_viewer.html) en is gebleven toen die bibliotheek eruit ging:
// driehoeken die buiten een brep_face vallen krijgen een eigen groep, zodat de
// nummering blijft kloppen. tessellate.js levert de brep_faces nu zelf aan.
function buildMesh(resultMesh, materialen = null) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position',
        new THREE.Float32BufferAttribute(resultMesh.attributes.position.array, 3));
    if (resultMesh.attributes.normal) {
        geometry.setAttribute('normal',
            new THREE.Float32BufferAttribute(resultMesh.attributes.normal.array, 3));
    }
    geometry.setIndex(new THREE.BufferAttribute(
        Uint32Array.from(resultMesh.index.array), 1));
    if (!resultMesh.attributes.normal) {
        geometry.computeVertexNormals();
    }

    const brepFaces = resultMesh.brep_faces || [];
    const groupOfFace = new Map(); // brep-face-index -> index in geometry.groups

    // Per materiaal dat in dit model voorkomt één three.js-materiaal, en een
    // kaart van materiaalsleutel naar zijn index. Komt er geen hout in voor,
    // dan blijft deze leeg en ziet het model er precies zo uit als altijd.
    const materials = [];
    materials[MAT_GAP] = new THREE.MeshStandardMaterial({ color: 0x9aa3ab, roughness: 0.85, metalness: 0.0 });
    materials[MAT_FACE] = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.85, metalness: 0.0 });
    materials[MAT_SELECTED] = new THREE.MeshStandardMaterial({ color: 0xff8a2b, roughness: 0.6, metalness: 0.0 });

    const indexVanMateriaal = new Map();
    const materiaalIndexVoor = (uit) => {
        // Blank staal houdt het bestaande materiaal, zodat een stalen model
        // geen enkel extra three.js-materiaal krijgt en er niets aan verandert.
        if (!uit || uit.sleutel === 'staal') return MAT_FACE;
        if (indexVanMateriaal.has(uit.sleutel)) return indexVanMateriaal.get(uit.sleutel);

        const i = materials.length < MAT_EERSTE_VRIJ ? MAT_EERSTE_VRIJ : materials.length;
        materials[i] = new THREE.MeshStandardMaterial({
            color: uit.kleur, roughness: uit.ruwheid, metalness: 0.0,
            // Doorzichtig materiaal, alleen waar het materiaal daarom vraagt.
            // `side: DoubleSide` hoort erbij: van een doorzichtige plaat zie je
            // ook de achterkant, en zonder dit valt de helft van de ruit weg.
            // `depthWrite: false` laat wat erachter staat erdoorheen zien in
            // plaats van weggesneden te worden.
            ...(uit.doorzichtig !== undefined ? {
                transparent: true,
                opacity: uit.doorzichtig,
                side: THREE.DoubleSide,
                depthWrite: false,
            } : {}),
        });
        indexVanMateriaal.set(uit.sleutel, i);
        return i;
    };

    const triangleCount = resultMesh.index.array.length / 3;
    let triangle = 0;
    let faceIdx = 0;
    while (triangle < triangleCount) {
        const first = triangle;
        let last, materialIndex, ownerFace = -1;

        if (faceIdx >= brepFaces.length) {
            last = triangleCount;              // rest zonder b-rep face
            materialIndex = MAT_GAP;
        } else if (triangle < brepFaces[faceIdx].first) {
            last = brepFaces[faceIdx].first;   // gat voor de volgende face
            materialIndex = MAT_GAP;
        } else {
            last = brepFaces[faceIdx].last + 1;
            // Welk onderdeel is dit, en hoe ziet dat eruit? tessellate.js zet
            // het solidnummer op elk vlak; de bouwer levert het uiterlijk per
            // solid in dezelfde volgorde. Gepoedercoat staal krijgt de kleur
            // van de coating, want die zit eroverheen.
            const solid = brepFaces[faceIdx].solid;
            materialIndex = materiaalIndexVoor(
                materialen && solid >= 0 ? materialen[solid] : null);
            ownerFace = faceIdx;
            faceIdx++;
        }

        if (ownerFace >= 0) {
            groupOfFace.set(ownerFace, geometry.groups.length);
        }
        geometry.addGroup(first * 3, (last - first) * 3, materialIndex);
        triangle = last;
    }

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = resultMesh.name || '(naamloos)';
    mesh.userData.brepFaces = brepFaces;
    mesh.userData.groupOfFace = groupOfFace;
    // Onthouden welk materiaal een groep had, zodat deselecteren hem zijn eigen
    // kleur teruggeeft en niet het grijs van staal. Zonder dit wordt een houten
    // trede grijs zodra je hem een keer hebt aangeklikt.
    mesh.userData.eigenMateriaal = geometry.groups.map(g => g.materialIndex);
    return mesh;
}

// --- camera passend zetten -------------------------------------------------
// Geeft de grootste afmeting van het model terug (wereld-eenheden, mm bij HiCAD).
function fitCameraToObject(object) {
    // Een lopende camerabeweging van de navigatiekubus zou onze nieuwe
    // camerastand meteen weer overschrijven.
    navigatie.stopAnimatie();
    // Van rechtsvoor en iets van boven. Met Z omhoog is -Y de voorkant.
    return richtCameraOp(object, new THREE.Vector3(1, -1, 0.8).normalize());
}

/**
 * Zet de camera zo dat `object` precies in beeld past, kijkend langs
 * `direction`.
 *
 * Losgetrokken uit fitCameraToObject zodat het productieblad er vier kanten mee
 * kan renderen. Het gedrag van fitCameraToObject verandert er niet door: die
 * geeft nu dezelfde richting door als hij hier hard had staan.
 */
function richtCameraOp(object, direction) {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return 1;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Passend maken op de acht HOEKPUNTEN van de bounding box, niet op de
    // omhullende bol. Bij een bol reken je met de langste afmeting in alle
    // richtingen; een balustrade van 2 meter lang en 20 mm dik komt dan
    // piepklein in beeld te staan, met overal eromheen lucht.
    //
    // Per hoekpunt rekenen we uit hoe ver de camera minimaal moet staan om dat
    // punt nog binnen het beeld te houden, en we nemen de grootste daarvan.
    const halveFovY = THREE.MathUtils.degToRad(camera.fov / 2);
    const halveFovX = Math.atan(Math.tan(halveFovY) * camera.aspect);

    const rechts = new THREE.Vector3().crossVectors(direction, camera.up).normalize();
    const omhoog = new THREE.Vector3().crossVectors(rechts, direction).normalize();

    let fitDistance = 0;
    const hoek = new THREE.Vector3();
    for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
            for (const z of [box.min.z, box.max.z]) {
                hoek.set(x, y, z).sub(center);
                const diepte = hoek.dot(direction);          // richting de camera
                const zijwaarts = Math.abs(hoek.dot(rechts));
                const verticaal = Math.abs(hoek.dot(omhoog));
                fitDistance = Math.max(fitDistance,
                    diepte + zijwaarts / Math.tan(halveFovX),
                    diepte + verticaal / Math.tan(halveFovY));
            }
        }
    }

    camera.position.copy(center).addScaledVector(direction, fitDistance * 1.08);
    camera.near = maxDim / 1000;
    camera.far = maxDim * 100;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.update();
    return maxDim;
}

// --- selectie --------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let selection = null;   // { mesh, faceIndex, groupIndex }
let pointerDown = null; // om slepen (draaien) van klikken te onderscheiden

// Hoeveel pixels naast een rand mag je klikken en hem toch raken.
const PIXELMARGE = 8;

const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x2b3a46 });
// Meerdere randen tegelijk: gewone klik vervangt de selectie, shift+klik voegt
// toe of haalt weg. Zo kun je een balustrade rond meerdere randen laten lopen.
let edgeSelectie = []; // [{ line, highlight }]
let edgeRadius = 1;       // dikte van de markering, schaalt mee met het model

renderer.domElement.addEventListener('pointerdown', (e) => {
    pointerDown = { x: e.clientX, y: e.clientY };
});

renderer.domElement.addEventListener('pointerup', (e) => {
    if (!pointerDown) return;
    const moved = Math.hypot(e.clientX - pointerDown.x, e.clientY - pointerDown.y);
    pointerDown = null;
    if (moved > 4) return; // was een draaibeweging, geen klik

    // Een klik op de navigatiekubus verandert het aanzicht en mag niet ook
    // nog eens iets in het model selecteren.
    if (navigatie.verwerkKlik(e)) return;

    pick(e);
});

function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    // Hoe dicht moet je bij een lijn klikken? Three.js rekent die marge in
    // wereld-eenheden, maar wat een mens verwacht is een aantal PIXELS: een
    // rand is altijd even dik op het scherm, hoe ver je ook uitgezoomd bent.
    // Daarom rekenen we de pixelmarge elke klik om naar millimeters, op de
    // afstand waar het model staat.
    const afstand = camera.position.distanceTo(controls.target);
    const mmPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
        * afstand / renderer.domElement.clientHeight;
    raycaster.params.Line.threshold = PIXELMARGE * mmPerPixel;

    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(modelRoot, true);
    const edgeHits = edgeRoot.visible
        ? raycaster.intersectObjects(edgeRoot.children, false)
        : [];

    // Een rand wint van het vlak eronder, maar niet van een vlak dat ervoor ligt:
    // lijnen doen niet aan diepte, dus zonder deze marge zou je door het volume
    // heen een rand aan de achterkant kunnen aanklikken.
    const margin = raycaster.params.Line.threshold * 2;
    if (edgeHits.length > 0 &&
        (hits.length === 0 || edgeHits[0].distance <= hits[0].distance + margin)) {
        selectEdge(edgeHits[0].object, event.shiftKey);
        return;
    }

    if (hits.length === 0) {
        clearSelection();
        clearEdgeSelection();
        statusEl.textContent = 'Niets geraakt.';
        return;
    }

    clearEdgeSelection();
    const hit = hits[0];
    if (modelRoot.userData.voorbeeld) {
        clearSelection();
        statusEl.textContent = 'Dit is een voorbeeld; de vlakken komen pas na '
            + 'Genereer.';
        return;
    }
    // faceIndex is het nummer van de geraakte DRIEHOEK; brep_faces.first/last
    // zijn in dezelfde eenheid, dus daarmee vinden we de b-rep face terug.
    const faceIndex = findBrepFace(hit.object.userData.brepFaces, hit.faceIndex);
    if (faceIndex < 0) {
        clearSelection();
        statusEl.textContent =
            'Daar zit geen vlak. Klik iets verder op het model.';
        return;
    }

    select(hit.object, faceIndex);

    const brepFace = hit.object.userData.brepFaces[faceIndex];
    console.log('Geselecteerde b-rep face:', {
        mesh: hit.object.name,
        brepFaceIndex: faceIndex,
        eersteDriehoek: brepFace.first,
        laatsteDriehoek: brepFace.last,
        aantalDriehoeken: brepFace.last - brepFace.first + 1,
        geraakteDriehoek: hit.faceIndex,
        kleurUitStep: brepFace.color,
        klikpunt: hit.point.toArray().map(v => +v.toFixed(3)),
        normaalLokaal: hit.face ? hit.face.normal.toArray().map(v => +v.toFixed(3)) : null
    });

    // Voor de gebruiker telt het vanaf 1; de nummering in de console blijft
    // bij 0 beginnen, want die hoort bij de gegevens eronder.
    statusEl.textContent =
        `Vlak ${faceIndex + 1} van ${hit.object.userData.brepFaces.length} `
        + 'geselecteerd.';
}

function findBrepFace(brepFaces, triangleIndex) {
    if (!brepFaces) return -1;
    for (let i = 0; i < brepFaces.length; i++) {
        if (triangleIndex >= brepFaces[i].first && triangleIndex <= brepFaces[i].last) {
            return i;
        }
    }
    return -1;
}

// Selecteren = de materiaalindex van die ene groep omzetten naar MAT_SELECTED.
function select(mesh, faceIndex) {
    clearSelection();
    const groupIndex = mesh.userData.groupOfFace.get(faceIndex);
    if (groupIndex === undefined) return;
    mesh.geometry.groups[groupIndex].materialIndex = MAT_SELECTED;
    selection = { mesh, faceIndex, groupIndex };
}

function clearSelection() {
    if (!selection) return;
    // Terug naar het EIGEN materiaal van die groep, niet naar MAT_FACE. Een
    // houten trede die je een keer hebt aangeklikt hoort niet grijs te worden.
    const eigen = selection.mesh.userData.eigenMateriaal;
    selection.mesh.geometry.groups[selection.groupIndex].materialIndex =
        (eigen && eigen[selection.groupIndex] !== undefined)
            ? eigen[selection.groupIndex] : MAT_FACE;
    selection = null;
}

// --- edge-selectie ---------------------------------------------------------
// Elke edge is een eigen THREE.Line met zijn edgeId in userData, dus de raycaster
// wijst rechtstreeks een edge aan; er komt geen driehoek of mesh-index aan te pas.
function selectEdge(line, bijvoegen = false) {
    clearSelection();
    if (!bijvoegen) clearEdgeSelection();

    const edge = line.userData.edge;

    // Shift+klik op een al gekozen rand haalt hem er weer af. Anders kun je een
    // misklik alleen herstellen door opnieuw te beginnen.
    const bestaand = edgeSelectie.findIndex(s => s.line === line);
    if (bestaand >= 0) {
        verwijderMarkering(edgeSelectie[bestaand]);
        edgeSelectie.splice(bestaand, 1);
        werkEdgeStatusBij();
        return;
    }

    const highlight = buildHighlight(edge.points, edgeRadius);
    edgeRoot.add(highlight);
    edgeSelectie.push({ line, highlight });
    werkEdgeStatusBij();

    const p = edge.points;
    console.log('Geselecteerde b-rep edge:', {
        edgeId: edge.edgeId,
        curveType: edge.curveType,
        lengte: +edge.length.toFixed(3),
        aantalPunten: p.length / 3,
        start: [p[0], p[1], p[2]].map(v => +v.toFixed(3)),
        eind: [p[p.length - 3], p[p.length - 2], p[p.length - 1]].map(v => +v.toFixed(3)),
        // deze punten zijn de basis voor een toekomstig railing path
        polyline: edge.points
    });

    // De SOORT rand is nuttig om te weten - recht of gebogen bepaalt wat je
    // ermee kunt - maar "Line", "Circle" en "BSplineCurve" zijn de namen uit
    // de rekenkern. Die vertalen we; het aantal punten en de curvenaam blijven
    // in de console staan, voor wie dat zoekt.
    statusEl.textContent = `Rand ${edge.edgeId} — ${soortRand(edge.curveType)}`
        + `, ${edge.length.toFixed(1)} mm.`;
}

function verwijderMarkering(keuze) {
    edgeRoot.remove(keuze.highlight);
    for (const child of keuze.highlight.children) child.geometry.dispose();
}

function clearEdgeSelection() {
    for (const keuze of edgeSelectie) verwijderMarkering(keuze);
    edgeSelectie = [];
    werkEdgeStatusBij();
}

/** De gekozen randen, in de volgorde waarin ze aangeklikt zijn. */
function gekozenRanden() {
    return edgeSelectie.map(s => s.line.userData.edge);
}

function werkEdgeStatusBij() {
    const randen = gekozenRanden();
    if (randen.length === 0) {
        edgeStatusEl.textContent = 'Geen rand geselecteerd';
        edgeStatusEl.classList.remove('on');
    } else if (randen.length === 1) {
        edgeStatusEl.textContent = `Rand ${randen[0].edgeId} geselecteerd`;
        edgeStatusEl.classList.add('on');
    } else {
        edgeStatusEl.textContent =
            `${randen.length} randen: ${randen.map(e => e.edgeId).join(', ')}`;
        edgeStatusEl.classList.add('on');
    }
    werkRandKnopBij();
}

// GL-lijnen kunnen op de meeste platforms niet dikker dan 1 pixel, dus de markering
// is echte geometrie: een cilindertje per polyline-segment, altijd bovenop getekend.
const HIGHLIGHT_MATERIAL = new THREE.MeshBasicMaterial({
    color: 0xff8a2b, depthTest: false, toneMapped: false
});

function buildHighlight(points, radius) {
    const group = new THREE.Group();
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);

    for (let i = 0; i + 5 < points.length; i += 3) {
        a.set(points[i], points[i + 1], points[i + 2]);
        b.set(points[i + 3], points[i + 4], points[i + 5]);
        const length = a.distanceTo(b);
        if (length < 1e-9) continue;

        const cylinder = new THREE.Mesh(
            new THREE.CylinderGeometry(radius, radius, length, 8), HIGHLIGHT_MATERIAL);
        cylinder.position.addVectors(a, b).multiplyScalar(0.5);
        cylinder.quaternion.setFromUnitVectors(
            up, dir.subVectors(b, a).divideScalar(length));
        cylinder.renderOrder = 999;
        group.add(cylinder);
    }
    return group;
}
