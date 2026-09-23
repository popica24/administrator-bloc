// [A9] Mesajele Auth, pe romaneste: administratorul nu are ce face cu
// "Database error creating new user".
import { assertEquals } from "jsr:@std/assert@1";
import { traduceAuth } from "../_shared/mesaje.js";

Deno.test("traduceAuth: mesajele stiute ajung pe romaneste", () => {
  const perechi: [string, string][] = [
    ["A user with this email address has already been registered", "Exista deja un cont cu acest numar de telefon."],
    ["Password should be at least 10 characters", "Parola este prea scurta pentru regulile serverului."],
    ["Too many requests", "Prea multe incercari intr-un timp scurt. Asteapta cateva minute si incearca din nou."],
    ["Unable to validate email address: invalid format", "Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx."],
    ["Signups not allowed for this instance", "Conturile se fac numai din aplicatie, de catre administrator."],
  ];
  for (const [engleza, romana] of perechi) {
    assertEquals(traduceAuth(engleza), romana, engleza);
  }
});

Deno.test("traduceAuth: ce nu stim sa traducem spune totusi ce se poate face", () => {
  const generic = "Contul nu a putut fi facut acum. Incearca din nou peste cateva minute.";
  assertEquals(traduceAuth("Database error creating new user"), generic);
  assertEquals(traduceAuth(null as unknown as string), generic);
  assertEquals(traduceAuth(undefined as unknown as string), generic);
});
