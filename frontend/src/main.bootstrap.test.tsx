// Der Bootstrap-Aufruf in main.tsx, geprueft an seiner REIHENFOLGE.
//
// Warum (Issue #72, Runde 3): `applyDocumentLang(readStoredLang())` liess sich
// ersatzlos loeschen — alle Tests blieben gruen. Die Funktion war weiterhin
// geprueft, ihr Aufruf VOR dem ersten Rendern nicht. Genau darauf kommt es
// aber an: `index.html` liefert hartkodiert `lang="de"` aus, und wer das
// Attribut liest, bevor React committet (Vorleseprogramm, die
// Uebersetzungs-Nachfrage des Browsers), bekaeme fuer jeden nicht-deutschen
// Besucher die falsche Sprache.
//
// Ein Test, der `applyDocumentLang` direkt aufruft, kann das nicht zeigen —
// er prueft, dass die Funktion existiert. Dieser hier faengt den Moment ab,
// in dem `render` aufgerufen wird, und liest das Attribut GENAU DANN.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { SPEICHER_SCHLUESSEL } from "./test-konstanten";

/** Was `document.documentElement.lang` im Augenblick des `render`-Aufrufs
 *  trug. `null`, solange nicht gerendert wurde. */
let langBeimRendern: string | null = null;

const renderMock = vi.fn(() => {
  langBeimRendern = document.documentElement.lang;
});

vi.mock("react-dom/client", () => ({
  default: { createRoot: () => ({ render: renderMock, unmount: () => {} }) },
  createRoot: () => ({ render: renderMock, unmount: () => {} }),
}));

// Das Netz gehoert nicht zum Pruefgegenstand; main.tsx zieht ueber App und
// AuthGate den API-Client mit herein. Alle Werte erfunden.
vi.mock("./api/client", async () => {
  const echt = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...echt,
    api: {
      auth: { status: async () => ({ ok: true }), login: async () => ({ ok: true }) },
      accounts: { list: async () => [], status: async () => ({ ok: true }) },
      people: { list: async () => [] },
      matches: { list: async () => [] },
      albums: { managed: async () => [] },
      log: { list: async () => [] },
      health: async () => ({ status: "ok", version: "0.0.0-test" }),
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  renderMock.mockClear();
  langBeimRendern = null;
  localStorage.clear();
  // index.html liefert hartkodiert `lang="de"` aus — die Ausgangslage wird
  // nachgestellt, nicht weggelassen. Sonst waere ein leeres Attribut nach dem
  // Bootstrap nicht von einem korrigierten zu unterscheiden.
  document.documentElement.lang = "de";
  document.body.innerHTML = '<div id="root"></div>';
});

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.removeAttribute("lang");
});

describe("Bootstrap — Reihenfolge", () => {
  it("setzt die gespeicherte Sprache VOR dem ersten Rendern", async () => {
    localStorage.setItem(SPEICHER_SCHLUESSEL, "pt-BR");

    await import("./main");

    expect(renderMock).toHaveBeenCalledTimes(1);
    // Der Kern: nicht "irgendwann danach steht pt-BR da", sondern "im
    // Augenblick des Renderns stand es schon da".
    expect(langBeimRendern).toBe("pt-BR");
  });

  it("korrigiert das hartkodierte de aus index.html auch fuer Spanisch", async () => {
    // Zweite Sprache, damit der Test nicht zufaellig gruen ist, weil ein
    // Vorgabewert getroffen wurde.
    localStorage.setItem(SPEICHER_SCHLUESSEL, "es-ES");

    await import("./main");

    expect(langBeimRendern).toBe("es-ES");
  });

  it("setzt auch dann, wenn das Dokument schon eine ANDERE Sprache traegt", async () => {
    // Die erste Fassung dieses Tests stellte "de" ein, erwartete "de" — und
    // verglich damit denselben Wert in beiden Zustaenden. Er konnte nicht rot
    // werden, egal was der Bootstrap tut (Fund der blinden Panel-Stimme).
    //
    // Jetzt traegt das Dokument vorher "en". Wer den Bootstrap entfernt,
    // bekommt "en" statt "de" — und der Test faellt.
    document.documentElement.lang = "en";
    localStorage.setItem(SPEICHER_SCHLUESSEL, "de");

    await import("./main");

    expect(langBeimRendern).toBe("de");
  });
});
