# Gewächshaus 3D

Parametrischer 3D-Konfigurator (three.js + Vite) für ein Tonnengewächshaus:
3 m breit, 2 m hoch, Länge 4 / 6 / 8 / 10 m (Module à 2 m).

- Tür und Lüftungsfenster zum Öffnen (Klick)
- Hohlkammerplatten, verzinktes Bogenprofil, Schrauben/Scharniere
- Realistisch: HDR-Himmel (generiert), weiche Schatten, Umgebungsverdunklung (Desktop), gebrochene Kanten
- Handy-optimiert: schlankere Geometrie, 2k-Schatten, Render-on-demand, adaptive Auflösung
- „Reingehen“: Ego-Perspektive zum Hineinlaufen und Umsehen (WASD / Joystick, Ziehen = umsehen)
- AR-Ansicht 1:1 (iOS Quick Look/USDZ, Android Scene Viewer/WebXR, nur über https); am Desktop per QR-Code aufs Handy

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktion -> dist/
```

Vercel: Framework „Vite“, Build `npm run build`, Output `dist`.

Qualität erzwingen: `?q=high|mobile`, AO aus: `?noao`, Debug: `?debug`, adaptive Qualität aus: `?fixed`.
