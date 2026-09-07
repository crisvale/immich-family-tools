/** Werte, die mehrere Testdateien teilen.
 *
 *  Warum der Speicherschluessel hier WOERTLICH steht und nicht aus `i18n.tsx`
 *  importiert wird: Ein Test, der die Konstante seines Pruefgegenstands
 *  benutzt, bleibt gruen, wenn jemand sie umbenennt — und genau das waere ein
 *  Bruch fuer jeden Nutzer, dessen gespeicherte Sprache danach nicht mehr
 *  gefunden wird. Gemessen: Benennt man die beiden Produktstellen auf
 *  `ift_language` um, fallen 9 von 11 Tests.
 *
 *  Warum er trotzdem nur EINMAL dasteht: Die erste Fassung wiederholte ihn in
 *  drei Testdateien. Die GPT-Panel-Stimme hat das als vierte und fuenfte
 *  driftende Stelle gezaehlt — der Vertrag braucht eine Verankerung, nicht
 *  drei. Eine Kopie faengt die Umbenennung genauso wie drei. */
export const SPEICHER_SCHLUESSEL = "ift_lang";
