// Het kleine 3D-venstertje in het detailpaneel van de profielkiezer.
//
// Bewust los van de hoofdviewer in main.js. Dat scheelt een hoop verstrengeling:
// deze scene heeft geen selectie, geen randen, geen navigatiekubus en geen
// export. Hij toont één staaf en draait rond.
//
// Wel dezelfde stijl als de hoofdviewer, want de opdracht vraagt daarom:
// achtergrond f2f4f6, Z omhoog, dezelfde verlichting en hetzelfde grijs.

import * as THREE from 'three';

const ACHTERGROND = 0xf2f4f6;
const STAALGRIJS = 0xc8ccd0;

/**
 * Maakt een voorbeeldvenster in het gegeven element.
 *
 * @returns {{toon, meld, leeg, stop, maat}}
 */
export function maakVoorbeeldVenster(houder) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(ACHTERGROND);

    // Z omhoog, net als in de hoofdviewer. STEP, HiCAD en Onshape doen dat
    // allemaal; three.js zet standaard Y omhoog en dan ligt alles op zijn kant.
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100000);
    camera.up.set(0, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    houder.append(renderer.domElement);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 2.0));
    const lamp = new THREE.DirectionalLight(0xffffff, 1.5);
    scene.add(lamp);

    const materiaal = new THREE.MeshStandardMaterial({
        color: STAALGRIJS, roughness: 0.85, metalness: 0.0,
    });

    let wortel = new THREE.Group();
    scene.add(wortel);
    let hoekpunten = [];       // de 8 hoeken van de omhullende doos
    let hoek = 0;
    let draait = false;
    let melding = null;

    // Hoe hoog de camera staat. 0,8 kijkt schuin van boven de staaf in, zodat je
    // de doorsnede ziet én dat het een staaf is. Van opzij zie je alleen een
    // rechthoek, en dan mis je juist de afgeronde hoeken.
    const HOOGTE = 0.8;

    function meet() {
        const b = houder.clientWidth || 260;
        const h = houder.clientHeight || 170;
        camera.aspect = b / h;
        camera.updateProjectionMatrix();
        renderer.setSize(b, h, false);
    }

    function ruimOp() {
        wortel.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
        scene.remove(wortel);
        wortel = new THREE.Group();
        scene.add(wortel);
    }

    /** Zet driehoeken in beeld en richt de camera erop. */
    function toon({ meshes, lengte }) {
        verwijderMelding();
        ruimOp();

        for (const mesh of meshes) {
            const g = new THREE.BufferGeometry();
            g.setAttribute('position',
                new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
            g.setIndex(mesh.index.array);
            g.computeVertexNormals();
            wortel.add(new THREE.Mesh(g, materiaal));
        }

        // De staaf staat van z=0 tot z=lengte; het midden ligt halverwege.
        const doos = new THREE.Box3().setFromObject(wortel);
        const midden = doos.getCenter(new THREE.Vector3());
        wortel.position.sub(midden);           // naar de oorsprong schuiven

        // De acht hoeken van de doos, om de camera op te passen. NIET op de
        // omhullende bol: een staaf van 40 bij 40 bij 200 heeft een bol met
        // straal 103, en daarop passen zet hem piepklein in beeld. Dat is
        // dezelfde fout die de hoofdviewer eerder maakte.
        const h = doos.getSize(new THREE.Vector3()).multiplyScalar(0.5);
        hoekpunten = [];
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
            hoekpunten.push(new THREE.Vector3(sx * h.x, sy * h.y, sz * h.z));
        }

        draait = true;
        meet();
    }

    /**
     * Hoe ver de camera eraf moet om alle acht hoeken in beeld te houden.
     *
     * Per hoekpunt: hoe ver zit hij opzij en omhoog ten opzichte van de
     * kijkrichting, en hoeveel afstand heb je nodig om dat binnen de
     * beeldhoek te krijgen. De grootste wint.
     */
    function benodigdeAfstand(richting) {
        const omhoog = new THREE.Vector3(0, 0, 1);
        const rechts = new THREE.Vector3().crossVectors(richting, omhoog).normalize();
        const boven = new THREE.Vector3().crossVectors(rechts, richting).normalize();

        const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
        const tanH = tanV * camera.aspect;

        let nodig = 0;
        for (const p of hoekpunten) {
            const diep = p.dot(richting);
            nodig = Math.max(nodig,
                diep + Math.abs(p.dot(rechts)) / tanH,
                diep + Math.abs(p.dot(boven)) / tanV);
        }
        return nodig * 1.08;   // een randje lucht eromheen
    }

    function verwijderMelding() {
        if (melding) { melding.remove(); melding = null; }
    }

    /** Een tekst in plaats van een model: bezig, of een fout. */
    function meld(tekst, soort = 'bezig') {
        ruimOp();
        draait = false;
        verwijderMelding();
        melding = document.createElement('p');
        melding.className = 'pz_voorbeeldtekst ' + soort;
        melding.textContent = tekst;
        houder.append(melding);
        renderer.render(scene, camera);
    }

    function leeg() {
        ruimOp();
        draait = false;
        verwijderMelding();
        renderer.render(scene, camera);
    }

    // Langzaam ronddraaien. Een staaf van opzij is een rechthoek; pas als hij
    // draait zie je dat het een koker met afgeronde hoeken is - en dat is nou
    // net waar het om gaat.
    renderer.setAnimationLoop(() => {
        if (!draait || hoekpunten.length === 0) return;
        hoek += 0.006;

        // De kijkrichting verandert elke stap, dus de benodigde afstand ook:
        // van opzij past een staaf van 200 mm anders in beeld dan van de kop.
        // Opnieuw uitrekenen kost acht inproducten en houdt hem altijd passend.
        const richting = new THREE.Vector3(
            Math.cos(hoek), Math.sin(hoek), HOOGTE).normalize();
        camera.position.copy(richting).multiplyScalar(benodigdeAfstand(richting));
        camera.lookAt(0, 0, 0);
        lamp.position.copy(camera.position);
        renderer.render(scene, camera);
    });

    return {
        toon, meld, leeg, meet,
        stop() { renderer.setAnimationLoop(null); renderer.dispose(); },
    };
}
