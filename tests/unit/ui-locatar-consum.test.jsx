/* Ecranul Contoare al locatarului (LocatarConsum): transmiterea indexului cu
   poza, corectarea, starile citirii (StareCitireBadge), graficul de consum,
   istoricul si explicatia diferentei de apa. */
import { describe, it, expect, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { pornesteApp, sursaDemo, ceasDemo, zonaCu, textEcran, ajutorulCampului, ADMIN } from "./ajutor.jsx";
import {
  ELENA, VOICU, apasaButon, alegeSegment, deschideTab, scrie, alegeFisier, fisierPoza, urlFalse, amanat, text,
} from "./ui-locatar-ajutor.jsx";

vi.mock("../../src/sursa.js", () => ({ creeazaSursa: () => globalThis.sursaTest }));

const RECE = "Apa rece, index anterior 244,5";
const CALDA = "Apa calda, index anterior 133,7";
const ecran = () => textEcran();
/* Indiciul sau eroarea campului, luate din legatura aria-describedby */
const campul = (eticheta) => ({ textContent: ajutorulCampului(eticheta) });

async function laContoare(optiuni) {
  urlFalse();
  const r = await pornesteApp(optiuni);
  await deschideTab("Contoare");
  return r;
}

/* O citire pe septembrie pentru contorul de un anumit tip al apartamentului */
const citireSept = (d, tip, extra) => {
  const c = d.contoare.find((x) => x.tip === tip);
  return { id: `cit-${tip}-${extra.stare}-${extra.id || ""}`, contorId: c.id, apartamentId: c.apartamentId, tip, luna: "2026-09", indexAnterior: tip === "rece" ? 244.5 : 133.72, indexCurent: tip === "rece" ? 250 : 140, consum: tip === "rece" ? 5.5 : 6.28, sursa: "locatar", pozaCale: null, motivRespingere: null, transmisaLa: "2026-09-17T10:00:00+03:00", ...extra };
};

/* [R5] Un apartament fara niciun contor primea tot formularul de citire
   (badge de termen, cerere de poza, "Trimite indexul"), fara niciun camp de
   index de completat: apasarea butonului raspundea doar "Scrie cel putin un
   index", fara nicio explicatie ca apartamentul nu are contoare. */
describe("[R5] Contoare: apartament fara niciun contor", () => {
  it("arata plain ca apartamentul nu are contoare, nu formularul gol", async () => {
    await laContoare({ email: ELENA, modifica: (d) => { d.contoare = d.contoare.filter((c) => c.apartamentId !== d.eu.apartamentId); } });
    expect(screen.getByText("Apartamentul tau nu are niciun contor de apa")).toBeTruthy();
    expect(screen.queryByText("Citirea pentru septembrie")).toBeNull();
    expect(screen.queryByRole("button", { name: "Trimite indexul" })).toBeNull();
    expect(screen.queryByText(/Termen/)).toBeNull();
    expect(screen.queryByText("Fotografiaza contoarele")).toBeNull();
  });
});

describe("Contoare: formularul de citire", () => {
  it("arata termenul, contoarele cu indexul anterior si seria", async () => {
    await laContoare({ email: ELENA });
    expect(screen.getByText("Termen 25 sep 2026")).toBeTruthy();
    expect(screen.getByText("Citirea pentru septembrie")).toBeTruthy();
    expect(text(campul(RECE))).toContain("Contor R-D14-17, baie");
    expect(text(campul(CALDA))).toContain("Contor C-D14-17, baie");
    expect(screen.getByLabelText(RECE).getAttribute("placeholder")).toBe("244,5");
    expect(screen.getByRole("button", { name: "Trimite indexul" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.queryByText("Mai adauga poza contoarelor, apoi poti trimite.")).toBeNull();
  });

  it("valideaza indexul: mai mic decat anteriorul, consum foarte mare, consum normal", async () => {
    await laContoare({ email: ELENA });
    scrie(RECE, "200");
    expect(text(campul(RECE))).toContain("Indexul nou nu poate fi mai mic decat cel anterior. Verifica cifrele.");
    scrie(RECE, "320");
    expect(text(campul(RECE))).toContain("Consumul pare foarte mare. Verifica inca o data cifrele.");
    scrie(RECE, "250");
    expect(text(campul(RECE))).toContain("Consum calculat: 5,50 mc");
    scrie(CALDA, "140,2");
    expect(text(campul(CALDA))).toContain("Consum calculat: 6,48 mc");
    /* fara poza nu se poate trimite */
    expect(screen.getByText("Mai adauga poza contoarelor, apoi poti trimite.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Trimite indexul" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("un text care nu e numar nu permite trimiterea", async () => {
    await laContoare({ email: ELENA });
    await alegeFisier("Fotografiaza contoarele");
    scrie(RECE, "abc");
    scrie(CALDA, "140");
    expect(screen.getByRole("button", { name: "Trimite indexul" }).getAttribute("aria-disabled")).toBe("true");
  });

  it("[NOU-1] un index care nu e numar arata mesajul Scrie doar cifre", async () => {
    await laContoare({ email: ELENA });
    scrie(RECE, "abc");
    expect(text(campul(RECE))).toContain("Scrie doar cifre.");
  });

  it("trimite indexul cu poza, apoi arata starea Trimis si permite corectarea", async () => {
    const { sursa } = await laContoare({ email: ELENA });
    const spion = vi.spyOn(sursa, "transmiteCitire");
    const d = await sursa.incarca();
    scrie(RECE, "250");
    scrie(CALDA, "140");
    await alegeFisier("Fotografiaza contoarele", fisierPoza("prima.jpg"));
    expect(screen.getByAltText("Poza contoarelor").getAttribute("src")).toMatch(/^blob:test-/);
    await alegeFisier("Alta poza", fisierPoza("a-doua.jpg"));
    expect(screen.queryByText("Mai adauga poza contoarelor, apoi poti trimite.")).toBeNull();
    await apasaButon("Trimite indexul");
    const rece = d.contoare.find((c) => c.tip === "rece");
    const calda = d.contoare.find((c) => c.tip === "calda");
    expect(spion).toHaveBeenCalledTimes(1);
    const arg = spion.mock.calls[0][0];
    expect(arg).toMatchObject({ apartamentId: d.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: 250 }, { contorId: calda.id, index: 140 }] });
    expect(arg.poza.name).toBe("a-doua.jpg");
    expect(screen.getByRole("status").textContent).toBe("Indexul a fost trimis administratorului");

    expect(screen.getByText("Trimis")).toBeTruthy();
    expect(screen.getByText("Indexul pe septembrie a ajuns la administrator")).toBeTruthy();
    expect(ecran()).toContain("Apa rece250,0, consum 5,50 mc");
    expect(ecran()).toContain("Apa calda140,0, consum 6,28 mc");
    expect(ecran()).toContain("Il poti corecta pana pe 25 septembrie 2026. Dupa validare intra in lista de plata pe septembrie.");
    expect(screen.queryByText("Citirea pentru septembrie")).toBeNull();

    /* corectarea: formularul revine gol, cu "Renunta" */
    await apasaButon("Corecteaza indexul");
    expect(screen.getByText("Citirea pentru septembrie")).toBeTruthy();
    expect(screen.getByLabelText(RECE).value).toBe("");
    await apasaButon("Renunta la corectare");
    expect(screen.queryByText("Citirea pentru septembrie")).toBeNull();

    await apasaButon("Corecteaza indexul");
    scrie(RECE, "251");
    scrie(CALDA, "141");
    await alegeFisier("Fotografiaza contoarele");
    await apasaButon("Trimite indexul");
    expect(spion).toHaveBeenCalledTimes(2);
    expect(ecran()).toContain("Apa rece251,0, consum 6,50 mc");
    expect(screen.queryByRole("button", { name: "Renunta la corectare" })).toBeNull();
  });

  it("o trimitere refuzata pastreaza cifrele si poza", async () => {
    const { sursa } = await laContoare({ email: ELENA });
    vi.spyOn(sursa, "transmiteCitire").mockRejectedValue(new Error("Doar luna curenta"));
    scrie(RECE, "250");
    scrie(CALDA, "140");
    await alegeFisier("Fotografiaza contoarele");
    await apasaButon("Trimite indexul");
    expect(screen.getByRole("status").textContent).toBe("Doar luna curenta");
    expect(screen.getByLabelText(RECE).value).toBe("250");
    expect(screen.getByAltText("Poza contoarelor")).toBeTruthy();
  });

  it("in timpul trimiterii butonul spune Se trimite", async () => {
    const { sursa } = await laContoare({ email: ELENA });
    const a = amanat();
    vi.spyOn(sursa, "transmiteCitire").mockImplementation(() => a.promisiune);
    scrie(RECE, "250");
    scrie(CALDA, "140");
    await alegeFisier("Fotografiaza contoarele");
    await apasaButon("Trimite indexul");
    expect(screen.getByRole("button", { name: "Se trimite..." }).getAttribute("aria-disabled")).toBe("true");
    await act(async () => { a.rezolva(); });
    expect(screen.queryByRole("button", { name: "Se trimite..." })).toBeNull();
  });

  it("dupa termen formularul spune Termen depasit", async () => {
    await laContoare({ email: ELENA, zi: new Date("2026-09-26T09:00:00") });
    expect(screen.getByText("Termen depasit")).toBeTruthy();
  });

  it("contoarele apar mereu cu apa rece prima, iar un contor fara amplasare arata doar seria", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.contoare.reverse();
        d.contoare.find((c) => c.tip === "calda").amplasare = null;
      },
    });
    const campuri = screen.getAllByLabelText(/index anterior/, { selector: "input" });
    expect(campuri.map((c) => c.getAttribute("aria-label"))).toEqual([RECE, CALDA]);
    expect(text(campul(CALDA))).toContain("Contor C-D14-17");
    expect(text(campul(CALDA))).not.toContain("C-D14-17,");
  });

  it("[NOU-2] un contor fara amplasare nu lasa o virgula la final in indiciu", async () => {
    await laContoare({ email: ELENA, modifica: (d) => { d.contoare.find((c) => c.tip === "calda").amplasare = null; } });
    expect(text(campul(CALDA))).toContain("Contor C-D14-17");
    expect(text(campul(CALDA))).not.toContain("C-D14-17,");
  });
});

describe("Contoare: starile citirii pe luna curenta", () => {
  it("citirea validata: Validat, fara corectare si fara formular", async () => {
    await laContoare({ email: VOICU });
    const card = zonaCu(["Indexul pe septembrie a fost verificat de administrator", "Validat"]);
    expect(within(card).getByText("Validat")).toBeTruthy();
    expect(text(card)).toContain("Apa rece192,6, consum 8,72 mc");
    expect(screen.queryByRole("button", { name: "Corecteaza indexul" })).toBeNull();
    expect(screen.queryByText("Citirea pentru septembrie")).toBeNull();
  });

  it("citirea trimisa dupa termen nu se mai poate corecta", async () => {
    await laContoare({
      email: ELENA,
      zi: new Date("2026-09-26T09:00:00"),
      modifica: (d) => { d.citiri.push(citireSept(d, "rece", { stare: "trimisa" }), citireSept(d, "calda", { stare: "trimisa" })); },
    });
    expect(screen.getByText("Indexul pe septembrie a ajuns la administrator")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Corecteaza indexul" })).toBeNull();
  });

  it("citirea respinsa: formularul arata motivul administratorului", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.citiri.push(citireSept(d, "rece", { stare: "respinsa", motivRespingere: "Poza este neclara, nu se vad cifrele negre." }), citireSept(d, "calda", { stare: "trimisa" }));
      },
    });
    const card = zonaCu(["Citirea trimisa a fost respinsa", "Poza este neclara"]);
    expect(text(card)).toContain("Poza este neclara, nu se vad cifrele negre.");
    expect(screen.getByText("Citirea pentru septembrie")).toBeTruthy();
    expect(screen.queryByText("Trimis")).toBeNull();
  });

  it("[A10] dupa doua respingeri arata motivul celei mai noi", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.citiri.push(
          citireSept(d, "rece", { stare: "respinsa", id: "1", motivRespingere: "Motivul vechi", transmisaLa: "2026-09-10T10:00:00+03:00" }),
          citireSept(d, "rece", { stare: "respinsa", id: "2", motivRespingere: "Motivul nou", transmisaLa: "2026-09-17T10:00:00+03:00" }),
        );
      },
    });
    expect(text(zonaCu(["Citirea trimisa a fost respinsa", "Motivul"]))).toContain("Motivul nou");
  });

  it("[A12] o citire de pornire din luna curenta nu blocheaza transmiterea indexului", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.citiri.push(citireSept(d, "rece", { stare: "validata", sursa: "pornire", indexAnterior: 250, indexCurent: 250, consum: 0 }), citireSept(d, "calda", { stare: "validata", sursa: "pornire", indexAnterior: 140, indexCurent: 140, consum: 0 }));
      },
    });
    expect(screen.getByText("Citirea pentru septembrie")).toBeTruthy();
  });

  it("[A1] cu apa rece validata si apa calda respinsa, locatarul poate retrimite apa calda", async () => {
    ceasDemo();
    const sursa = sursaDemo();
    await sursa.intra(ELENA, "Bloc-D14-2026");
    const d = await sursa.incarca();
    const rece = d.contoare.find((c) => c.tip === "rece");
    const calda = d.contoare.find((c) => c.tip === "calda");
    await sursa.transmiteCitire({ apartamentId: d.eu.apartamentId, luna: "2026-09", indexuri: [{ contorId: rece.id, index: 250 }, { contorId: calda.id, index: 140 }], poza: fisierPoza() });
    await sursa.intra(ADMIN, "Bloc-D14-2026");
    const da = await sursa.incarca();
    const cit = da.citiri.filter((c) => c.apartamentId === d.eu.apartamentId && c.luna === "2026-09");
    await sursa.valideazaCitire(cit.find((c) => c.tip === "rece").id, true);
    await sursa.valideazaCitire(cit.find((c) => c.tip === "calda").id, false, "Poza neclara");

    await laContoare({ email: ELENA, sursa });
    expect(text(zonaCu(["Citirea trimisa a fost respinsa", "Poza neclara"]))).toContain("Poza neclara");
    /* apa rece e deja validata: formularul cere doar apa calda */
    expect(screen.queryByLabelText("Apa rece, index anterior 244,5")).toBeNull();
    const trimite = vi.spyOn(sursa, "transmiteCitire");
    scrie(CALDA, "141");
    await alegeFisier("Fotografiaza contoarele");
    await apasaButon("Trimite indexul");
    expect(screen.getByRole("status").textContent).toBe("Indexul a fost trimis administratorului");
    expect(trimite.mock.calls[0][0].indexuri).toEqual([{ contorId: calda.id, index: 141 }]);
  });
});

describe("Contoare: indexul cu punct zecimal [R1]", () => {
  /* Regula de mii de la sume ("1.500" = 1500 lei) nu are voie sa ajunga la
     indexul contorului: acolo punctul este separator zecimal. */
  it("192.620 inseamna 192,62 mc, nu 192620", async () => {
    const { sursa } = await laContoare({ email: ELENA });
    const trimite = vi.spyOn(sursa, "transmiteCitire");
    scrie(RECE, "250.5");
    expect(text(campul(RECE))).toContain("Consum calculat: 6,00 mc");
    scrie(CALDA, "133.900");
    expect(text(campul(CALDA))).toContain("Consum calculat: 0,18 mc");
    await alegeFisier("Fotografiaza contoarele");
    await apasaButon("Trimite indexul");
    expect(trimite.mock.calls[0][0].indexuri).toEqual([
      { contorId: expect.any(String), index: 250.5 },
      { contorId: expect.any(String), index: 133.9 },
    ]);
  });
});

describe("Contoare: indexul real dupa o estimare [A2]", () => {
  /* august la apa rece devine o estimare prea mare: 260 fata de 244,5 real */
  const estimareAugust = (d, peste = {}) => {
    const rece = d.contoare.find((c) => c.tip === "rece");
    const aug = d.citiri.find((c) => c.contorId === rece.id && c.luna === "2026-08");
    Object.assign(aug, { sursa: "estimat", indexCurent: 260 }, peste);
    return rece;
  };
  const RECE_ESTIMAT = "Apa rece, index anterior 260,0";

  it("accepta un index sub estimare, dar nu sub ultima citire reala", async () => {
    await laContoare({ email: ELENA, modifica: (d) => { estimareAugust(d); } });
    scrie(RECE_ESTIMAT, "250");
    expect(text(campul(RECE_ESTIMAT))).toContain("Indexul este sub estimarea din luna trecuta (260,0). Pe luna aceasta nu se calculeaza consum la acest contor.");
    scrie(RECE_ESTIMAT, "100");
    expect(text(campul(RECE_ESTIMAT))).toContain("Indexul nou nu poate fi mai mic decat cel anterior. Verifica cifrele.");
  });

  it("fara nicio citire reala inainte, orice index pozitiv sub estimare este acceptat", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        const rece = estimareAugust(d);
        d.citiri.filter((c) => c.contorId === rece.id && c.luna < "2026-08").forEach((c) => { c.sursa = "estimat"; });
      },
    });
    scrie(RECE_ESTIMAT, "5");
    expect(text(campul(RECE_ESTIMAT))).toContain("Indexul este sub estimarea din luna trecuta");
  });
});

describe("Contoare: graficul de consum", () => {
  it("apa rece si apa calda, cu consumul pe persoana si media blocului", async () => {
    await laContoare({ email: ELENA });
    const card = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    expect(text(card)).toContain("aug 2614,68 mc · 4,89 pe pers., bloc 4,79");
    expect(text(card)).toContain("14,7aug 26");
    await alegeSegment("Apa calda");
    expect(text(card)).toContain("aug 269,02 mc · 3,01 pe pers., bloc 2,70");
  });

  /* [J10] pePers folosea ap.persoane (numarul de azi) pentru fiecare luna a
     istoricului, in timp ce media blocului de alaturi (date.consumMediu)
     vine deja calculata pe persoanele acelei luni. LocatarAcasa (linia
     ~1760) foloseste deja persoaneInLuna pentru randul curent; graficul
     Contoare trebuia sa faca la fel pentru fiecare rand din istoric. */
  it("[J10] persoanele s-au schimbat intre timp: august foloseste persoanele din august, nu cele de azi", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        const ap = d.apartamente.find((a) => a.id === d.eu.apartamentId);
        ap.persoane = 5; /* azi (septembrie): 5 persoane */
        ap.istoricPersoane = [
          { valabilDin: "2026-09", numar: 5 },
          { valabilDin: "2026-05", numar: 3 },
        ];
      },
    });
    const card = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    /* august a avut 3 persoane, nu 5: 14,68 / 3 = 4,89, ca in testul de mai sus */
    expect(text(card)).toContain("aug 2614,68 mc · 4,89 pe pers., bloc 4,79");
  });

  it("luna estimata, luna fara apa calda si luna fara medie", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.citiri.filter((c) => c.luna === "2026-08").forEach((c) => { c.sursa = "estimat"; });
        d.citiri = d.citiri.filter((c) => !(c.luna === "2026-07" && c.tip === "calda"));
        delete d.consumMediu["2026-06"];
      },
    });
    const card = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    expect(text(card)).toContain("aug 26 (estimat)14,68 mc");
    expect(text(card)).toMatch(/iun 26[\d,]+ mc(?! ·)/);
    await alegeSegment("Apa calda");
    expect(text(card)).toContain("iul 26-");
  });

  it("fara persoane si fara medie pe tipul de apa nu se afiseaza consumul pe persoana", async () => {
    await laContoare({
      email: ELENA,
      /* [J10] fara persoane in nicio luna a istoricului, nu doar azi
         (ap.persoane), ca sa acopere si lunile din grafic, nu doar randul
         curent. */
      modifica: (d) => {
        d.apartamente[0].persoane = 0;
        d.apartamente[0].istoricPersoane = [{ valabilDin: "2000-01", numar: 0 }];
        Object.values(d.consumMediu).forEach((m) => { m.calda = null; });
      },
    });
    const card = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    expect(text(card)).not.toContain("pe pers.");
  });

  it("media blocului fara apa calda: consumul pe persoana nu apare la apa calda", async () => {
    await laContoare({ email: ELENA, modifica: (d) => { Object.values(d.consumMediu).forEach((m) => { m.calda = null; }); } });
    const card = zonaCu(["Cum a evoluat consumul", "aug 26"]);
    expect(text(card)).toContain("pe pers.");
    await alegeSegment("Apa calda");
    expect(text(card)).not.toContain("pe pers.");
  });

  it("fara consum validat nu apare graficul si nici explicatia diferentei", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.citiri = d.citiri.filter((c) => c.sursa === "pornire");
        d.repartizari = d.repartizari.filter((r) => !r.detaliu || r.detaliu.tip !== "rece");
      },
    });
    expect(screen.queryByText("Cum a evoluat consumul")).toBeNull();
    expect(screen.queryByText("De ce plateste blocul mai multa apa decat arata contoarele")).toBeNull();
  });
});

describe("Contoare: istoricul si diferenta de apa", () => {
  it("istoricul pe luni, cu indexul de pornire si citirile validate", async () => {
    await laContoare({ email: ELENA });
    const luna = (eticheta) => text(zonaCu([eticheta, "Apa calda"], 3));
    expect(screen.getAllByText(/^(mai|iunie|iulie|august|septembrie) 2026$/)).toHaveLength(4);
    expect(luna("august 2026")).toContain("august 2026Apa rece229,8 → 244,514,68 mc consumatiValidatApa calda124,7 → 133,79,02 mc consumatiValidat");
    expect(luna("mai 2026")).toMatch(/^mai 2026Apa rece[\d,]+Index de pornireApa calda[\d,]+Index de pornire$/);
  });

  it("istoricul arata Netransmis, Estimat, Respins si Trimis", async () => {
    await laContoare({
      email: ELENA,
      modifica: (d) => {
        d.citiri = d.citiri.filter((c) => !(c.luna === "2026-07" && c.tip === "calda"));
        d.citiri.filter((c) => c.luna === "2026-07").forEach((c) => { c.sursa = "estimat"; });
        d.citiri.push(citireSept(d, "rece", { stare: "respinsa" }), citireSept(d, "calda", { stare: "trimisa" }));
      },
    });
    const luna = (eticheta) => text(zonaCu([eticheta, "Apa calda"], 3));
    expect(luna("septembrie 2026")).toContain("septembrie 2026Apa rece244,5 → 250,05,50 mc consumatiRespinsApa calda133,7 → 140,06,28 mc consumatiTrimis, in verificare");
    expect(luna("iulie 2026")).toMatch(/^iulie 2026Apa rece.*EstimatApa calda-Netransmis$/);
  });

  it("explica diferenta dintre contorul general si suma contoarelor pe ultima luna", async () => {
    await laContoare({ email: ELENA, modifica: (d) => { d.repartizari.reverse(); } });
    const t = text(zonaCu(["De ce plateste blocul mai multa apa decat arata contoarele", "tie iti revin"]));
    expect(t).toMatch(/In august contorul general de la subsol a inregistrat 428,0 mc, iar contoarele din apartamente au insumat [\d,]+ mc\. Diferenta de [\d,]+ mc vine din pierderi/);
    expect(t).toMatch(/tie iti revin [\d,]+ mc\.$/);
  });
});
