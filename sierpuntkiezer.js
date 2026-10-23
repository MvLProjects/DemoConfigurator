// Het keuzevenster voor sierpunten en paalkoppen.
//
// DEZELFDE OPZET ALS DE PROFIELKIEZER, en met opzet: een lijst links,
// gegroepeerd per soort, en rechts een 3D-voorbeeld van wat je aanwijst. Wie
// de profielkiezer kent hoeft hier niets nieuws te leren.
//
// ÉÉN VOORBEELDVENSTER EN NIET VIJFTIEN. Een plaatje bij elk model in de lijst
// zou mooier zijn, maar elk venster is een eigen WebGL-context en een browser
// geeft er maar een stuk of zestien. Met vijftien ornamenten zit je daar
// meteen aan, en dan valt de hoofdviewer eruit. Het voorbeeld volgt daarom de
// aanwijzing: je loopt met de pijltjes door de lijst en ziet elk model
// draaien. Het is ECHTE geometrie - hetzelfde model dat straks in de leuning
// komt - en geen plaatje.

import { MODELLEN, perGroep, modelVan, pastOp, hoogteVoor, GEEN } from './sierpunten.js';
import { maakVoorbeeldVenster } from './profiel-voorbeeld.js';
import { initOcct } from './brep-edges.js';
import { tessellateer } from './tessellate.js';

let venster = null;
let bezig = 0;

/**
 * Opent het venster en geeft het gekozen model-id terug, of null bij annuleren.
 *
 * @param huidig  het model dat nu gekozen is
 * @param rond    staat er een ronde staander? Bepaalt wat er past.
 */
export function kiesSierpunt(huidig, rond) {
    const dialoog = document.getElementById('sierDialoog');
    const lijst = document.getElementById('sp_lijst');
    const naamEl = document.getElementById('sp_naam');
    const uitlegEl = document.getElementById('sp_uitleg');
    const maatEl = document.getElementById('sp_maat');
    const okKnop = document.getElementById('sp_ok');
    const houder = document.getElementById('sp_voorbeeld');

    if (!venster) venster = maakVoorbeeldVenster(houder);

    let gekozen = huidig && huidig !== GEEN ? huidig : null;

    // --- de lijst opbouwen -------------------------------------------------
    lijst.innerHTML = '';
    const rijen = new Map();

    const voegRij = (model) => {
        const past = pastOp(model, rond);
        const li = document.createElement('li');
        li.className = 'sp_rij' + (past ? '' : ' sp_past-niet');
        li.setAttribute('role', 'option');
        li.dataset.id = model.id;

        const naam = document.createElement('b');
        naam.textContent = model.naam;
        li.appendChild(naam);

        const bij = document.createElement('span');
        bij.className = 'sp_bij';
        // WAAROM HIJ NIET PAST hoort erbij te staan. Een grijze regel zonder
        // uitleg laat iemand zoeken naar wat hij fout doet.
        bij.textContent = past
            ? (model.voet === 'beide' ? 'rond of vierkant'
                : model.voet === 'rond' ? 'ronde voet' : 'vierkante voet')
            : `past niet: ${model.voet}e voet op een `
              + `${rond ? 'ronde' : 'vierkante'} staander`;
        li.appendChild(bij);

        li.addEventListener('click', () => kies(model.id));
        lijst.appendChild(li);
        rijen.set(model.id, li);
    };

    for (const { groep, modellen } of perGroep()) {
        const kop = document.createElement('li');
        kop.className = 'sp_groep';
        kop.textContent = groep;
        lijst.appendChild(kop);
        for (const m of modellen) voegRij(m);
    }

    // --- aanwijzen en tonen ------------------------------------------------
    async function kies(id) {
        gekozen = id;
        for (const [k, li] of rijen) {
            li.setAttribute('aria-selected', k === id ? 'true' : 'false');
        }
        const model = modelVan(id);
        naamEl.textContent = model.naam;
        uitlegEl.textContent = model.omschrijving;
        okKnop.disabled = !pastOp(model, rond);

        const b = Number(document.getElementById('p_staanderBreedte').valueAsNumber) || 40;
        const h = hoogteVoor(model, b);
        maatEl.textContent = `op een staander van ${b} mm wordt hij ongeveer `
            + `${h} mm hoog`;

        // Het voorbeeld bouwen. Een eigen volgnummer, zodat een trage bouw een
        // nieuwere keuze niet overschrijft wanneer je snel door de lijst gaat.
        const mijn = ++bezig;
        venster.meld('bezig…');
        try {
            const oc = await initOcct();
            if (mijn !== bezig) return;
            const op = [];
            try {
                const { maakSierpunt } = await import('./sierpunten.js');
                const vorm = maakSierpunt(oc, id, { b, h, rond }, op);
                const mesh = tessellateer(oc, vorm, Math.max(h / 400, 0.05));
                if (mijn !== bezig) return;
                venster.toon({ meshes: mesh.meshes, lengte: h });
            } finally {
                for (let i = op.length - 1; i >= 0; i--) {
                    try { op[i].delete(); } catch { /* al weg */ }
                }
            }
        } catch (err) {
            console.error(err);
            venster.meld('Voorbeeld mislukt: ' + err.message);
        }
    }

    // Begin bij wat er al stond, anders bij het eerste model dat past.
    const begin = gekozen && modelVan(gekozen)
        ? gekozen
        : (MODELLEN.find(m => pastOp(m, rond)) || MODELLEN[0]).id;
    kies(begin);

    // --- afhandelen --------------------------------------------------------
    return new Promise((klaar) => {
        const sluit = (waarde) => {
            okKnop.removeEventListener('click', opOk);
            dialoog.removeEventListener('close', opDicht);
            dialoog.removeEventListener('keydown', opToets);
            if (dialoog.open) dialoog.close();
            klaar(waarde);
        };
        const opOk = () => sluit(gekozen);
        const opDicht = () => sluit(null);
        const opToets = (e) => {
            if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
            e.preventDefault();
            const ids = [...rijen.keys()];
            const i = ids.indexOf(gekozen);
            const volgende = (i + (e.key === 'ArrowDown' ? 1 : -1) + ids.length)
                % ids.length;
            kies(ids[volgende]);
            rijen.get(ids[volgende]).scrollIntoView({ block: 'nearest' });
        };
        okKnop.addEventListener('click', opOk);
        dialoog.addEventListener('close', opDicht);
        dialoog.addEventListener('keydown', opToets);
        dialoog.showModal();
    });
}
