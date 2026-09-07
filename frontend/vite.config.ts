import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  server: {
    // NUR IM TESTLAUF die Repo-Wurzel freigeben, nicht im Entwicklungsserver.
    //
    // Anlass: Der README-Waechter in src/i18n.test.ts liest ../../README.md
    // ueber Vites ?raw-Import (Begruendung dort: das Projekt fuehrt bewusst
    // kein @types/node). Sobald eine `test`-Konfiguration existiert, greift
    // Vites Dateisperre und verweigert alles ausserhalb von frontend/ — der
    // Test scheitert mit "Denied ID .../README.md?raw", also an der
    // Aufloesung, nicht an der Sache.
    //
    // Die erste Fassung stellte `allow: [".."]` unbedingt hierher. Das war ein
    // FUND der blinden Panel-Stimme, gemessen am laufenden `npm run dev`:
    // Damit lieferte der Entwicklungsserver auch `accounts.json` aus — die
    // Datei, die .gitignore:19 als Geheimnis fuehrt — mit HTTP 200 statt 403.
    // Vites eingebautes fs.deny schuetzt nur `.env`, nicht unsere Ablage.
    //
    // Eine engere Freigabe reicht nicht: `allow: [".", "../README.md"]` wird
    // trotzdem abgelehnt, weil die ?raw-Anfrage nicht auf den blossen
    // Dateipfad passt (gemessen). Also die Weite behalten, aber an den
    // Testlauf binden — vitest setzt `mode` auf "test".
    ...(mode === "test" ? { fs: { allow: [".."] } } : {}),
    proxy: {
      "/api": {
        target: "http://localhost:3100",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    // happy-dom statt jsdom: gemessen +9 statt +37 Pakete im Baum
    // (`npm install --no-save --dry-run`, mit Netz). Das Repo haelt
    // Abhaengigkeiten knapp, und die Lieferketten-Flaeche war der
    // Haupteinwand in Issue #72 gegen einen DOM-Renderer ueberhaupt.
    //
    // GRENZE DIESER BEGRUENDUNG, von der GPT-Panel-Stimme benannt: Die
    // Paketzahl misst die Lieferkette, NICHT die DOM-Treue. Ob eine dieser
    // Testdateien unter jsdom anders liefe, ist hier nicht geprueft — jsdom
    // ist nicht installiert. Die Wahl ist also eine Abwaegung mit einer
    // gemessenen und einer ungemessenen Seite, kein Befund. Wer auf jsdom
    // wechseln will, braucht eine Zeile hier und eine Abhaengigkeit.
    environment: "happy-dom",
    // Kein `globals: true`: Alle sieben Testdateien importieren describe/it
    // ausdruecklich aus "vitest", brauchen es also nicht — und der Schalter
    // haette eine Nebenwirkung, die genau das Gegenteil dessen bewirkt, was
    // hier steht: Er aktiviert die automatische Aufraeumroutine von
    // @testing-library/react. Solange die laeuft, ist unsere eigene
    // wirkungslos und damit UNBEWEISBAR — man kann sie loeschen, ohne dass
    // ein Test rot wird. Genau so stand es hier, und genau das hat die blinde
    // Panel-Stimme gemessen.
    //
    // Jetzt ist test-setup.ts der einzige Eigentuemer des Aufraeumens, und
    // jede seiner drei Zeilen ist einzeln rot-beweisbar.
    setupFiles: ["./src/test-setup.ts"],
  },
}));
