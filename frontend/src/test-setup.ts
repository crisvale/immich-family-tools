// Aufraeumen zwischen den Tests — und zwar nur das, was nachweislich traegt.
//
// GESCHICHTE DIESER DATEI, weil sie zweimal zu viel behauptet hat:
//
// Fassung 1 raeumte auf UND die Testdateien raeumten selbst auf UND
// `globals: true` schaltete die automatische Aufraeumroutine der
// Testbibliothek ein. Drei Mechanismen fuer eine Aufgabe: Man konnte jede
// Zeile hier loeschen, ohne dass ein Test rot wurde. Die blinde Panel-Stimme
// hat das gemessen — ein Waechter, der nichts bewacht (lehren.md Paragraph 18).
//
// Fassung 2 machte diese Datei zur einzigen Eigentuemerin und behauptete,
// jede ihrer Zeilen sei rot-beweisbar. Der Mutationslauf hat das widerlegt:
// `cleanup()` wird gefangen, `localStorage.clear()` und das Zuruecksetzen von
// `<html lang>` NICHT. Sie sind redundant, weil jeder Test seinen
// Ausgangszustand selbst setzt — was seit dem en-US-Fund Absicht ist.
//
// Fassung 3, diese: Nur `cleanup()` bleibt, weil nur es beweisbar wirkt.
// Wer einen Test schreibt, der auf einen Umgebungszustand angewiesen ist,
// setzt ihn selbst — und sieht das an dieser Datei, statt sich auf eine
// stille Vorbedingung zu verlassen.
//
// Rot-Beweis (Kommando: python mut-nach.py, Stand caed5e1): `cleanup()`
// entfernt -> App.sprachumschalter und AuthGate.anmeldefehler fallen;
// die ganze `setupFiles`-Zeile entfernt -> dieselben zwei fallen.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
