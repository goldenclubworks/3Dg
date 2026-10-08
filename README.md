# Gewächshaus 3D

Parametrischer 3D-Konfigurator (three.js + Vite) für ein Tonnengewächshaus:
3 m breit, 2 m hoch, Länge 4 / 6 / 8 / 10 m (Module à 2 m).

- Tür und Lüftungsfenster zum Öffnen (Klick)
- Hohlkammerplatten, verzinktes Bogenprofil, Schrauben/Scharniere
- Realistisch: HDR-Himmel (generiert), weiche Schatten, Umgebungsverdunklung (Desktop), gebrochene Kanten
- Grafik: Standard = „Qualität“ (MSAA, Echtzeit-Himmel, PBR-Boden). Beim ersten Start kurze Kalibrierung; schafft das Gerät keine ~40 fps, wird erst die Auflösung gesenkt, dann automatisch in den Modus „Flüssig“ (FXAA, gebackener Himmel, einfacher Boden) gewechselt. Manuell unter „Mehr → Grafik“.
- Render-on-demand, Schatten nur bei Änderung, keine backdrop-filter über dem Canvas (Safari)
- „Reingehen“: Ego-Perspektive für 1,75 m Körpergröße (Augenhöhe 1,63 m, duckt sich unter Türkopf/Dachrand), Start vor dem Gewächshaus, Tür per Tippen/Klick/E öffnen
- AR-Ansicht 1:1 (iOS Quick Look/USDZ, Android Scene Viewer/WebXR, nur über https); am Desktop per QR-Code aufs Handy

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktion -> dist/
```

Vercel: Framework „Vite“, Build `npm run build`, Output `dist`.

Qualität erzwingen: `?gfx=quality|smooth`, `?q=high|mobile`, Debug: `?debug`, adaptive Qualität aus: `?fixed`.
