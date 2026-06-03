# Space Industry Projektuebersicht


## Startdateien

### `Index.html`
- Kleine Startseite des Spiels.
- Erstellt nur die Grundelemente: Canvas, Dropdown-Overlay und den Bootstrap-Script-Link.
- Setzt den Browser-Titel auf `Space Industry`.
- Enthaelt keine Spielwerte, keine Spiellogik und kein eingebettetes CSS mehr.
- Wird vom lokalen Server ueber `Start-Game.bat` geoeffnet.

### `Start-Game.bat`
- Bequemer Windows-Startpunkt fuer das Spiel.
- Startet zuerst den lokalen Server fuer HTML, JSON, JS, Grafiken und Sounds.
- Oeffnet danach automatisch `http://127.0.0.1:8765/Index.html` im Browser.
- Sollte statt direktem Doppelklick auf `Index.html` benutzt werden, weil Browser lokale JSON-Dateien sonst blockieren koennen.

### `styles.css`
- Enthaelt das ausgelagerte CSS der Spielseite.
- Definiert Canvas, Dropdown-Menue und Ladefehler-Anzeige.
- Ist bewusst klein gehalten, weil die meisten UI-Elemente im Canvas gezeichnet werden.
- Sollte erweitert werden, wenn spaeter echte HTML-Overlays oder Menues dazukommen.

## Datenordner `data`

### `data/config.json`
- Enthaelt globale Spielkonfiguration wie Weltgroesse, Gridgroesse und Galaxie-Werte.
- Enthaelt Speicherstand-Konstanten wie Save-Key-Prefix und Exportformat.
- Die Welt ist gross genug angelegt, damit zehn Sonnensysteme mit echten Abstaenden um das schwarze Loch passen.
- Enthaelt Grundwerte, die vor dem Start der Spiellogik vorhanden sein muessen.
- Sollte fuer Zahlenwerte genutzt werden, die das Gesamtspiel steuern.

### `data/assets.json`
- Enthaelt Bild-Sprites mit Dateipfad, Frame-Anzahl und Animationsgeschwindigkeit.
- Enthaelt Sound-Dateipfade und Lautstaerke-Faktoren.
- Maschinen mit mehreren Groessen nutzen MK-Namen und passende Dateinamen wie `TankMK1.png` oder `HangarMK3.png`.
- Trennt Asset-Daten von der Spiellogik.
- Sollte erweitert werden, wenn neue Grafiken oder Sounds ins Spiel kommen.

### `data/buildings.json`
- Enthaelt Baumenues, Baukosten, Forschungsstufen und Gebaeude-Statistiken.
- Enthaelt auch viele Gebaeude-Beschreibungstexte fuer Tooltips.
- Enthaelt die zentralen Assembler-Rezepte; UI, Produktion und Tooltip werden daraus abgeleitet.
- Nutzt `ironPlate` und `copperPlate` fuer verarbeitete Metalle, nicht mehr die alten Rohstoffnamen `iron` und `copper`.
- Benennt Varianten als MK-Reihe, zum Beispiel `Warehouse MK1`, `Warehouse MK2`, `Tank MK1`, `Tank MK2` und `Hangar MK1` bis `Hangar MK3`.
- Crew-Gebaeude sind Basisfreischaltungen und stehen nicht mehr als eigener Forschungs-Tier im Labor.
- Ist der wichtigste Ort fuer Balancing von Maschinen, Forschung und Baukosten.
- Sollte gepflegt werden, wenn neue Module, Rezepte oder Forschungseintraege dazukommen.

### `data/resources.json`
- Enthaelt Startressourcen, Ressourcenlisten und Tank-Optionen.
- Enthaelt Asteroiden-Ressourcentabellen und das Startschiff-Layout.
- Asteroiden liefern `ironOre` und `copperOre`; die Schmelze macht daraus `ironPlate` und `copperPlate`.
- Definiert das aktuelle Startschiff inklusive Quarters, Farm Module, Life Support und Battery.
- Trennt Inventar- und Ressourcenwerte von der Simulationslogik.
- Sollte angepasst werden, wenn neue Rohstoffe, Fluessigkeiten oder Startbedingungen dazukommen.

### `data/celestial.json`
- Enthaelt Planetentypen und Sterntypen.
- Steuert Farben, Namen und visuelle Eigenschaften von Himmelskoerpern.
- Planetare Metallfunde verwenden Erz-Schluessel wie `ironOre` und `copperOre`.
- Wird von der Galaxie-Generierung benutzt.
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
- Muss frueh geladen werden, weil fast alle anderen Dateien darauf aufbauen.

### `js/game/01-world.js`
- Enthaelt Weltobjekte wie Asteroiden, Planeten, Sterne, Schwarzes Loch und Asteroidenguertel.
- Erzeugt Galaxie, Nebel und Himmelskoerper.
- Skaliert Planeten und Sterne mit einem zentralen Groessenfaktor; das schwarze Loch nutzt einen kleineren eigenen Faktor und langsamere Ringe.
- Baut Planetenbahnen mit Sicherheitsabstand zu Stern, Nachbarbahnen, Sonnensystemrand und schwarzem Loch auf.
- Platziert Asteroidenguertel in mittleren freien Luecken zwischen Planetenbahnen statt direkt am Stern oder ganz am Systemrand.
- Stellt sicher, dass Asteroiden nicht innerhalb von Sternen, Planeten oder dem schwarzen Loch erzeugt werden.
- Das schwarze Loch ist wieder eine zerstoerende Kollisionsgefahr, ausser der Adminmodus ist aktiv.
- Zeichnet Gasplaneten mit einer weichen aeusseren Wolkenschicht, die nur optisch ist und nicht als Kollisionsflaeche zaehlt.
- Enthaelt Orbit-, Gravitation-, Lande- und Sonneneffizienz-Logik.
- Haengt stark mit Flugphysik und Ressourcenabbau zusammen.

### `js/game/02-resources-research.js`
- Enthaelt Ressourcenlagerung, Asteroideninhalte und Forschung.
- Steuert Baukostenpruefung, Forschungskauf und sichtbare Inventargegenstaende.
- Enthaelt Assembler-, Drill- und Ernte-Hilfsfunktionen.
- Leitet Assembler-Auswahl und Assembler-Tooltip aus den Rezeptdaten in `data/buildings.json` ab.
- Ist die zentrale Datei fuer Wirtschaft, Forschung und Produktionsfreischaltung.

### `js/game/03-flight.js`
- Enthaelt Zielerkennung im Weltraum und Flugassistenz.
- Berechnet Annaeherung, Geschwindigkeitsabgleich und Trajektorien.
- Verwaltet dynamische Asteroiden lokal um das Schiff und entfernt entfernte Asteroiden wieder.
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
- Ist gross, weil Drohnen- und Kampfsysteme aktuell eng miteinander verbunden sind.

### `js/game/06-build-ui-controls.js`
- Enthaelt Build-UI-Hilfen, Inventarpositionen und Dropdown-Menues.
- Enthaelt Maus-, Tastatur-, Klick-, Scroll- und Resize-Events.
- Pausiert die Simulation, wenn Tab oder Fenster in den Hintergrund wechseln.
- Erlaubt im Adminmodus mit Shift einen 100-Tile-Sprung nach vorne; mit gehaltenem Shift kann auch W mehrfach fuer weitere Spruenge gedrueckt werden.
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
- Namen erscheinen erst in der fokussierten Systemansicht; dort werden Planeten deutlich groesser gezeichnet.
- Enthaelt die meisten Canvas-Ausgabefunktionen.
- Sollte erweitert werden, wenn neue sichtbare Panels oder Anzeigen dazukommen.

### `js/game/08-simulation.js`
- Aktualisiert Build-Kamera, Build-Commit, Ressourcen und Gefahren.
- Enthaelt Produktionslogik fuer Maschinen und Crew-Reparaturen.
- Schmelzt Erze zu Platten und verarbeitet Assembler-Rezepte aus den JSON-Daten.
- Begrenzt gespeicherte Energie auf echte Batteriekapazitaet, laesst Solarstrom aber direkt Maschinen versorgen.
- Ignoriert im Adminmodus zerstoerende Kollisionen und Sternhitze.
- Enthaelt Hitzeschaden, Kollisionen, Schilde und Spielsounds.
- Wird im Hauptloop aufgerufen, wenn das Spiel aktiv laeuft.

### `js/game/09-save-menu-loop.js`
- Enthaelt Speichern, Laden, Import, Export und Autosave.
- Zeichnet Hauptmenue, Save-Slots, Pausenmenue und Save-Dialoge.
- Migriert alte Saves von `iron`/`copper` auf `ironPlate`/`copperPlate`.
- Speichert und laedt die laufende Spielzeit, die in der UI angezeigt wird.
- Alte Saves starten nicht automatisch mit Admin-Build, neue Saves behalten die bewusst gespeicherte Einstellung.
- Enthaelt den Hauptloop, der Update- und Draw-Funktionen in der richtigen Reihenfolge aufruft.
- Nutzt `data/texts.json` fuer Menue-, Pause- und Savegame-Texte.

### `js/game/09-planet-landing.js`
- Enthaelt das neue Planeten-Landesystem und den passiven Ressourcenabbau auf Planeten.
- Definiert Landing-Zustaende wie Anflug, Einkreisen, Abstieg und gelandet.
- Stellt `updateLandingMode`, `updatePlanetMining`, `shouldSkipGravity` und `drawLandingOverlay` bereit.
- Muss vor `09-save-menu-loop.js` geladen werden, weil der Hauptloop und die Simulation diese Funktionen aufrufen.

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
- Neue Spielskripte unter `js/game` ablegen und danach in `js/app.js` in der richtigen Reihenfolge eintragen.
- Diese Datei aktualisieren, sobald sich Zweck, Reihenfolge oder Verantwortlichkeit einer Datei aendert.
