// Der Sprachumschalter, geprueft an der VERDRAHTUNG statt an den Einzelteilen.
//
// Warum es diese Datei gibt (Issue #72): Ueber drei Panel-Runden hinweg
// ueberlebten Mutationen, die einen echten Nutzen ersatzlos entfernten — das
// komplette `useEffect` fuer `<html lang>`, `setLangState(l)`, das Schreiben
// in den Speicher. Alle Tests blieben gruen, weil `renderToString` ein
// ZUSTANDSLOSER Renderer ist: keine Effekte, kein lebender Zustand nach dem
// Rendern. Wir konnten pruefen, was eine Funktion zurueckgibt, aber nicht,
// was passiert, wenn jemand klickt.
//
// Diese Tests klicken. Die Zusage lautet: Ein Klick aendert die angezeigten
// Texte, den gespeicherten Wert und `<html lang>` GLEICHZEITIG — nicht, dass
// `setLang` existiert.
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import App from "./App";
import { LanguageProvider, LANG_LABELS, type Lang } from "./i18n";

import { SPEICHER_SCHLUESSEL } from "./test-konstanten";

// Das Netz gehoert nicht zum Pruefgegenstand. Alle Werte erfunden — das Repo
// ist oeffentlich, und Personennamen aus der Gesichtserkennung haben hier
// nichts zu suchen.
vi.mock("./api/client", async () => {
  const echt = await vi.importActual<typeof import("./api/client")>("./api/client");
  return {
    ...echt,
    api: {
      accounts: {
        list: async () => [],
        status: async () => ({ ok: true, api_key_configured: true }),
      },
      people: { list: async () => [] },
      matches: { list: async () => [] },
      albums: { managed: async () => [] },
      log: { list: async () => [] },
      health: async () => ({ status: "ok", version: "0.0.0-test" }),
    },
  };
});

/** Zeichnet die App mit AUSDRUECKLICH gesetzter Startsprache.
 *
 *  Warum nicht einfach rendern: Ohne gespeicherten Wert faellt die App auf
 *  die Browsersprache zurueck, und die ist in dieser Testumgebung `en-US`
 *  (gemessen). Ein Test, der dann "auf Englisch umschaltet", schaltet von
 *  Englisch auf Englisch — er ist gruen, ohne etwas zu beweisen. Genau die
 *  Klasse, wegen der es diese Datei gibt. */
function zeichne(startSprache: Lang) {
  localStorage.setItem(SPEICHER_SCHLUESSEL, startSprache);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </QueryClientProvider>
  );
}

/** Der Knopf einer Sprache, gesucht ueber sein sichtbares Etikett — also
 *  ueber das, was der Nutzer sieht, nicht ueber eine Testkennung. */
function sprachKnopf(l: Lang) {
  return screen.getByRole("button", { name: LANG_LABELS[l] });
}

describe("Sprachumschalter — Verdrahtung", () => {
  it("rendert JEDEN Knopf aus LANG_LABELS, nicht eine feste Auswahl", () => {
    zeichne("de");
    const sprachen = Object.keys(LANG_LABELS) as Lang[];
    // Der vierte Knopf war bisher NIE geprueft: Er liegt hinter dem
    // Anmelde-Gate, und der Agent tippt kein Geheimnis (auch nicht auf einem
    // Teststand). Hier entfaellt das Gate, weil App ohne AuthGate gerendert
    // wird — der blinde Fleck schliesst sich, ohne dass ein Geheimnis noetig
    // waere.
    expect(sprachen.length).toBeGreaterThanOrEqual(4);
    for (const l of sprachen) {
      expect(sprachKnopf(l)).toBeTruthy();
    }
  });

  it("ein Klick aendert Anzeige, Speicher und <html lang> gleichzeitig", () => {
    zeichne("de");

    // Ausgangslage BELEGEN, nicht annehmen: Der deutsche Text muss vorher da
    // sein und nachher weg. Ohne diese Haelfte beweist der Vergleich danach
    // nichts.
    //
    // Und die Beschriftung ist mit Bedacht gewaehlt: `nav_accounts` heisst in
    // beiden Sprachen "Accounts" (i18n.tsx:133) und taugt deshalb NICHT als
    // Beleg. `nav_people` unterscheidet sich — Personen / People.
    expect(screen.getByRole("button", { name: "Personen" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "People" })).toBeNull();

    fireEvent.click(sprachKnopf("en"));

    // 1. Anzeige: die Navigation traegt jetzt die englischen Beschriftungen.
    expect(screen.getByRole("button", { name: "People" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Personen" })).toBeNull();
    // 2. Speicher.
    expect(localStorage.getItem(SPEICHER_SCHLUESSEL)).toBe("en");
    // 3. Dokument-Attribut.
    expect(document.documentElement.lang).toBe("en");
  });

  it("markiert die aktive Sprache fuer Hilfsmittel, nicht nur farblich", () => {
    zeichne("de");
    fireEvent.click(sprachKnopf("es-ES"));
    expect(sprachKnopf("es-ES").getAttribute("aria-current")).toBe("true");
    expect(sprachKnopf("de").getAttribute("aria-current")).toBeNull();
  });

  it("uebersteht einen Wechsel hin und zurueck", () => {
    // Der einfache Test uebersieht eine Klasse: eine Umschaltung, die beim
    // ERSTEN Mal wirkt und danach haengenbleibt. Deshalb zweimal.
    zeichne("de");
    fireEvent.click(sprachKnopf("pt-BR"));
    expect(localStorage.getItem(SPEICHER_SCHLUESSEL)).toBe("pt-BR");
    expect(document.documentElement.lang).toBe("pt-BR");

    fireEvent.click(sprachKnopf("de"));
    expect(localStorage.getItem(SPEICHER_SCHLUESSEL)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
  });
});
