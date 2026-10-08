# Gewächshaus 3D

Parametrischer 3D-Konfigurator (three.js + Vite) für ein Tonnengewächshaus:
3 m breit, 2 m hoch, Länge 4 / 6 / 8 / 10 m (Module à 2 m).

- Tür und Lüftungsfenster zum Öffnen (Klick)
- Hohlkammerplatten, verzinktes Bogenprofil, Schrauben/Scharniere
- Realistisch: HDR-Himmel (generiert), weiche Schatten, Umgebungsverdunklung (Desktop), gebrochene Kanten
- Performance: kein MSAA (HDR-Pipeline + FXAA), Himmel als gebackene Cube-Map, Lambert-Boden, Render-on-demand, adaptive Auflösung (~2,3 ms/Frame bei 2048×1536 px auf einem Mac)
- „Reingehen“: Ego-Perspektive für 1,75 m Körpergröße (Augenhöhe 1,63 m, duckt sich unter Türkopf/Dachrand), Start vor dem Gewächshaus, Tür per Tippen/Klick/E öffnen
- AR-Ansicht 1:1 (iOS Quick Look/USDZ, Android Scene Viewer/WebXR, nur über https); am Desktop per QR-Code aufs Handy

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktion -> dist/
```

Vercel: Framework „Vite“, Build `npm run build`, Output `dist`.

Qualität erzwingen: `?q=high|mobile`, Debug: `?debug`, adaptive Qualität aus: `?fixed`.
