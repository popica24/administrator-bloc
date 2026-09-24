/* Numarul de telefon este identitatea contului: omul il tasteaza cum stie el,
   iar aplicatia trebuie sa recunoasca acelasi om de fiecare data. */
import { describe, it, expect } from "vitest";
import { normalizeazaTelefon, adresaContului, telefonAfisat } from "../../supabase/functions/_shared/telefon.js";

describe("normalizeazaTelefon", () => {
  it("acelasi numar scris in feluri diferite da acelasi rezultat", () => {
    /* [A6] "+40 0722 ..." este felul in care multi isi scriu numarul in
       agenda: prefixul tarii si zeroul de la inceput, unul dupa altul. */
    for (const scris of ["0722123456", "0722 123 456", "0722.123.456", "0722-123-456", " 0722 123456 ", "+40722123456", "+40 722 123 456", "0040722123456", "40722123456", "+40 0722 123 456", "0040 0722 123 456", "(0722) 123-456"]) {
      expect(normalizeazaTelefon(scris), scris).toBe("0722123456");
    }
  });

  it("accepta si numerele fixe, nu doar mobilele", () => {
    expect(normalizeazaTelefon("0248 210 118")).toBe("0248210118");
    expect(normalizeazaTelefon("+40248210118")).toBe("0248210118");
  });

  it("refuza ce nu e numar de telefon romanesc", () => {
    for (const gresit of ["", " ", null, undefined, "07221234", "07221234567", "1722123456", "0522123456", "0722 12a 456", "elena@adminbloc.test", "+33722123456"]) {
      expect(normalizeazaTelefon(gresit), String(gresit)).toBeNull();
    }
  });
});

describe("adresaContului", () => {
  /* Supabase Auth cere un identificator de tip adresa; numarul nu poate fi
     folosit direct fara un furnizor de SMS. Adresa se face din numar, este
     interna si omul nu o vede niciodata. */
  it("face o adresa interna din numar, oricum ar fi scris numarul", () => {
    expect(adresaContului("0722 123 456")).toBe("0722123456@telefon.adminbloc.invalid");
    expect(adresaContului("+40722123456")).toBe("0722123456@telefon.adminbloc.invalid");
  });

  it("un numar gresit nu are adresa", () => {
    expect(adresaContului("abc")).toBeNull();
  });
});

describe("telefonAfisat", () => {
  it("scrie numarul in grupuri, ca pe hartie", () => {
    expect(telefonAfisat("0722123456")).toBe("0722 123 456");
    expect(telefonAfisat("+40722123456")).toBe("0722 123 456");
  });

  it("ce nu e numar ramane cum a fost scris", () => {
    expect(telefonAfisat("nu stiu")).toBe("nu stiu");
    expect(telefonAfisat(null)).toBe("");
  });
});
