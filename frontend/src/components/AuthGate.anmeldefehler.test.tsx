// Der Anmeldefehler, geprueft am gerenderten Formular statt an der Funktion.
//
// Warum (Issue #72): `authErrorMessage` ist seit Fund 1 als reine Funktion
// geprueft — aber die VERDRAHTUNG nicht. Die Mutation
// `setError(authErrorMessage(err, t))` → `setError("")` blieb gruen: Die
// Funktion war weiterhin korrekt, sie wurde nur nicht mehr angezeigt. Ein
// Nutzer haette nach einem Fehlversuch ein stummes Formular gesehen.
//
// Diese Tests loesen den Fehlversuch aus und lesen, was im Formular STEHT.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import AuthGate from "./AuthGate";
import { LanguageProvider, translations, type Lang } from "../i18n";

import { SPEICHER_SCHLUESSEL } from "../test-konstanten";

// Erfunden, und bewusst als solches erkennbar: Das Repo ist oeffentlich, und
// hier wird nichts authentifiziert — `api.auth` ist vollstaendig ersetzt.
const ERFUNDENER_EINGABEWERT = "nicht-echt-nur-fixture";

const { statusMock, loginMock, ApiErrorKlasse } = vi.hoisted(() => {
  class ApiErrorKlasse extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  }
  return { statusMock: vi.fn(), loginMock: vi.fn(), ApiErrorKlasse };
});

vi.mock("../api/client", () => ({
  ApiError: ApiErrorKlasse,
  api: { auth: { status: statusMock, login: loginMock } },
}));

/** Zeichnet das Gate mit AUSDRUECKLICH gesetzter Sprache.
 *
 *  Ohne gespeicherten Wert faellt die App auf die Browsersprache zurueck, und
 *  die ist in dieser Testumgebung `en-US` (gemessen). Ein Test, der dann
 *  "die deutsche Meldung" erwartet, prueft die falsche Sprache — und einer,
 *  der die englische erwartet, ist gruen, ohne dass die Uebersetzung je
 *  gewirkt haette. */
function zeichne(sprache: Lang) {
  localStorage.setItem(SPEICHER_SCHLUESSEL, sprache);
  return render(
    <LanguageProvider>
      <AuthGate>
        <div>geheimer Inhalt</div>
      </AuthGate>
    </LanguageProvider>
  );
}

/** Meldet sich an und laesst den Versuch mit `fehler` scheitern. */
async function fehlversuch(fehler: unknown, sprache: Lang) {
  loginMock.mockRejectedValueOnce(fehler);
  const feld = await screen.findByPlaceholderText(translations.auth_token_ph[sprache] as string);
  fireEvent.change(feld, { target: { value: ERFUNDENER_EINGABEWERT } });
  fireEvent.submit(feld.closest("form")!);
}

beforeEach(() => {
  // Kein localStorage.clear() hier — das besorgt src/test-setup.ts als
  // einziger Eigentuemer.
  statusMock.mockReset();
  loginMock.mockReset();
  // Nicht angemeldet: Der Statusruf beim Einhaengen scheitert, das Formular
  // erscheint.
  statusMock.mockRejectedValue(new ApiErrorKlasse(401, "Unauthorized"));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Anmeldefehler — Verdrahtung", () => {
  it("zeigt die uebersetzte Meldung im Formular, nicht den englischen Rohtext", async () => {
    zeichne("de");
    await fehlversuch(new ApiErrorKlasse(401, "Invalid token"), "de");

    const erwartet = translations.auth_error_invalid.de as string;
    await waitFor(() => expect(screen.getByText(erwartet)).toBeTruthy());
    // Und der Rohtext des Servers taucht NICHT auf. Das ist die eigentliche
    // Zusage: Ein englischer Satz auf einem deutschen Bildschirm war der
    // Ausgangsbefund.
    expect(screen.queryByText("Invalid token")).toBeNull();
  });

  it("unterscheidet die Statuscodes, statt alles auf eine Meldung zu werfen", async () => {
    zeichne("de");
    await fehlversuch(new ApiErrorKlasse(429, "Too many login attempts"), "de");

    const gedrosselt = translations.auth_error_rate_limited.de as string;
    const ungueltig = translations.auth_error_invalid.de as string;
    await waitFor(() => expect(screen.getByText(gedrosselt)).toBeTruthy());
    expect(screen.queryByText(ungueltig)).toBeNull();
  });

  it("faellt bei einem Netzfehler auf die allgemeine Meldung zurueck, nicht auf Englisch", async () => {
    zeichne("de");
    await fehlversuch(new Error("Failed to fetch"), "de");

    const allgemein = translations.auth_error_generic.de as string;
    await waitFor(() => expect(screen.getByText(allgemein)).toBeTruthy());
    expect(screen.queryByText("Failed to fetch")).toBeNull();
  });

  it("zeigt die Meldung in JEDER Sprache uebersetzt", async () => {
    // Die Zusage lautet "der Anmeldebildschirm ist mehrsprachig" — also wird
    // sie abgezaehlt, nicht an einer Sprache belegt. Das Fenster wechselt die
    // Sprache ueber den Speicher, weil der Umschalter hinter dem Gate liegt.
    const sprachen = Object.keys(translations.auth_error_invalid) as Lang[];
    expect(sprachen.length).toBeGreaterThanOrEqual(4);

    for (const l of sprachen) {
      const { unmount } = zeichne(l);
      await fehlversuch(new ApiErrorKlasse(401, "Invalid token"), l);

      const erwartet = translations.auth_error_invalid[l] as string;
      await waitFor(() => expect(screen.getByText(erwartet)).toBeTruthy());
      unmount();
      localStorage.removeItem(SPEICHER_SCHLUESSEL);
    }
  });
});
