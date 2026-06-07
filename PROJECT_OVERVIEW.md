# Space Industry Projektuebersicht


## Startdateien

### `index.html`
- Kleine Startseite des Spiels.
- Erstellt nur die Grundelemente: Canvas, Dropdown-Overlay und den Bootstrap-Script-Link.
- Setzt den Browser-Titel auf `Space Industry`.
- Enthaelt keine Spielwerte, keine Spiellogik und kein eingebettetes CSS mehr.
- Wird vom lokalen Server ueber `Start-Game.bat` geoeffnet.

### `Start-Game.bat`
- Bequemer Windows-Startpunkt fuer das Spiel.
- Startet zuerst den lokalen Server fuer HTML, JSON, JS, Grafiken und Sounds.
- Oeffnet danach automatisch `http://127.0.0.1:8765/index.html` im Browser.
- Sollte statt direktem Doppelklick auf `index.html` benutzt werden, weil Browser lokale JSON-Dateien sonst blockieren koennen.

### `styles.css`
- Enthaelt das ausgelagerte CSS der Spielseite.
- Definiert Canvas, Dropdown-Menue und Ladefehler-Anzeige.
- Ist bewusst klein gehalten, weil die meisten UI-Elemente im Canvas gezeichnet werden.
- Nutzt eine technische Monospace-Schrift fuer HTML-UI; Canvas-Texte verwenden denselben Stil direkt in der Spiellogik.
- Sollte erweitert werden, wenn spaeter echte HTML-Overlays oder Menues dazukommen.

## Datenordner `data`

### `data/config.json`
- Enthaelt globale Spielkonfiguration wie Weltgroesse, Gridgroesse und Galaxie-Werte.
- Enthaelt Speicherstand-Konstanten wie Save-Key-Prefix und Exportformat.
- Die Welt ist gross genug angelegt, damit acht Sonnensysteme mit echten Abstaenden um das schwarze Loch passen.
- Enthaelt Grundwerte, die vor dem Start der Spiellogik vorhanden sein muessen.
- Sollte fuer Zahlenwerte genutzt werden, die das Gesamtspiel steuern.

### `data/assets.json`
- Enthaelt Bild-Sprites mit Dateipfad, Frame-Anzahl und Animationsgeschwindigkeit.
- Enthaelt Sound-Dateipfade und Lautstaerke-Faktoren.
- Enthaelt `labFinish` fuer den Sound `Sounds/LabFinish.mp3`, der bei abgeschlossener Forschung abgespielt wird.
- Enthaelt `tutorial` fuer den geloopten Sound `Sounds/Tutorial.mp3`, der nur waehrend des Typewriter-Texts laeuft.
- Die individuellen `SOUND_VOLUMES` werden mit einem festen Grundpegel multipliziert: Ein Faktor `2` ist doppelt so laut wie `1`, ohne die anderen Sounds zu veraendern.
- Startet den Background-Sound alle 5 Sekunden als neue Instanz, sodass ein leicht laengerer vorheriger Durchlauf weich ausklingen kann.
- Startet Thruster alle 7 Sekunden sowie Smelter und Drill jede Sekunde ueberlappend neu; aktive Instanzen erhalten eine kleine Lautstaerkevariation und sind pro Sound auf zwei begrenzt.
- Maschinen mit mehreren Groessen nutzen MK-Namen und passende Dateinamen wie `TankMK1.png` oder `HangarMK3.png`.
- Turret-Vorschau-Sprites verweisen auf vorhandene Basis- oder Off-Sprites; aktive Varianten werden im Kampfsystem separat ausgewaehlt.
- Trennt Asset-Daten von der Spiellogik.
- Sollte erweitert werden, wenn neue Grafiken oder Sounds ins Spiel kommen.

### `data/buildings.json`
- Enthaelt Baumenues, Baukosten, Forschungsstufen und Gebaeude-Statistiken.
- Trennt Turrets im Build-Menue in einen eigenen `Combat`-Tab zwischen `Spaceship` und `Storage`.
- Build-Menue-Tabs bleiben auch anwählbar, wenn darin noch keine Gebaeude freigeschaltet sind.
- Sortiert Build-Tab-Inhalte nach Freischaltreihenfolge.
- Production priorisiert das Laboratory im Build-Menue oben.
- Enthaelt auch viele Gebaeude-Beschreibungstexte fuer Tooltips.
- Enthaelt die zentralen Assembler-Rezepte; UI, Produktion und Tooltip werden daraus abgeleitet.
- Nutzt `ironPlate` und `copperPlate` fuer verarbeitete Metalle, nicht mehr die alten Rohstoffnamen `iron` und `copper`.
- Benennt Varianten als MK-Reihe, zum Beispiel `Warehouse MK1`, `Warehouse MK2`, `Tank MK1`, `Tank MK2` und `Hangar MK1` bis `Hangar MK3`.
- Enthaelt die Endgame-Module `Battery MK2`, `Event horizon Shield`, `Gravitational pull stabilizer` und `Quantum computer` mit Baukosten, Forschung, Stats und Platziergroessen.
- Balanciert Endgame-Energieverbrauch aktuell auf `Event horizon Shield` 50/sec, `Gravitational pull stabilizer` 20/sec und `Quantum computer` 8/sec.
- Crew-Gebaeude sind Basisfreischaltungen und stehen nicht mehr als eigener Forschungs-Tier im Labor.
- Ist der wichtigste Ort fuer Balancing von Maschinen, Forschung und Baukosten.
- Sollte gepflegt werden, wenn neue Module, Rezepte oder Forschungseintraege dazukommen.

### `data/resources.json`
- Enthaelt Startressourcen, Ressourcenlisten und Tank-Optionen.
- Enthaelt Asteroiden-Ressourcentabellen und das Startschiff-Layout.
- Asteroiden liefern `ironOre` und `copperOre`; die Schmelze macht daraus `ironPlate` und `copperPlate`.
- Definiert das aktuelle Startschiff inklusive Quarters, Farm Module, Life Support und Battery MK1.
- Trennt Inventar- und Ressourcenwerte von der Simulationslogik.
- Sollte angepasst werden, wenn neue Rohstoffe, Fluessigkeiten oder Startbedingungen dazukommen.

### `data/celestial.json`
- Enthaelt Planetentypen und Sterntypen.
- Steuert Farben, Namen und visuelle Eigenschaften von Himmelskoerpern.
- Planetare Metallfunde verwenden Erz-Schluessel wie `ironOre` und `copperOre`.
- Wird von der Galaxie-Generierung benutzt; normale Welten erzeugen acht Sonnensysteme mit 3 bis 9 Planeten und 1 oder 2 Asteroidenguerteln pro System.
- Sollte erweitert werden, wenn neue Planetenarten, Sterne oder Weltraumbiome dazukommen.

### `data/enemies.json`
- Enthaelt aktuell die Flotten-Auswahlregeln fuer Gegner.
- Bestimmt, ab welcher Staerke welche Gegnerflotten erscheinen.
- Die erste Flotte bleibt fuer das Startschiff erreichbar; staerkere Flotten starten erst bei deutlich hoeherer Schiffsgroesse.
- Die konkreten Gegner-Schiffsdesigns liegen noch in `js/game/05-small-ships-combat.js`, weil sie Helferfunktionen benutzen.
- Kann spaeter weiter ausgebaut werden, wenn Gegnerdesigns ebenfalls rein datenbasiert werden.

### `data/texts.json`
- Zentrale Datei fuer sichtbare Texte, besonders Menue, Savegame, Buttons und Tutorial.
- Enthaelt bereits einen vorbereiteten `tutorial`-Bereich fuer spaetere Tutorial-Schritte.
- Savegame-Logik bleibt in JavaScript, aber sichtbare Savegame-Texte liegen hier.
- Sollte der erste Ort sein, wenn neue UI-Texte, Dialogtexte oder Tutorialtexte entstehen.

## JavaScript Einstieg

### `js/bootstrap.js`
- Laedt zuerst alle JSON-Daten aus dem `data`-Ordner.
- Laedt danach `js/app.js`, um die Reihenfolge der Spielskripte zu kennen.
- Liest die Dateien aus `js/game` und startet sie gemeinsam, damit alte Funktionsabhaengigkeiten erhalten bleiben.
- Zeigt eine Ladefehlermeldung, wenn das Spiel nicht korrekt ueber den lokalen Server gestartet wurde.

### `js/app.js`
- Ist nur noch die geordnete Liste der Spielskripte.
- Bestimmt die Reihenfolge, in der die Dateien unter `js/game` zusammengesetzt werden.
- Enthaelt keine eigentliche Spiellogik mehr.
- Muss aktualisiert werden, wenn neue Spielskript-Dateien hinzukommen oder die Reihenfolge geaendert wird.
- Die Nummerierung der Dateien unter `js/game` folgt der Lade-Reihenfolge und ist eindeutig.

### `js/local-server.js`
- Kleiner lokaler Server fuer das Spiel.
- Liefert HTML, CSS, JavaScript, JSON, PNG und MP3 mit passenden Dateitypen aus.
- Wird von `Start-Game.bat` gestartet.
- Ist noetig, damit Browser die ausgelagerten JSON-Dateien normal laden duerfen.

## Spielskripte `js/game`

### `js/game/00-runtime.js`
- Initialisiert Canvas, Kontext, globale Daten und geladene Assets.
- Entpackt JSON-Daten und stellt die zentrale `text(...)`-Funktion bereit.
- Definiert globale Spielzustaende, Startmodule, Arrays und Grundklassen wie `Camera` und `Ship`.
- Haelt globale Endgame-Zustaende fuer Dyson-Sphaeren, Black-Hole-Abschluss und freigeschaltetes Home-Screen-Symbol.
- Muss frueh geladen werden, weil fast alle anderen Dateien darauf aufbauen.

### `js/game/01-world.js`
- Enthaelt Weltobjekte wie Asteroiden, Planeten, Sterne, Schwarzes Loch und Asteroidenguertel.
- Erzeugt Galaxie, Nebel und Himmelskoerper.
- Skaliert Planeten und Sterne mit einem zentralen Groessenfaktor; das schwarze Loch nutzt einen kleineren eigenen Faktor und langsamere Ringe.
- Baut Planetenbahnen mit Sicherheitsabstand zu Stern, Nachbarbahnen, Sonnensystemrand und schwarzem Loch auf.
- Planeten brauchen 1-3 Spielstunden fuer einen Umlauf um ihre Sonne.
- Sonnensysteme brauchen 3-5 Spielstunden fuer einen Umlauf um das schwarze Loch.
- Teilt die Welt in aktive Chunks um Mutterschiff und Flotte ein.
- Stellt Hilfsfunktionen bereit, um Sterne und Planeten bei Bedarf aus `worldPlayTime` auf ihre aktuelle Orbitposition zu setzen.
- Erstellt pro Sonnensystem einen inneren und einen aeusseren Asteroidenguertel; beide sind breiter als frueher.
- Zeichnet bei niedrigerem Zoom nur einen Teil der Belt-Rocks, damit grosse Guertel guenstiger bleiben.
- Aktualisiert Kartenpositionen fuer Sterne und Planeten gecacht statt jedes Frame.
- Platziert Asteroidenguertel bevorzugt in freien Luecken zwischen Planetenbahnen und nutzt Fallbacks, wenn nicht genug grosse Luecken entstehen.
- Stellt sicher, dass Asteroiden nicht innerhalb von Sternen, Planeten oder dem schwarzen Loch erzeugt werden.
- Das schwarze Loch ist wieder eine zerstoerende Kollisionsgefahr, ausser der Adminmodus ist aktiv.
- Zeichnet Gasplaneten mit einer weichen aeusseren Wolkenschicht, die nur optisch ist und nicht als Kollisionsflaeche zaehlt.
- Enthaelt Orbit-, Gravitation-, Lande- und Sonneneffizienz-Logik.
- Laesst Thruster bei Maximalgeschwindigkeit in ruhigen 1s-an/1s-aus-Pulsen anzeigen und hoerbar machen, statt pro Frame zu flackern.
- Haengt stark mit Flugphysik und Ressourcenabbau zusammen.

### `js/game/02-resources-research.js`
- Enthaelt Ressourcenlagerung, Asteroideninhalte und Forschung.
- Steuert Baukostenpruefung, Forschungskauf und sichtbare Inventargegenstaende.
- Enthaelt Assembler-, Drill- und Ernte-Hilfsfunktionen.
- Leitet Assembler-Auswahl und Assembler-Tooltip aus den Rezeptdaten in `data/buildings.json` ab.
- Asteroidenabbau lagert nur Ressourcen ein, die wirklich Platz im Schiffslager finden; nicht eingelagerte Reste bleiben im Asteroiden.
- Ist die zentrale Datei fuer Wirtschaft, Forschung und Produktionsfreischaltung.

### `js/game/03-flight.js`
- Enthaelt Zielerkennung im Weltraum und Flugassistenz.
- Berechnet Annaeherung, Geschwindigkeitsabgleich und Trajektorien.
- Verwaltet dynamische Asteroiden lokal um das Schiff und entfernt entfernte Asteroiden wieder.
- Erzeugt dynamische lokale Belt-Asteroiden erst, wenn das Schiff in einem Asteroidenguertel ist.
- Entfernt lokale Asteroiden auch dann, wenn sie durch Bewegung in Planeten, Sterne oder das schwarze Loch geraten.
- Enthaelt Koordinatenumrechnung zwischen Welt, Bildschirm und Grid.
- Bereitet viele Werte vor, die Zeichnung und Steuerung brauchen.

### `js/game/04-ship-building.js`
- Enthaelt Modulplatzierung, Verbindung, Rotation, Import und Export von Schiffen.
- Verarbeitet Bauplaene, Demontage und Gueltigkeitspruefungen.
- Uebersetzt alte Modulnamen aus Saves oder Schiffscodes auf neue MK-Namen.
- Enthaelt Reparatur- und Schadens-Hilfsfunktionen fuer Module.
- Ist der Kernbereich fuer Build-Mode und Schiffseditor.

### `js/game/05-small-ships-combat.js`
- Enthaelt kleine Schiffe, Hangars, Drohnenaufgaben und Rueckkehrlogik.
- Enthaelt Gegnerdesigns, Gegnerflotten, Gegnerbewegung und Gegnerabbau.
- Enthaelt Turrets, Schuesse, Schilde und Kampftreffer.
- Turrets suchen neue Ziele nur alle 0.5 Sekunden und nutzen zwischendurch ihr gecachtes Ziel.
- Hangar-Drohnen und gegnerische Turrets fuehren teure Entscheidungspruefungen in Intervallen aus.
- Gegner koennen Dyson-Sphaeren als Ziel angreifen und deren Baufortschritt wieder beschaedigen.
- In der Endwelt werden Gegner als violett leuchtende Schiffe einer alten Roboterzivilisation dargestellt; der erste Kontakt zeigt einen Tutorial-Hinweis.
- Zaehlt zerstoerte gegnerische Schiffe fuer das Endresultat.
- Ist gross, weil Drohnen- und Kampfsysteme aktuell eng miteinander verbunden sind.

### `js/game/06-build-ui-controls.js`
- Enthaelt Build-UI-Hilfen, Inventarpositionen und Dropdown-Menues.
- Enthaelt Maus-, Tastatur-, Klick-, Scroll- und Resize-Events.
- Pausiert die Simulation, wenn Tab oder Fenster in den Hintergrund wechseln.
- Erlaubt im Adminmodus mit Shift einen 100-Tile-Sprung nach vorne; mit gehaltenem Shift kann auch W mehrfach fuer weitere Spruenge gedrueckt werden.
- Der Admin-Sprung zeigt nur eine kurze Meldung und spielt keinen Toggle-Sound mehr ab.
- Rechtsklick-Ziehen kann Abrissmarkierungen je nach Startpunkt setzen oder wieder entfernen.
- Steuert viele direkte Benutzeraktionen im Build-Mode und Flugmodus.
- Ist der beste Ort fuer neue Eingabebedienung oder Canvas-UI-Klicklogik.

### `js/game/07-drawing.js`
- Zeichnet Grid, Sterne, Module, kleine Schiffe, Karte, UI und Ressourcenleisten.
- Enthaelt Sprite-Zeichnung, Tooltips, Buttons und Inventarboxen.
- Zeichnet Labor-Kosten in fester Item-Spalte mit Ressourcenicons; 1-3 Kosten bleiben einzeilig, 4-7 werden zweizeilig, ab 8 dreizeilig.
- Zeichnet die Galaxy Map als echte Weltkarte ohne komprimierte Sonnensystem-Miniaturen.
- Planeten, Sterne, Guertel, schwarzes Loch und Spielerpfeil nutzen auf der Karte dieselben Weltkoordinaten wie im Spiel.
- Zeigt unten links die gespeicherte Spielzeit als Stunden, Minuten und Sekunden in einem gerahmten UI-Feld.
- Zeigt den Adminstatus als `Admin mode` an, passend zum Toggle-Text.
- Nutzt ein vorberechnetes Parallax-Sternmuster statt die Hintergrundsterne jedes Frame neu zu erzeugen.
- Nutzt Map- und Tooltip-Caches fuer wiederholte Hover- und Kartenabfragen.
- Ueberspringt offscreen liegende Module frueh, bevor Sprites, Texte und Overlays berechnet werden.
- Namen erscheinen erst in der fokussierten Systemansicht; dort werden Planeten deutlich groesser gezeichnet.
- Ressourcen-Scans fuer Planeten, Sterne und Asteroiden sind erst ab Computer MK2 sichtbar.
- Asteroiden-Scans zeigen nur Ressourcen, die aktuell wirklich noch im Asteroiden enthalten sind.
- Zeichnet Dyson-Sphaeren um Sterne, den Orbit-Button `Build Dyson sphere` und das Baupanel unten rechts.
- Zeichnet Turret-Tab-Icons inklusive Oberteil statt nur der Basis.
- Zeichnet lange Tooltip-Beschreibungen mit Zeilenumbruch, damit Texte nicht gequetscht werden.
- Das Salvage-Panel zentriert Icon und Titel vertikal und bietet pro Typ eine rote `delete`-Aktion.
- Salvage-Module werden unabhaengig von ihrer Drehung gestapelt; die separate graue Groessenanzeige wurde entfernt und Icons sind kompakter.
- Automatisch oder manuell entfernte Salvage-Blaupausen geben ihr kostenloses Modul an das Salvage-Panel zurueck. Normale unbezahlte Blaupausen bleiben unveraendert.
- Enthaelt die meisten Canvas-Ausgabefunktionen.
- Sollte erweitert werden, wenn neue sichtbare Panels oder Anzeigen dazukommen.

### `js/game/08-simulation.js`
- Aktualisiert Build-Kamera, Build-Commit, Ressourcen und Gefahren.
- Enthaelt Produktionslogik fuer Maschinen und Crew-Reparaturen.
- Spielt den Drill-Sound als Loop, solange ein Bohrer arbeitet oder das Mutterschiff auf einem Planeten gelandet ist.
- Stoppt Gameplay- und Background-Sounds in pausierenden Ansichten wie Baumodus, Hangar, Map, Labor, Maschinenfenstern und Dialogen; Maus-Klicks bleiben im Baumodus hoerbar.
- Prueft Weltraumgefahren nur in den aktiven Welt-Chunks um Mutterschiff und Flotte.
- Prueft grosse Koerper ueber ihre Kreisflaeche gegen aktive Chunks, damit Kollisionen mit Planeten, Sternen und schwarzem Loch auch an der Oberflaeche erkannt werden.
- Nutzt guenstigere quadratische Distanzvergleiche in Kollisionspfaden, wenn keine echte Distanz gebraucht wird.
- Fasst Solar-Panel-Produktion zusammen, statt sie in einem separaten Durchlauf pro Panel zu addieren.
- Addiert fertige Dyson-Sphaeren als starken Ladebonus, wenn das Mutterschiff am passenden Stern im Orbit ist.
- Blockiert Sternressourcen durch Solar-Wind-Collector, wenn der Stern von einer fertigen Dyson-Sphaere umschlossen ist.
- Schmelzt Erze zu Platten und verarbeitet Assembler-Rezepte aus den JSON-Daten.
- Begrenzt gespeicherte Energie auf echte Batteriekapazitaet, laesst Solarstrom aber direkt Maschinen versorgen.
- Ignoriert im Adminmodus zerstoerende Kollisionen und Sternhitze.
- Enthaelt Hitzeschaden, Kollisionen, Schilde und Spielsounds.
- Wird im Hauptloop aufgerufen, wenn das Spiel aktiv laeuft.

### `js/game/09-landing.js`
- Enthaelt das Planeten-Landesystem und den passiven Ressourcenabbau auf Planeten.
- Definiert Landing-Zustaende wie Anflug, Einkreisen, Abstieg und gelandet.
- Stellt `updateLandingMode`, `updatePlanetMining`, `shouldSkipGravity` und `drawLandingOverlay` bereit.
- Muss nach Simulation-Grundlagen und vor Tutorial sowie Hauptloop geladen werden, weil Simulation und Loop diese Funktionen aufrufen.

### `js/game/10-tutorial.js`
- Enthaelt Tutorial-Schritte, Tutorial-Ereignisse und das Tutorial-Overlay.
- Blockiert bei offenen Tutorial-Hinweisen die Simulation, wenn ein Schritt dies verlangt.
- Reagiert auf Spielereignisse wie Bauen, Forschung, Asteroidenabbau und Build-Mode.
- Neue Welten starten das Tutorial wieder neu; Skip gilt nur fuer die laufende Tutorial-Sitzung.
- Tutorial-Hinweise warten auf die passende Spieleraktion und kurze Ausprobierzeiten, statt direkt den naechsten Text zu zeigen.
- Map-Tutorials erscheinen nur in der normalen Welt und nicht im Baumodus; nach 2 Sekunden Kartenansicht folgt ein eigener Linksklick-Hinweis fuer Sonnensysteme.
- Tutorial-Fenster erscheinen nur im normalen Flug ohne Labor-, Assembler-, Turret-, Dyson-, Dialog- oder Bauansicht; die Map-Ausnahme gilt nur fuer den System-Klick-Hinweis.
- Tutorial-Texte werden mit Typewriter-Effekt eingeblendet; ein Klick auf `Ok` zeigt erst den ganzen Text und bestaetigt erst beim naechsten Klick.
- Bereits ausgefuehrte Aktionen wie Map oeffnen oder Toggles verhindern, dass der passende Tutorial-Hinweis spaeter nachtraeglich erscheint.
- Quantum-computer-Hinweise zeigen den aktuellen Fortschritt fuer benoetigte Gravitational-pull-Stabilizer.
- Sollte erweitert werden, wenn neue gefuehrte Einstiegsschritte dazukommen.

### `js/game/11-save-menu-loop.js`
- Enthaelt Speichern, Laden, Import, Export und Autosave.
- Zeichnet Hauptmenue, Save-Slots, Pausenmenue und Save-Dialoge.
- Migriert alte Saves von `iron`/`copper` auf `ironPlate`/`copperPlate`.
- Speichert und laedt die laufende Spielzeit, die in der UI angezeigt wird.
- Alte Saves starten nicht automatisch mit Admin-Build, neue Saves behalten die bewusst gespeicherte Einstellung.
- Enthaelt den Hauptloop, der Update- und Draw-Funktionen in der richtigen Reihenfolge aufruft.
- Zeichnet den globalen Lautstaerkeregler als oberste UI-Ebene in allen Spiel-, Karten-, Bau-, Dialog- und Menuezustaenden.
- Speichert die eingestellte Gesamtlautstaerke unter `spaceIndustry.masterVolume` in den Browserdaten.
- Aktualisiert und zeichnet im normalen Flug nur aktive Sonnensysteme und Asteroidenbereiche.
- Synchronisiert alle Stern- und Planetenpositionen nur dann auf die aktuelle Spielzeit, wenn die Galaxy Map geoeffnet ist.
- Speichert und laedt Dyson-Sphaeren sowie den Black-Hole-Abschlussstatus.
- Speichert und laedt die noch nicht verbauten Module aus dem Salvage-Fenster.
- Zeigt das Black-Hole-Ende als eigenen Spielzustand mit Verlust- oder Erfolgsmeldung, Download-Result-Button, Continue-Button fuer die Welt `End` und Quit-Button zum Homescreen.
- Zeigt bei Black-Hole-Verlust die fehlenden Anforderungen an: Energie, Event-horizon-Shields, Stabilizer und Quantum computer.
- Nutzt denselben Game-Over-Zustand auch fuer andere Todesursachen und bietet `Load Autosave [Sekunden]` direkt im Verlustfenster an.
- Autosaves rotieren minuetlich durch die letzten drei Staende; Ladebildschirm und Game-Over-Auswahl lassen den Spieler einen dieser drei Staende auswaehlen.
- Autosave-Alter wird aus der Spielzeit berechnet, nicht aus echter Uhrzeit, damit Timer im Homescreen oder nach Game Over nicht weiterlaufen.
- Der Quantum computer kann im Schiff angeklickt werden und zeigt Energie-, Stabilizer-, Quantum- und dynamische Shield-Anforderungen fuer das schwarze Loch.
- Erstellt beim Download ein PNG mit Mutterschiff, Spielzeit, zerstoerten Gegnern, Datum, Version, Logo und Spielernamen.
- Die Endwelt enthaelt zwei fertige Dyson-Sphaeren an Sternen, die Energie liefern und Gegnerangriffe provozieren.
- Zeigt nach erfolgreichem Abschluss ein kleines schwarzes Loch unten rechts im Homescreen.
- Pausiert die Gameplay-Simulation im Baumodus; Baukamera, Platzierung und Build-Commit bleiben aktiv.
- Manuelles Speichern aus dem Pausenmenue bleibt nach dem Speichern im Pausenmenue, statt in das Hauptmenue zu springen.
- Der Inactive-Overlay blockiert nur das laufende Spiel, nicht Menues oder offene Dialoge.
- Save-Dialoge werden ueber dem Pausenmenue gezeichnet; die Pause-Verdunkelung wird bei offenem Dialog reduziert.
- Neue Welten werden direkt beim Start in den ausgewaehlten Save-Slot geschrieben, inklusive Seed und Startzustand.
- Der Start-Stern einer normalen Welt wird aus dem Seed bestimmt, damit Spieler nicht immer im gleichen Sonnensystem beginnen.
- Nutzt `data/texts.json` fuer Menue-, Pause- und Savegame-Texte.

## Assetordner

### `Graphics`
- Enthaelt alle Bilddateien fuer Icons, Maschinen und Logo.
- Die Nutzung dieser Dateien wird in `data/assets.json` definiert.
- Neue Grafiken sollten moeglichst dort einsortiert werden, wo aehnliche Grafiken schon liegen.
- Dateinamen sollten stabil bleiben, weil JSON und Code direkt darauf verweisen.

### `Sounds`
- Enthaelt alle MP3-Dateien fuer Spielsounds.
- Die Nutzung und Lautstaerke wird in `data/assets.json` definiert.
- Neue Sounds sollten dort abgelegt und anschliessend in `assets.json` eingetragen werden.
- Soundnamen im Code sollten zu den Schluesseln in `SOUND_FILES` passen.

## Pflege-Regeln

- Neue sichtbare Texte zuerst in `data/texts.json` anlegen und dann im Code mit `text("bereich.schluessel")` benutzen.
- Neue Balancingwerte nach Moeglichkeit in eine passende JSON-Datei unter `data` legen.
- Neue Spielskripte unter `js/game` mit eindeutiger Nummer in Lade-Reihenfolge ablegen und danach in `js/app.js` eintragen.
- Dateinamen und Pfade konsequent klein schreiben, wenn sie als URL genutzt werden, damit das Projekt auch auf case-sensitiven Systemen sauber laeuft.
- Asset-Pfade in `data/assets.json` muessen auf vorhandene Dateien unter `Graphics` oder `Sounds` zeigen.
- Neue globale Weltobjekte sollten pruefen, ob sie in aktiven Chunks liegen, bevor sie dauerhaft simuliert werden.
- Diese Datei aktualisieren, sobald sich Zweck, Reihenfolge oder Verantwortlichkeit einer Datei aendert.
