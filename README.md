# Gewächshaus 3D

Parametrischer 3D-Konfigurator (three.js + Vite) für ein Tonnengewächshaus:
3 m breit, 2 m hoch, Länge 4 / 6 / 8 / 10 m (Module à 2 m).

- Tür und Lüftungsfenster zum Öffnen (Klick)
- Hohlkammerplatten, verzinktes Bogenprofil, Schrauben/Scharniere
- Export als GLB und AR-Ansicht (iOS Quick Look / Android Scene Viewer / WebXR, nur über https)

```bash
npm install
npm run dev     # Entwicklung
npm run build   # Produktion -> dist/
```

Vercel: Framework „Vite“, Build `npm run build`, Output `dist`.
