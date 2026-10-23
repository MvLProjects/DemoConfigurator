# STEP viewer + balustradeconfigurator

Proof of concept rond één vraag: kun je van natuurlijke taal naar een exact
parametrisch CAD-model komen, zonder dat de AI zelf geometrie bedenkt?

Het uitgangspunt door het hele project heen:

> De AI begrijpt de bedoeling en levert **gestructureerde parameters**.
> De CAD-engine maakt de **exacte geometrie**.
> Alles daartussen zijn **regels** die controleren en uitrekenen.

Er zitten twee deelprojecten in deze map:

| map | wat |
|---|---|
| deze map | browser-viewer en configurator — **werkt volledig** |
| `onshape-ai/` | koppeling naar Onshape — **geblokkeerd**, zie daar |

---

## Draaien

```powershell
cd C:\Users\Shadow\step-viewer-poc
powershell -ExecutionPolicy Bypass -File serve.ps1
```

Daarna in de browser: <http://localhost:8000/>

Dat servertje is nodig omdat een browser `.wasm`-bestanden en ES-modules niet
vanaf `file://` mag laden. Open je `index.html` met dubbelklikken, dan blijft het
scherm leeg.

De zelftest staat op <http://localhost:8000/selftest.html> en hoort te eindigen
met `*** ALLE CONTROLES GESLAAGD ***` (69 controles).

---

## Wat de viewer kan

1. **STEP inladen** — een bestand kiezen, of er een genereren
2. **Echte B-Rep faces en edges tonen**, geen driehoekjes
3. **Op een afzonderlijke rand klikken** en die gemarkeerd zien
4. **Assenkruis** linksonder en **navigatiekubus** rechtsboven (26 aanzichten)
5. **Balustrade genereren** uit maten, met berekend aantal spijlen
6. **Balustrade over meerdere randen** met kloppende hoeken, of rondom
7. **Trapleuning**: hellende velden, spijlen blijven verticaal
8. **Trap genereren** uit alleen de hoogte, met leuning in één handeling
9. **Stuklijst** met CSV-export voor de werkplaats
10. **In woorden opdragen**: "trap van 3 meter hoog met leuning"
11. **Instellingen bewaren** en terughalen als bestand
12. **STEP exporteren** — echte B-Rep, opnieuw in te lezen in HiCAD

---

## De keten

```
"balustrade van 2 meter lang"          een STEP-bestand
          |                                   |
          v                                   v
   command-parser.js                   brep-edges.js
   tekst -> parameters                 leesVorm(): STEP -> TopoDS_Shape
          |                                   |
          v                                   v
   balustrade-rules.js                 klik op een rand
   validatie + berekening                     |
   (aantal spijlen, doorgang)                 v
          |                            beoordeelRand()
          |                            lengte + richting van de rand
          v                                   |
          +---------------+-------------------+
                          |
                          v
                  build-balustrade.js / build-trap.js
                  OCCT bouwt de solids  -> TopoDS_Shape
                          |
                          v
                  +-------+--------+------------------+
                  |                |                  |
                  v                v                  v
          randenVan()      tessellateer()      schrijfStep()
          TopoDS_Edge      driehoeken          alleen bij exporteren
                  |                |
                  +-------+--------+
                          |
                          v
                  beeld + edge-selectie
```

Twee dingen zijn belangrijk aan die tekening.

**Alles komt samen op de vorm, niet op het bestand.** Een ingeladen STEP en een
zelfgebouwde trap zijn na één stap allebei een `TopoDS_Shape`, en daarna is er
geen verschil meer. Daardoor werken edge-selectie, face-selectie en export
automatisch ook voor wat je zelf maakt, en is er maar één pad dat stuk kan gaan.

**De STEP-omweg is eruit.** Eerst gaf elke bouwer STEP-bytes terug, die de viewer
meteen weer ontleedde. Dat leek netjes — één deur voor alles — maar het kostte per
trap 2,4 s aan schrijven en opnieuw ontleden van iets wat we al in handen hadden.
Nu wordt er alleen nog een STEP geschreven als je op **Exporteer STEP** drukt, uit
dezelfde vorm die in beeld staat. De selftest controleert dat de korte weg exact
dezelfde topologie en randlengtes geeft als de lange.

---

## Bestanden

| bestand | wat het doet |
|---|---|
| `index.html` | de pagina: balk en tabbladen bovenaan, open tabblad links, beeld rechts |
| `main.js` | de lijm: laden, selecteren, tabbladen, export |
| `brep-edges.js` | OCCT: STEP lezen, edges eruit halen, STEP schrijven |
| `tessellate.js` | OCCT-vorm -> driehoeken voor three.js |
| `navigation.js` | assenkruis en navigatiekubus |
| `regels.json` | **de enige bron** voor normwaarden, grenzen en ijkpunten |
| `balustrade-rules.js` | de rekenregels: hoeveel spijlen, welke afstand |
| `trap-regels.js` | de trapregels: optrede, aantrede, loopregel |
| `build-trap.js` | OCCT: trap bouwen, met leuning erbij |
| `pad.js` | randen aaneenrijgen tot een pad, hoeken, hellingen, verschuiven |
| `build-balustrade.js` | OCCT: blok en balustrade bouwen, op een rand plaatsen |
| `command-parser.js` | Nederlandse zin -> parameters |
| `onderdelen.js` | gelijke productieonderdelen herkennen aan hun geometrie |
| `samenstelling.js` | die onderdelen groeperen tot een boom: staander, vulveld, handregel |
| `materialen.js` | waar een onderdeel van gemaakt is en hoe het afgewerkt wordt |
| `configuraties.js` | bewaarde profielconfiguraties: drie profielen, materiaal, coatkleur |
| `maatvoering.js` | maatlijnen in het 3D-beeld, gemeten aan de onderdelen |
| `kader.js` | een blad met rand, titelblok, aanzicht en stuklijst om te printen |
| `profielen.js` | de HiCAD-profielcatalogus: manifest -> boom, labels, zoeken |
| `profielkiezer.js` | het kiesvenster: boom, zoekveld, filters, detailpaneel |
| `profiel-geometrie.js` | doorsnede uit een profiel-STEP halen en op lengte trekken |
| `profiel-voorbeeld.js` | het kleine 3D-venstertje in het detailpaneel |
| `profielproef.html` | de catalogus nameten: doorsnede, oppervlak, afwijkingen |
| `doorsnedeproef.html` | alle 2337 doorsnedes tegen `expected-sections.csv` — langzaam |
| `expected-sections.csv` | controlewaarden per profiel, geleverd bij de catalogus |
| `balustradeproef.html` | een echte HiCAD-balustrade nameten, zie VERBETERPUNTEN.md |
| `sample/BALUSTRADE.STP` | voorbeeld uit HiCAD: 24 delen, 3 staanders, 2 vulvelden |
| `selftest.html` | 778 geautomatiseerde controles |
| `serve.ps1` | minimale webserver |
| `sample/cube.stp` | testmodel: 6 vlakken, 12 ribben, 8 hoekpunten |
| `vendor/` | opencascade.js, three.js |

---

## Eén OCCT, niet twee

Hier stonden twee WASM-bibliotheken naast elkaar: **occt-import-js** (7,6 MB) voor
de driehoeken en **opencascade.js** (50 MB) voor de topologie. Dat was nodig zolang
we dachten dat opencascade.js niet kon tessellleren, en occt-import-js kán geen
edges: die wasm exporteert alleen `ReadStepFile`, `ReadIgesFile` en `ReadBrepFile`,
en de string `brep_edges` komt er nergens in voor.

occt-import-js is eruit. `BRepMesh_IncrementalMesh` + `BRep_Tool::Triangulation`
doen hetzelfde werk op de vorm die we toch al hebben (zie `tessellate.js`). Dat
scheelt 7,6 MB, een tweede ontleding van hetzelfde bestand, en een bibliotheek
waarvan 0.0.23 de laatste versie was.

Blijft over: **opencascade.js** (50 MB), de volledige OCCT — topologie, geometrie
bouwen, STEP lezen en schrijven, tessellleren. Die 50 MB is een POC-prijs. Voor
productie maak je een slanke build met alleen `STEPControl`, `TopExp`,
`BRepAdaptor`, `GCPnts`, `BRepPrimAPI` en `BRepMesh` — dat scheelt een orde van
grootte.

---

## Hoe we weten dat het B-Rep is en geen mesh

Dit was de kernvraag van de eerste opdracht, en de tests beantwoorden hem op
vier manieren:

1. **Exacte telling.** `cube.stp` bevat letterlijk 6 `ADVANCED_FACE`,
   12 `EDGE_CURVE`, 8 `VERTEX_POINT`. OCCT geeft 6 / 12 / 8.
2. **12 ≠ 30.** Dezelfde mesh heeft 30 unieke driehoekranden.
3. **Curve-type.** Elke edge komt terug als `GeomAbs_Line` met **exact 2
   punten**. Uit een tessellatie afgeleide randen zouden gesampled zijn.
4. **Rondgang.** Exporteren en opnieuw inlezen geeft weer 6 / 12 / 8, met alle
   ribben exact 300,000000 mm en geen `POLY_LOOP` of `TRIANGULATED` in het
   bestand.

---

## Invoer, regels, afgeleid

Het onderscheid waar de configurator op draait:

| | | wie bepaalt het |
|---|---|---|
| **invoer** | lengte, hoogte | de gebruiker, via taal of formulier |
| **regels** | max. doorgang, min. hoogte, spijlbreedte | de norm en de werkplaats |
| **afgeleid** | aantal spijlen, doorgang, steek | een som met één uitkomst |

Afgeleide waarden staan bewust **niet** in het schema dat een taalmodel zou
krijgen, en zijn nergens in te vullen. Niet omdat een taalmodel niet
kan rekenen, maar omdat het antwoord dan niet controleerbaar is en per keer kan
verschillen. Bij een kinderveiligheidseis wil je een som, geen inschatting.

De berekening:

```
n spijlen tussen twee staanders geven n+1 openingen:
    doorgang = (lengte - n * spijlbreedte) / (n + 1)

doorgang <= max  uitwerken geeft:
    n >= (lengte - max) / (max + spijlbreedte)

naar boven afronden
```

Naar beneden afronden zou een te grote opening geven. Dat is precies de fout die
je bij deze eis niet mag maken.

---

## Technische bevindingen die geld waard zijn

Dingen die niet in de documentatie staan en die we door te meten hebben gevonden:

**occt-import-js kan geen edges.** De wasm exporteert alleen `ReadStepFile`,
`ReadIgesFile` en `ReadBrepFile`. De string `brep_edges` komt er nergens in voor.
Daarom is het hier nooit meer dan een tessellator geweest, en uiteindelijk ook
dat niet meer.

**Het ontleden van STEP-tekst is duurder dan al het rekenen bij elkaar.** Gemeten
op een trap van 81 delen (STEP van 1,36 MB):

| stap | tijd |
|---|---|
| trap bouwen in OCCT (81 solids) | 0,03 s |
| STEP schrijven | 0,51 s |
| STEP ontleden (`STEPControl_Reader`) | **1,84 s** |
| randen uitlezen uit de vorm | 0,01 s |
| tessellleren uit de vorm | 0,27 s |
| tessellleren via occt-import-js (incl. eigen ontleding) | 0,84 s |

Daar is één conclusie uit te trekken: niet sneller rekenen, maar de vorm niet
opschrijven en meteen weer teruglezen. Genereren ging van **2,9 s naar 0,30 s**.

Het is ook een les over meten. Ik dacht eerst dat de tessellatie het probleem was
en dat het uitlezen van de randen gratis was. Het omgekeerde bleek waar: de randen
kosten 0,01 s, en het ontleden dat *beide* nodig hadden was de rekening.

**`performance.now()` is onbruikbaar onder `--virtual-time-budget`.** De klok staat
stil zolang er gerekend wordt, dus elke meting komt uit op 0,00 s. In headless
Chrome meet je van buitenaf: dezelfde pagina met n=1 en met n=31 draaien, en het
verschil delen door 30. Wat eenmalig is (wasm laden) valt er dan uit weg.

**Een `Shape()` van een OCCT-algoritme is een verwijzing naar iets in dat
algoritme.** Gooi je het algoritme weg, dan wijst hij nergens meer naar.
`BRep_Builder::Add` kopieert de vorm in een compound die van jou is; die blijft
geldig. Alle bouwers geven daarom een compound terug, ook `bouwBlok` voor één blok.

**De Onshape API-versie hoort in de URL.** Laat je die weg, dan gebruikt Onshape
**v0** — de alleroudste. De actuele versie is **v17**, op te halen via
<https://cad.onshape.com/api/openapi>. De officiële docs op GitHub noemen nog v9.

**Twee OCCT-instanties in één tabblad lopen vast.** De tweede initialisatie komt
nooit terug. Raakt de viewer niet, maar wel de zelftest — die hergebruikt daarom
bewust de instantie van de iframe.

**Rond niet tussentijds af.** De steek op drie decimalen afronden en er 50
spijlen mee uitzetten geeft een zichtbaar scheve laatste spijl. Afronden doe je
bij het tonen, niet bij het rekenen.

**Een STEP-bestand is tekst.** Maten die er doorheen gaan komen terug met
ongeveer 0,0001 mm afwijking. De tests houden daar een marge voor aan.

**Klikmarges horen in pixels, niet in millimeters.** Three.js rekent de marge om
een lijn te raken in wereld-eenheden. Uitzoomen maakte randen onaanklikbaar.

**Passend maken op de omhullende bol werkt niet voor lange dunne dingen.** Een
balustrade van 2 m lang en 20 mm dik kwam piepklein in beeld. Nu wordt op de
acht hoekpunten van de bounding box gerekend.

---

## Eén bron voor de rekenregels

De berekening moet in twee talen bestaan: JavaScript voor de webapp, Python voor
de Onshape-kant. Dat is een risico — verandert er één, dan klopt de ander
stilletjes niet meer, en bij een veiligheidsregel is dat precies de fout die je
niet wilt.

Het is in tweeën opgelost:

**De getallen staan in `regels.json`**, en niets anders leest ze ergens anders
vandaan. `balustrade-rules.js` en `onshape-ai/balustrade.py` halen allebei hun
normwaarden en grenzen daaruit. Er is dus geen tweede lijstje met maten.

**De formule is niet te delen**, dus die wordt gecontroleerd in plaats van
gedeeld. In `regels.json` staan **ijkpunten**: tien gevallen met de uitkomst die
eruit hoort te komen, inclusief twee grensgevallen waar de doorgang precies op
100 mm uitkomt. Beide testsuites lopen die lijst af.

Dat vangnet is nagemeten, niet aangenomen: met `Math.floor` in plaats van
`Math.ceil` in de JavaScript-versie loopt de doorgang op naar 106 mm en vallen
alle tien de ijkpunten om.

```
regels.json          <- de getallen + de ijkpunten
   |         |
   v         v
balustrade-  balustrade.py
rules.js     (Python)
(JavaScript)
   |         |
   v         v
selftest     stap5_balustrade.py
   \         /
    beide controleren dezelfde ijkpunten
```

## Wat er open staat

**De normwaarden zijn plaatshouders.** 1000 mm leuninghoogte, 100 mm doorgang,
20 mm spijl. Niet gecontroleerd tegen het Bouwbesluit of een NEN-norm. Zie de
lijst `CONTROLEREN` onderaan `onshape-ai/balustrade.py`.

**Spijlen zijn recht afgezaagd**, ook waar ze een schuine handregel raken. In
werkelijkheid zouden ze in verstek op de hellingshoek gezaagd worden. Voor de
doorgang maakt het niets uit, maar de stuklijst klopt daardoor op de millimeter
niet voor een trapleuning.

**De trapleuning staat niet automatisch op de goede plek.** Je zet hem op een
rand van de trapboom en schuift hem met "verschuiving opzij" naar de juiste
kant. Welke kant positief is hangt af van de richting van de aangeklikte rand,
en die is niet te zien — dus dat is uitproberen.

**Gebogen randen worden geweigerd.** Bewust: een gebogen leuning is een ander
probleem, en hem rechttrekken zou een model geven dat er goed uitziet en niet
klopt.

**Elke opdracht schrijft een compleet STEP-bestand** en leest dat weer in. Bij
deze maten merk je dat niet; bij tientallen velden wel. Dan moet de tessellatie
rechtstreeks uit OCCT komen.

**Er zit geen taalmodel in.** `command-parser.js` is een patroonherkenner, geen
AI. Wat die niet kan en een taalmodel wel: "maak hem wat breder", "hetzelfde maar
dan lager", "een balustrade voor een trap van 15 treden". De functie is wel zo
opgezet dat er een taalmodel voor in de plaats kan zonder dat de rest verandert.

---

## De Onshape-kant

Zie `onshape-ai/README.md`. Kort:

Het parametrische model is met de hand gebouwd en werkt. De Python-scripts om de
variabelen via de REST API te zetten zijn geschreven maar **nooit live getest**,
omdat het studentenaccount geen API-keys mag aanmaken. Onshape Support bevestigde
dat op 25 september 2026:

> Onshape has implemented additional security measures to prevent automated data
> miners/scrapers from abusing the service. Your account has failed these security
> checks which are required to create an API key. Unfortunately, we are not at
> liberty to disclose any specific criteria for API key generation eligibility.

Route vooruit: een key op het account van het stagebedrijf, of kijken of
*OAuth applications* (ander tabblad, ander registratieproces) wel openstaat.

Dat is geen mislukking maar een bevinding: de keten is gebouwd en offline
getest, en de blokkade is onderbouwd.

