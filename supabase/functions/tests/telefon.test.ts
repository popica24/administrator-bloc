// Numarul de telefon, identitatea contului: aceleasi reguli in aplicatie
// (tests/unit/telefon.test.js) si in Edge Functions.
import { assertEquals } from "jsr:@std/assert@1";
import { adresaContului, normalizeazaTelefon, telefonAfisat } from "../_shared/telefon.js";

Deno.test("telefon: acelasi numar, scris in feluri diferite", () => {
  for (const scris of ["0722123456", "0722 123 456", "0722.123.456", "0722-123-456", "(0722)123456", "+40722123456", "0040722123456", "40722123456"]) {
    assertEquals(normalizeazaTelefon(scris), "0722123456", scris);
  }
  assertEquals(normalizeazaTelefon("0248 210 118"), "0248210118");
  assertEquals(normalizeazaTelefon("0312 100 200"), "0312100200");
});

Deno.test("telefon: ce nu e numar romanesc este refuzat", () => {
  for (const gresit of ["", "07221234", "07221234567", "0522123456", "1722123456", "+33722123456", "4072212345", "elena@adminbloc.test", null, undefined]) {
    assertEquals(normalizeazaTelefon(gresit as string), null, String(gresit));
  }
});

Deno.test("telefon: adresa interna a contului se face din numar", () => {
  assertEquals(adresaContului("0722 123 456"), "0722123456@telefon.adminbloc.ro");
  assertEquals(adresaContului("nu e numar"), null);
});

Deno.test("telefon: numarul se scrie in grupuri pentru om", () => {
  assertEquals(telefonAfisat("+40722123456"), "0722 123 456");
  assertEquals(telefonAfisat("altceva"), "altceva");
  assertEquals(telefonAfisat(null as unknown as string), "");
});
