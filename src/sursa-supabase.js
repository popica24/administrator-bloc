/* =============================================================================
   Sursa de date Supabase
   -----------------------------------------------------------------------------
   Aceeasi interfata ca sursa-mock.js: incarca() aduna ce vede utilizatorul
   autentificat, in forma pe care o citesc ecranele, iar fiecare comanda este
   un apel catre baza de date (functii RPC, fiecare pe un singur agregat) sau
   catre un Edge Function (publicarea listei, plata cu cardul).

   Citirile trec prin RLS: locatarul primeste doar randurile lui, fara nicio
   filtrare facuta aici. Nimic nu se calculeaza aici: sumele vin din
   repartizari (scrise de motor la publicare) si din registrul financiar.
============================================================================= */

import { createClient } from "@supabase/supabase-js";
/* [J9, K22] seara unei zile, ora Romaniei, oricare ar fi fusul dispozitivului */
import { oraSeriiRomania, aziRomania } from "./ora-romania.js";

/* [K24] ziua Romaniei, nu a telefonului */
const aziIso = aziRomania;
const luna = (data) => (data ? String(data).slice(0, 7) : null);
const zi1 = (l) => `${l}-01`;

const nr = (x) => (x == null ? null : Number(x));
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
/* Un camp gol din formular ("" sau necompletat) ajunge null in baza */
const numarSauNull = (v) => (v === "" || v == null ? null : Number(v));

/* [P3] O sesiune moarta (JWT expirat la 24h, sau dupa 8h de inactivitate,
   supabase/config.toml) nu se mai reautorizeaza singura: cererea ajunge fara
   token valid, iar Postgres/PostgREST refuza fie cu "JWT expired" (GoTrue),
   fie cu "permission denied for schema ..." (rolul anon nu are drepturile
   pe care le are authenticated). cmd() din AdminBloc.jsx cauta acest text
   exact ca sa scoata omul la ecranul de autentificare, nu doar sa arate
   toastul si sa-l lase pe ecranul vechi. */
const SESIUNE_EXPIRATA = "Sesiunea a expirat. Intra din nou in cont.";

/* Mesajele tehnice ale serverului, spuse pe romaneste */
function traduce(error) {
  const m = (error && (error.message || error.msg)) || "A aparut o eroare.";
  if (/Invalid login credentials/i.test(m)) return "Emailul sau parola nu sunt corecte. Verifica-le si incearca din nou.";
  if (/Email not confirmed/i.test(m)) return "Confirma adresa de email inainte sa intri in cont.";
  if (/you can only request this after/i.test(m)) return "Ai trimis cererea de doua ori prea repede. Mai asteapta putin si incearca din nou.";
  if (/already registered|already been registered/i.test(m)) return "Exista deja un cont cu acest email.";
  const lungime = m.match(/Password should be at least (\d+) characters/i);
  if (lungime) return `Parola trebuie sa aiba cel putin ${lungime[1]} caractere.`;
  if (/Password should contain at least one character of each/i.test(m)) return "Parola trebuie sa aiba si litere mici, si litere mari, si cifre.";
  if (/JWT expired|invalid JWT|invalid claim|permission denied for schema/i.test(m)) return SESIUNE_EXPIRATA;
  if (/row-level security/i.test(m)) return "Nu ai drept sa faci aceasta operatie.";
  if (error && error.code === "23505") return "Exista deja o inregistrare identica.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Serverul nu raspunde. Verifica conexiunea la internet.";
  return m;
}

const arunca = (error) => { throw new Error(traduce(error)); };

async function ok(promisiune) {
  const { data, error } = await promisiune;
  if (error) arunca(error);
  return data;
}

/* PostgREST intoarce un numar limitat de randuri pe cerere, deci citim pe
   pagini. Paginarea merge pe cheie, nu pe OFFSET: fara `order`, doua cereri
   consecutive nu vad neaparat randurile in aceeasi ordine, deci un rand putea
   sa vina de doua ori sau deloc; iar OFFSET pune serverul sa numere de fiecare
   data randurile pe care apoi le arunca. Asa, fiecare pagina cere randurile de
   dupa ultimul id primit.
   Oprirea nu se uita la PAGINA (1000, cat e azi max_rows in
   supabase/config.toml): o pagina mai scurta decat cat s-a cerut nu inseamna
   neaparat sfarsitul, doar ca serverul a intors mai putin decat am cerut noi
   — daca max_rows ar scadea sub PAGINA, fiecare cerere ar veni "scurta" din
   prima, desi mai raman randuri, si toate() ar trunchia tacut (G13). Singurul
   semnal de sfarsit de incredere este o pagina goala. */
const PAGINA = 1000;
async function toate(construieste) {
  const rezultat = [];
  let ultim = null;
  for (;;) {
    let q = construieste().order("id", { ascending: true }).limit(PAGINA);
    if (ultim !== null) q = q.gt("id", ultim);
    const bucata = await ok(q);
    if (bucata.length === 0) return rezultat;
    rezultat.push(...bucata);
    ultim = bucata[bucata.length - 1].id;
  }
}

/* [J11] Ca toate(), dar cand filtrul e o lista de id-uri prea lunga pentru un
   singur .in() (audit 2, P4: invitatii nu se poate lega de apartamente
   printr-un join, doar printr-un filtru pe lista lor de id-uri) — o cerere
   cu peste o mie de UUID-uri in URL pica cu "URI too long" inainte sa
   ajunga la limita de randuri a raspunsului. Ceruta pe bucati de id-uri, cu
   toate() pe fiecare bucata, functioneaza indiferent de cate id-uri sau
   randuri sunt. */
const BUCATA_IDURI = 200;
async function toateDupaIduri(iduri, construieste) {
  const rezultat = [];
  for (let i = 0; i < iduri.length; i += BUCATA_IDURI) {
    const bucataIduri = iduri.slice(i, i + BUCATA_IDURI);
    rezultat.push(...await toate(() => construieste(bucataIduri)));
  }
  return rezultat;
}

/* Cele mai noi intai / cele mai vechi intai, dupa un camp de data.
   Ordonarea se face aici, nu in cerere: cererea este ordonata dupa id, ca
   paginarea pe cheie sa fie corecta. */
const dupaData = (randuri, camp, crescator = false) =>
  randuri.sort((a, b) => (a[camp] === b[camp] ? 0 : (a[camp] < b[camp]) === crescator ? -1 : 1));

/* Erorile din Edge Functions vin in corpul raspunsului */
async function eroareFunctie(error) {
  try {
    const j = await error.context.json();
    return new Error(j.eroare || traduce(error));
  } catch {
    return new Error(traduce(error));
  }
}

const extensie = (f) => ((f && f.name && f.name.includes(".")) ? f.name.split(".").pop().toLowerCase() : f && f.type === "application/pdf" ? "pdf" : "jpg");

export function creeazaSursaSupabase(url, cheie) {
  const sb = createClient(url, cheie, { auth: { persistSession: true, autoRefreshToken: true } });
  const org = sb.schema("organizare");
  const id = sb.schema("identitate");
  const intr = sb.schema("intretinere");
  const cont = sb.schema("contorizare");
  const fin = sb.schema("financiar");
  const ses = sb.schema("sesizari");
  const guv = sb.schema("guvernanta");
  const com = sb.schema("comunicare");

  /* Contextul utilizatorului, retinut la fiecare incarcare */
  let ctx = null;

  const cerCtx = () => ctx || arunca({ message: "Nu esti autentificat." });

  /* [P5] apartamentAles: apartamentul pe care omul l-a ales ca "activ" (vezi
     alegereApartament() mai jos), daca e legat de mai multe apartamente ale
     aceluiasi bloc. Optional: fara el, se pastreaza alegerea lui identitate.eu(). */
  async function incarca(apartamentAles) {
    const { data: sesiune } = await sb.auth.getSession();
    if (!sesiune.session) return null;
    const eu = await ok(id.rpc("eu"));
    const azi = aziIso();
    const euUi = { profilId: eu.profil_id, nume: eu.nume, telefon: eu.telefon, email: eu.email, rol: eu.rol, apartamentId: eu.apartament_id };
    /* [K21] doar pentru rolul "respins" trimite identitate.eu() motivul */
    if (eu.rol === "respins") euUi.motivRespingere = eu.motiv_respingere;
    ctx = { profilId: eu.profil_id, rol: eu.rol, blocId: eu.bloc_id, asociatieId: eu.asociatie_id, apartamentId: eu.apartament_id };
    if (eu.rol !== "administrator" && eu.rol !== "locatar") return { azi, eu: euUi };

    const esteAdmin = eu.rol === "administrator";
    const bloc = eu.bloc_id;
    const asoc = eu.asociatie_id;
    /* [P5] identitate.eu() alege un singur apartament, determinist, dar
       acelasi om poate fi legat de mai multe apartamente ale aceluiasi bloc
       (proprietar la unul, chirias la altul, de exemplu): fara legaturile
       lui, alMeu() mai jos ar lasa afara datoriile, contoarele si sesizarile
       celuilalt apartament, care ar ramane invizibile si neplatibile.
       Interogarea sta inaintea marelui Promise.all, pentru ca alMeu() si
       prin() (folosite in el) au nevoie de lista completa. */
    /* [K17] ordonate, ca alegerea apartamentului sa nu se reaseze la fiecare incarcare */
    const legaturileMele = esteAdmin ? [] : await ok(id.from("locatari").select("apartament_id, calitate")
      .eq("profil_id", eu.profil_id).eq("bloc_id", bloc)
      .lte("activ_din", azi).or(`activ_pana.is.null,activ_pana.gt.${azi}`)
      .order("activ_din", { ascending: true }).order("apartament_id", { ascending: true }));
    const idApartamenteMele = legaturileMele.length ? legaturileMele.map((l) => l.apartament_id) : [eu.apartament_id];
    /* Apartamentul "activ" este cel ales de om, daca e chiar unul de-al lui;
       altfel ramane cel ales de identitate.eu(). */
    if (!esteAdmin && apartamentAles && idApartamenteMele.includes(apartamentAles)) {
      euUi.apartamentId = apartamentAles;
      ctx.apartamentId = apartamentAles;
    }
    /* Locatarul vede pe ecrane doar apartamentele lui, chiar daca RLS ii da
       mai mult (un presedinte sau cenzor care locuieste in bloc vede tot
       blocul) */
    const alMeu = (q) => (esteAdmin ? q : q.in("apartament_id", idApartamenteMele));
    /* Tabelele fara bloc_id se filtreaza prin randul-parinte, cu un join
       interior: altfel cererea aduce randurile intregii asociatii si le arunca
       aici (audit 2, P4). Locatarul primeste in plus filtrul pe apartamentele
       lui, tot pe parinte. */
    const prin = (q, alias, camp = "apartament_id") => {
      const cu = q.eq(`${alias}.bloc_id`, bloc);
      return esteAdmin ? cu : cu.in(`${alias}.${camp}`, idApartamenteMele);
    };

    const [
      asociatie, setariFin, setariCont, blocRand, contacte, apartamente, persoane, liste, cheltuieli, furnizori,
      repartizari, contoare, citiri, consumMediu, datorii, penalizari, plati, alocari, chitante, situatieBloc,
      fonduri, miscari, sesizari, mesaje, poze, sesizariBloc, anunturi, anunturiCitiri, documente, voturi, adunari,
      remindere, notificari, locatari, profiluri,
    ] = await Promise.all([
      ok(org.from("asociatii").select("*").eq("id", asoc).single()),
      ok(fin.from("setari_financiare").select("*").eq("asociatie_id", asoc).maybeSingle()),
      ok(cont.from("setari_contorizare").select("*").eq("bloc_id", bloc).maybeSingle()),
      ok(org.from("blocuri").select("*").eq("id", bloc).single()),
      ok(org.rpc("contacte_asociatie", { p_asociatie_id: asoc })),
      toate(() => org.from("apartamente").select("*").eq("bloc_id", bloc)),
      toate(() => org.from("apartamente_persoane").select("*, ap:apartamente!inner(bloc_id, id)")
        .eq("ap.bloc_id", bloc)),
      toate(() => intr.from("liste_lunare").select("*").eq("bloc_id", bloc)),
      toate(() => intr.from("cheltuieli").select("*, l:liste_lunare!inner(bloc_id)").eq("l.bloc_id", bloc)),
      /* [K17] prin toate(): peste max_rows se pierdeau tacut, in ordinea fizica */
      toate(() => intr.from("furnizori").select("*").eq("asociatie_id", asoc)),
      toate(() => alMeu(intr.from("repartizari").select("*").eq("bloc_id", bloc))),
      toate(() => alMeu(cont.from("contoare").select("*").eq("bloc_id", bloc).is("scos_la", null))),
      toate(() => alMeu(cont.from("citiri").select("*").eq("bloc_id", bloc))),
      ok(cont.rpc("consum_mediu_bloc", { p_bloc_id: bloc })),
      toate(() => alMeu(fin.from("datorii_rest").select("*").eq("bloc_id", bloc))),
      toate(() => prin(fin.from("penalizari").select("*, d:datorii!penalizari_datorie_id_fkey!inner(bloc_id, apartament_id)"), "d")),
      toate(() => alMeu(fin.from("plati").select("*").eq("bloc_id", bloc).eq("stare", "confirmata"))),
      toate(() => prin(fin.from("alocari_plati").select("*, p:plati!inner(bloc_id, apartament_id)"), "p")),
      toate(() => prin(fin.from("chitante").select("*, p:plati!inner(bloc_id, apartament_id)"), "p")),
      ok(fin.rpc("situatie_bloc", { p_bloc_id: bloc })),
      toate(() => fin.from("fonduri_solduri").select("*").eq("bloc_id", bloc)),
      toate(() => fin.from("miscari_fond").select("*, f:fonduri!inner(bloc_id)").eq("f.bloc_id", bloc)),
      toate(() => alMeu(ses.from("sesizari").select("*").eq("bloc_id", bloc))),
      toate(() => prin(ses.from("sesizari_mesaje").select("*, s:sesizari!inner(bloc_id, apartament_id)"), "s")),
      toate(() => prin(ses.from("sesizari_poze").select("*, s:sesizari!inner(bloc_id, apartament_id)"), "s")),
      esteAdmin ? Promise.resolve([]) : ok(ses.rpc("sesizari_bloc", { p_bloc_id: bloc })),
      toate(() => com.from("anunturi").select("*").eq("asociatie_id", asoc)),
      toate(() => com.from("anunturi_citiri").select("*, a:anunturi!inner(asociatie_id)").eq("a.asociatie_id", asoc)),
      toate(() => com.from("documente").select("*").eq("asociatie_id", asoc)),
      /* [J6] p_apartament_id: apartamentul activ, ca votulMeu/prezentaMea sa
         raspunda pentru el, nu pentru orice apartament al meu, gasit primul
         (un locatar cu doua apartamente in bloc putea vedea votul/prezenta
         celuilalt apartament pe ecranul apartamentului ales). */
      ok(guv.rpc("situatie_voturi", { p_asociatie_id: asoc, p_apartament_id: euUi.apartamentId || null })),
      ok(guv.rpc("situatie_adunari", { p_asociatie_id: asoc, p_apartament_id: euUi.apartamentId || null })),
      esteAdmin ? ok(com.from("remindere_setari").select("*").eq("asociatie_id", asoc)) : Promise.resolve([]),
      ok(com.from("notificari").select("*").eq("profil_id", eu.profil_id).order("trimisa_la", { ascending: false }).limit(50)),
      esteAdmin ? toate(() => id.from("locatari").select("*").eq("bloc_id", bloc)) : Promise.resolve([]),
      toate(() => id.from("profiluri").select("id, nume, email, telefon")),
    ]);
    /* [K17] toate() ordoneaza dupa id, pentru paginare; id-ul e un UUID
       aleator, deci ordinea aceea nu inseamna nimic pentru om si difera de la
       o baza la alta (pe CI, ecranul Fonduri ajungea sa inregistreze iesirea
       in celalalt fond). Listele pe care omul le vede in ordinea sursei primesc
       ordinea din sursa demo: furnizorii si locatarii in ordinea adaugarii,
       fondurile reparatii, apoi rulment. */
    const inOrdineaAdaugarii = (x, y) => `${x.creat_la}|${x.id}`.localeCompare(`${y.creat_la}|${y.id}`);
    furnizori.sort(inOrdineaAdaugarii);
    locatari.sort(inOrdineaAdaugarii);
    fonduri.sort((x, y) => x.tip.localeCompare(y.tip));
    /* Codurile nefolosite ale blocului. Join-ul nu se poate face in cerere:
       identitate.invitatii si organizare.apartamente sunt in scheme diferite,
       iar PostgREST leaga doar tabele din aceeasi schema, deci filtrul merge
       pe lista de id-uri a apartamentelor (audit 2, P4). [J11] Pe bucati de
       id-uri, cu paginare pe fiecare bucata: un bloc cu multe apartamente nu
       mai pica cu "URI too long" si nu mai trunchiaza tacut la max_rows. */
    const invitatii = esteAdmin
      ? await toateDupaIduri(apartamente.map((a) => a.id), (iduri) => id.from("invitatii").select("*").in("apartament_id", iduri)
        .is("folosita_la", null).is("revocata_la", null).gt("expira_la", new Date().toISOString()))
      : [];

    if (!esteAdmin) {
      /* [P1] Calitatea locatarului la apartamentul activ, ca ecranele sa
         stie inainte sa lase omul sa incerce o actiune rezervata
         proprietarului (votul, Legea 196/2018). */
      const aMea = legaturileMele.find((l) => l.apartament_id === euUi.apartamentId);
      euUi.calitate = aMea ? aMea.calitate : null;
      /* [P5] Apartamentele lui in acest bloc, ca ecranele sa poata arata
         alegerea intre ele (BaraSus arata deja "Apartament N"). */
      euUi.apartamenteMele = idApartamenteMele;
    }
    ctx.blocDenumire = blocRand.denumire;
    /* Soldul fiecarui fond, retinut pentru verificarea ieftina din
       inregistreazaIesireFond: evita o cerere in plus catre server doar ca sa
       afle ce stie deja de la ultimul incarca() (G3). */
    ctx.fonduriSold = Object.fromEntries(fonduri.map((f) => [f.id, nr(f.sold)]));
    /* Cererile sunt ordonate dupa id (paginare pe cheie), deci ordinea pe care
       o asteapta ecranele se face aici */
    dupaData(persoane, "valabil_din");
    dupaData(miscari, "data");
    dupaData(mesaje, "creat_la", true);
    dupaData(liste, "luna");
    dupaData(anunturi, "publicat_la");
    dupaData(documente, "creat_la");

    const numeProfil = (pid) => (profiluri.find((p) => p.id === pid) || {}).nume || null;
    const lunaAzi = luna(azi);
    const persoaneIn = (apId, l) => {
      const r = persoane.filter((p) => p.apartament_id === apId && luna(p.valabil_din) <= l);
      return r.length ? r[0].numar_persoane : 0;
    };

    const versiune = Object.fromEntries(liste.map((l) => [l.id, l.versiune]));
    const idListe = new Set(liste.map((l) => l.id));
    const numeFurnizor = (fid) => (furnizori.find((f) => f.id === fid) || {}).denumire || asociatie.denumire;
    const numarAp = (aid) => (apartamente.find((a) => a.id === aid) || {}).numar;
    const locatariActivi = locatari.filter((l) => !l.activ_pana || l.activ_pana > azi);

    const datoriiUi = datorii.map((d) => ({
      id: d.id, apartamentId: d.apartament_id, tip: d.tip, luna: luna(d.luna), listaId: d.lista_id, suma: nr(d.suma),
      scadenta: d.scadenta, descriere: d.descriere, rest: round2(nr(d.rest)), documentId: d.document_id, creatLa: d.creat_la,
      /* [K7] doar la o anulare de penalizare: penalizarea pe care o reduce */
      anuleazaDatorieId: d.anuleaza_datorie_id,
    }));
    /* [K13] Alocarile unei plati (randurile chitantei) in ordinea in care le-a
       facut aloca_plata: scadenta, data datoriei, id. Veneau dupa id-ul
       alocarii, un UUID aleator, deci lunile unei plati apareau amestecate. */
    const cheieDatorie = new Map(datorii.map((d) => [d.id, `${d.scadenta}|${d.creat_la}|${d.id}`]));
    const inOrdineaPlatii = (x, y) => String(cheieDatorie.get(x.datorie_id)).localeCompare(String(cheieDatorie.get(y.datorie_id)));
    const idDatorii = new Set(datorii.map((d) => d.id));

    return {
      azi,
      eu: euUi,
      asociatie: {
        id: asociatie.id, denumire: asociatie.denumire, cui: asociatie.cui, iban: asociatie.iban, banca: asociatie.banca,
        adresa: asociatie.adresa, telefon: asociatie.telefon, email: asociatie.email,
      },
      setari: {
        procentPenalizareZi: nr(setariFin ? setariFin.procent_penalizare_zi : 0.02),
        zileGratie: setariFin ? setariFin.zile_gratie : 30,
        ziScadenta: setariFin ? setariFin.zi_scadenta : 25,
        chitantaSerie: setariFin ? setariFin.chitanta_serie : "",
        ziLimitaCitire: setariCont ? setariCont.zi_limita_citire : 25,
      },
      bloc: { id: blocRand.id, denumire: blocRand.denumire, adresa: blocRand.adresa, etaje: blocRand.etaje, stare: blocRand.stare },
      contacte: contacte.map((c) => ({ id: c.id, rol: c.rol, nume: c.nume, telefon: c.telefon, program: c.program, apartamentNumar: c.apartament_numar })),
      apartamente: apartamente
        .sort((a, b) => a.numar.localeCompare(b.numar, "ro", { numeric: true }))
        .map((a) => ({
          id: a.id, numar: a.numar, etaj: a.etaj, proprietar: a.proprietar_nume, cota: nr(a.cota_indiviza), mp: nr(a.suprafata_mp),
          scutitLift: a.scutit_lift, persoane: persoaneIn(a.id, lunaAzi),
          istoricPersoane: persoane.filter((p) => p.apartament_id === a.id).map((p) => ({ valabilDin: luna(p.valabil_din), numar: p.numar_persoane, motiv: p.motiv })),
          locatari: locatari.filter((l) => l.apartament_id === a.id).map((l) => {
            const p = profiluri.find((x) => x.id === l.profil_id) || {};
            return { id: l.id, nume: p.nume || "Locatar", email: p.email, telefon: p.telefon, calitate: l.calitate, activDin: l.activ_din, activPana: l.activ_pana };
          }),
          invitatii: invitatii.filter((i) => i.apartament_id === a.id).map((i) => ({ id: i.id, cod: i.cod, calitate: i.calitate, expiraLa: i.expira_la })),
        })),
      liste: liste.map((l) => ({
        id: l.id, luna: luna(l.luna), stare: l.stare, versiune: l.versiune, scadenta: l.scadenta, publicataLa: l.publicata_la,
        totalRepartizat: nr(l.total_repartizat) || 0, apartamente: l.apartamente_repartizate || 0,
      })),
      cheltuieli: cheltuieli.filter((c) => idListe.has(c.lista_id)).map((c) => ({
        id: c.id, listaId: c.lista_id, cod: c.cod, tip: c.tip, categorie: c.categorie, furnizorId: c.furnizor_id,
        furnizor: numeFurnizor(c.furnizor_id), serie: c.serie_numar, suma: nr(c.suma), metoda: c.metoda, tipApa: c.tip_apa,
        emisa: c.data_emitere, scadentaFurnizor: c.scadenta_furnizor, achitataLa: c.achitata_furnizor_la, documentId: c.document_id,
      })),
      repartizari: repartizari.filter((r) => r.versiune === versiune[r.lista_id]).map((r) => ({
        cheltuialaId: r.cheltuiala_id, listaId: r.lista_id, apartamentId: r.apartament_id, suma: nr(r.suma),
        baza: { valoare: nr(r.baza_valoare), total: nr(r.baza_total), unitate: r.unitate }, rotunjire: nr(r.rotunjire), detaliu: r.detaliu,
      })),
      contoare: contoare.map((c) => ({ id: c.id, apartamentId: c.apartament_id, tip: c.tip, serie: c.serie, amplasare: c.amplasare })),
      citiri: citiri.map((c) => ({
        id: c.id, contorId: c.contor_id, apartamentId: c.apartament_id, tip: c.tip, luna: luna(c.luna), indexAnterior: nr(c.index_anterior),
        indexCurent: nr(c.index_curent), consum: nr(c.consum), sursa: c.sursa, stare: c.stare, pozaCale: c.poza_cale,
        motivRespingere: c.motiv_respingere, transmisaLa: c.transmisa_la,
      })),
      consumMediu: Object.fromEntries(consumMediu.map((m) => [luna(m.luna), { rece: nr(m.rece), calda: nr(m.calda), apartamente: m.apartamente }])),
      datorii: datoriiUi,
      penalizari: penalizari.filter((p) => idDatorii.has(p.datorie_id)).map((p) => ({
        id: p.id, datorieSursaId: p.datorie_sursa_id, datorieId: p.datorie_id, lunaCalcul: p.luna_calcul, restNeachitat: nr(p.rest_neachitat),
        zileIntarziere: p.zile_intarziere, zileGratie: p.zile_gratie, zileTaxate: p.zile_taxate, procentZi: nr(p.procent_zi), suma: nr(p.suma),
      })),
      plati: plati.map((p) => {
        const ch = chitante.find((c) => c.plata_id === p.id);
        return {
          id: p.id, apartamentId: p.apartament_id, suma: nr(p.suma), metoda: p.metoda, stare: p.stare, confirmataLa: p.confirmata_la,
          referinta: p.referinta_procesator, inregistrataDe: p.inregistrata_de ? numeProfil(p.inregistrata_de) : null,
          chitanta: ch ? { serie: ch.serie, numar: ch.numar, emisaLa: ch.emisa_la } : null,
          alocari: alocari.filter((a) => a.plata_id === p.id).sort(inOrdineaPlatii).map((a) => ({ datorieId: a.datorie_id, suma: nr(a.suma) })),
        };
      }),
      situatieBloc: { apartamente: situatieBloc.apartamente, faraRestanta: situatieBloc.faraRestanta, restanteTotal: nr(situatieBloc.restanteTotal) },
      fonduri: fonduri.map((f) => ({
        id: f.id, tip: f.tip, denumire: f.denumire, sumaPerApartament: nr(f.suma_per_apartament), sold: nr(f.sold),
        miscari: miscari.filter((m) => m.fond_id === f.id).map((m) => ({ id: m.id, data: m.data, suma: nr(m.suma), descriere: m.descriere, documentId: m.document_id, listaId: m.lista_id })),
      })),
      sesizari: [
        ...sesizari.map((s) => ({
          id: s.id, aMea: s.apartament_id === eu.apartament_id, titlu: s.titlu, categorie: s.categorie, stare: s.stare,
          creataLa: s.creat_la, preluataLa: s.preluata_la, rezolvataLa: s.rezolvata_la, descriere: s.descriere,
          apartamentId: s.apartament_id, apartamentNumar: numarAp(s.apartament_id),
          mesaje: mesaje.filter((m) => m.sesizare_id === s.id).map((m) => ({
            id: m.id, text: m.text, la: m.creat_la, dinAdministratie: m.din_administratie, autor: numeProfil(m.autor_id),
          })),
          poze: poze.filter((p) => p.sesizare_id === s.id).map((p) => ({ id: p.id, cale: p.cale })),
        })),
        ...sesizariBloc.map((s) => ({
          /* [K10] Vederea anonima (sesizari_bloc) nu mai aduce descrierea:
             autorul se putea deduce din detaliile scrise acolo. */
          id: s.id, aMea: false, titlu: s.titlu, categorie: s.categorie, stare: s.stare, creataLa: s.creat_la, preluataLa: s.preluata_la,
          rezolvataLa: s.rezolvata_la, descriere: null, apartamentId: null, apartamentNumar: null, mesaje: [], poze: [],
        })),
      ].sort((a, b) => (a.creataLa < b.creataLa ? 1 : -1)),
      anunturi: anunturi.filter((a) => !a.bloc_id || a.bloc_id === bloc).map((a) => ({
        id: a.id, titlu: a.titlu, corp: a.corp, urgent: a.urgent, publicatLa: a.publicat_la, autor: numeProfil(a.autor_id),
        citit: anunturiCitiri.some((c) => c.anunt_id === a.id && c.profil_id === eu.profil_id),
        cititori: esteAdmin ? anunturiCitiri.filter((c) => c.anunt_id === a.id && locatariActivi.some((l) => l.profil_id === c.profil_id)).length : null,
        totalLocatari: esteAdmin ? new Set(locatariActivi.map((l) => l.profil_id)).size : null,
      })),
      documente: documente.filter((d) => !d.bloc_id || d.bloc_id === bloc).map((d) => ({
        id: d.id, titlu: d.titlu, tip: d.tip, creatLa: d.creat_la, vizibil: d.vizibil_locatarilor,
      })),
      voturi: voturi.map((v) => ({
        ...v,
        optiuni: v.optiuni.map((o) => ({ ...o, voturi: Number(o.voturi), cote: nr(o.cote) })),
        votanti: Number(v.votanti), totalApartamente: Number(v.totalApartamente), nevotate: v.nevotate || null,
      })),
      adunari: adunari.map((a) => ({ ...a, prezente: Number(a.prezente), totalApartamente: Number(a.totalApartamente) })),
      furnizori: esteAdmin ? furnizori.map((f) => ({
        id: f.id, denumire: f.denumire, cui: f.cui, categorie: f.categorie_implicita, metoda: f.metoda_implicita, tipApa: f.tip_apa_implicit, cod: f.cod_implicit,
      })) : [],
      remindere: remindere.map((r) => ({ tip: r.tip, activ: r.activ, zile: r.zile })),
      notificari: notificari.map((n) => ({ id: n.id, tip: n.tip, titlu: n.titlu, corp: n.corp, trimisaLa: n.trimisa_la, cititaLa: n.citita_la })),
    };
  }

  /* [A8] O poza pe care telefonul n-a putut sa o decodeze (HEIC, pe unele
     telefoane Android) sau al carei toBlob() a esuat ajunge la incarcare
     neschimbata (micsoreazaPoza() intoarce fisierul original cand nu poate
     produce un JPEG): fie intr-un format pe care bucket-ul "poze" nu il
     accepta, fie prea mare pentru limita lui de 1 MB. Bucket-ul refuza
     upload-ul cu un mesaj tehnic, in engleza ("mime type ... is not
     supported", "the object exceeded the maximum allowed size"), pe care
     omul nu-l poate folosi. Orice alt refuz (retea, drept de scriere)
     trece mai departe prin traduce(), neschimbat. */
  const ESEC_POZA = /mime type|not supported|maximum allowed size|payload too large/i;
  const incarcaFisier = async (bucket, cale, fisier) => {
    const { error } = await sb.storage.from(bucket).upload(cale, fisier, { contentType: fisier.type || undefined, upsert: false });
    if (error) {
      if (bucket === "poze" && ESEC_POZA.test(error.message)) {
        throw new Error("Poza nu a putut fi trimisa: formatul ei sau dimensiunea ei nu sunt acceptate. Fa poza din nou (nu HEIC) sau alege alta poza si incearca iar.");
      }
      arunca(error);
    }
    return cale;
  };
  const invoca = async (nume, corp) => {
    const { data, error } = await sb.functions.invoke(nume, { body: corp });
    if (error) throw await eroareFunctie(error);
    return data;
  };
  const document = async ({ titlu, tip, fisier, vizibil = true }) => {
    const c = cerCtx();
    const cale = `${c.asociatieId}/${c.blocId}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${extensie(fisier)}`;
    await incarcaFisier("documente", cale, fisier);
    return ok(sb.schema("comunicare").from("documente").insert({
      asociatie_id: c.asociatieId, bloc_id: c.blocId, titlu, tip, cale, vizibil_locatarilor: vizibil, incarcat_de: c.profilId,
    }).select().single());
  };

  return {
    tip: "supabase",

    async sesiuneCurenta() {
      const { data } = await sb.auth.getSession();
      return data.session ? { profilId: data.session.user.id, email: data.session.user.email } : null;
    },

    async intra(email, parola) {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: parola });
      if (error) arunca(error);
      return { profilId: data.user.id, email: data.user.email };
    },

    async iesi() {
      ctx = null;
      await sb.auth.signOut();
    },

    /* Cand Auth cere confirmarea emailului, signUp() nu deschide sesiune.
       Comanda intoarce null (nu arunca): ecranul stie sa arate "Confirma
       adresa de email" doar dupa un rezultat gol, nu dupa o exceptie, care ar
       fi tratata ca o inregistrare esuata si ar pierde codul de invitatie (C1). */
    async inregistreaza({ email, parola, nume, telefon }) {
      const { data, error } = await sb.auth.signUp({ email, password: parola, options: { data: { nume, telefon } } });
      if (error) arunca(error);
      if (!data.session) return null;
      return { profilId: data.user.id, email };
    },

    async cereVerificareAdministrator({ numarAtestat, fisier }) {
      const { data } = await sb.auth.getUser();
      /* [NOU-1] Fara sesiune, data.user este null: data.user.id arunca un
         TypeError tehnic, in loc sa spuna pe romaneste ce s-a intamplat. */
      if (!data.user) arunca({ message: "Nu esti autentificat." });
      let cale = null;
      if (fisier) cale = await incarcaFisier("atestate", `${data.user.id}/atestat-${Date.now()}.${extensie(fisier)}`, fisier);
      await ok(id.rpc("cere_verificare_administrator", { p_numar_atestat: numarAtestat, p_atestat_cale: cale }));
    },

    /* Codul gresit nu mai ridica exceptie in baza (altfel s-ar anula si randul
       care numara incercarea, deci limita nu ar retine nimic): comanda intoarce
       mesajul, iar aici redevine eroare, ca sa nu se schimbe nimic pe ecran. */
    async folosesteInvitatie(cod) {
      const r = await ok(id.rpc("foloseste_invitatie", { p_cod: cod }));
      if (r.eroare) throw new Error(r.eroare);
      return { apartamentNumar: r.apartament_numar };
    },

    incarca,

    async urlFisier(cale) {
      if (!cale) return null;
      const { data, error } = await sb.storage.from("poze").createSignedUrl(cale, 3600);
      return error ? null : data.signedUrl;
    },

    async deschideDocument(documentId) {
      const { data: rand, error: erorRand } = await com.from("documente").select("cale").eq("id", documentId).single();
      if (erorRand) {
        /* Ascuns de administrator sau sters: RLS nu mai lasa randul sa treaca,
           iar .single() pe zero randuri intoarce mesajul tehnic PGRST116. */
        if (erorRand.code === "PGRST116") throw new Error("Documentul nu mai exista sau nu este disponibil.");
        arunca(erorRand);
      }
      const { data, error } = await sb.storage.from("documente").createSignedUrl(rand.cale, 600);
      if (error) arunca(error);
      return data.signedUrl;
    },

    /* ---------- Locatar ---------- */

    /* Raspunsul 202 (in_asteptare) nu este un esec: banca nu a apucat inca sa
       confirme sau sa refuze, plata ramane deschisa si va fi confirmata sau
       refuzata prin webhook. Formularul trebuie sa stie asta ca sa nu se
       redeschida si sa lase omul sa plateasca de doua ori (H7/F8). */
    async platesteCard({ apartamentId, suma, card }) {
      const r = await invoca("plata-card", { apartament_id: apartamentId, suma, card });
      if (r.stare === "confirmata") return { plataId: r.plataId };
      if (r.stare === "in_asteptare") return { plataId: r.plataId, inAsteptare: true, mesaj: r.mesaj || "Plata asteapta confirmarea bancii." };
      throw new Error(r.mesaj || "Plata nu a fost confirmata.");
    },

    async transmiteCitire({ apartamentId, luna: l, indexuri, poza }) {
      const c = cerCtx();
      const cale = poza ? await incarcaFisier("poze", `${c.blocId}/${apartamentId}/citire-${l}-${Date.now()}.jpg`, poza) : null;
      await ok(cont.rpc("transmite_citire", {
        p_apartament_id: apartamentId, p_luna: zi1(l), p_indexuri: indexuri.map((x) => ({ contor_id: x.contorId, index: x.index })), p_poza_cale: cale,
      }));
    },

    async adaugaSesizare({ apartamentId, titlu, categorie, descriere, poze }) {
      const c = cerCtx();
      const cai = [];
      for (const [i, f] of (poze || []).entries()) {
        cai.push(await incarcaFisier("poze", `${c.blocId}/${apartamentId}/sesizare-${Date.now()}-${i + 1}.jpg`, f));
      }
      return ok(ses.rpc("adauga_sesizare", { p_apartament_id: apartamentId, p_titlu: titlu, p_categorie: categorie, p_descriere: descriere, p_poze: cai }));
    },

    scrieMesaj: (sesizareId, text) => ok(ses.rpc("scrie_mesaj", { p_sesizare_id: sesizareId, p_text: text })),
    voteaza: (votId, optiuneId, apartamentId) => ok(guv.rpc("voteaza", { p_vot_id: votId, p_optiune_id: optiuneId, p_apartament_id: apartamentId })),
    confirmaPrezenta: (adunareId, apartamentId) => ok(guv.rpc("confirma_prezenta", { p_adunare_id: adunareId, p_apartament_id: apartamentId })),
    marcheazaAnuntCitit: (anuntId) => ok(com.rpc("marcheaza_anunt_citit", { p_anunt_id: anuntId })),
    marcheazaNotificareCitita: (nid) => ok(com.rpc("marcheaza_notificare_citita", { p_notificare_id: nid })),

    /* ---------- Administrator ---------- */

    deschideLista: (l) => ok(intr.rpc("deschide_lista", { p_bloc_id: cerCtx().blocId, p_luna: zi1(l) })),

    async salveazaCheltuiala({ id: cid, listaId, furnizorId, furnizorNou, categorie, cod, suma, metoda, tipApa, serie, emisa, scadentaFurnizor, fisier }) {
      const c = cerCtx();
      if (!furnizorId && !(furnizorNou || "").trim()) throw new Error("Alege furnizorul facturii.");
      /* [L11] Codul dublat se verifica inainte de orice scriere, la fel ca in
         sursa demonstrativa: altfel furnizorul nou se insereaza deja cand
         baza refuza cheltuiala cu codul dublat (unique lista_id+cod), si
         ramane orfan, fara nicio cheltuiala care sa-l foloseasca. */
      let dubluQ = intr.from("cheltuieli").select("id").eq("lista_id", listaId).eq("cod", cod);
      if (cid) dubluQ = dubluQ.neq("id", cid);
      if ((await ok(dubluQ)).length > 0) throw new Error(`Codul ${cod} exista deja pe lista.`);
      /* [P4] La editare, randul se verifica inainte de a urca scanul, la fel
         ca la codul dublat mai sus si ca la iesirea din fond (C6): altfel un
         scan urca deja in comunicare.documente, vizibil locatarilor la Acte,
         pentru o cheltuiala care pana la urma nu s-a salvat (randul fondului
         de reparatii sau un rand disparut intre incarcare si salvare). */
      if (cid) {
        const rand = await ok(intr.from("cheltuieli").select("tip").eq("id", cid).maybeSingle());
        if (!rand) throw new Error("Randul nu mai poate fi modificat. Reincarca lista si incearca din nou.");
        if (rand.tip !== "factura") throw new Error("Randul fondului de reparatii nu se modifica din formularul de factura.");
      }
      /* [K23] Factura noua cu furnizor nou: un singur apel, deci o singura
         tranzactie. In doi pasi, o cursa pe acelasi cod lasa furnizorul celui
         refuzat orfan, fara nicio factura. */
      const cuFurnizorNou = !furnizorId && !cid;
      let fid = furnizorId;
      if (!fid && cid) {
        const f = await ok(intr.from("furnizori").insert({
          asociatie_id: c.asociatieId, denumire: furnizorNou.trim(), categorie_implicita: categorie, metoda_implicita: metoda, tip_apa_implicit: tipApa || null, cod_implicit: cod,
        }).select().single());
        fid = f.id;
      }
      const doc = fisier ? await document({ titlu: `Factura ${serie || ""}`.trim(), tip: "factura", fisier }) : null;
      const valori = {
        lista_id: listaId, tip: "factura", cod, categorie, furnizor_id: fid, serie_numar: serie || null, suma, metoda,
        tip_apa: metoda === "consum" ? tipApa : null, data_emitere: emisa || null, scadenta_furnizor: scadentaFurnizor || null,
        ...(doc ? { document_id: doc.id } : {}),
      };
      let rezultat;
      if (cuFurnizorNou) {
        rezultat = await intr.rpc("adauga_factura_cu_furnizor_nou", {
          p_lista_id: listaId, p_denumire: furnizorNou.trim(), p_categorie: categorie, p_cod: cod, p_suma: suma, p_metoda: metoda,
          p_tip_apa: tipApa || null, p_serie: serie || null, p_emisa: emisa || null, p_scadenta: scadentaFurnizor || null,
          p_document_id: doc ? doc.id : null,
        });
        if (rezultat.data) rezultat = { ...rezultat, data: { id: rezultat.data } };
      } else {
        rezultat = cid
          ? await intr.from("cheltuieli").update(valori).eq("id", cid).eq("tip", "factura").select().single()
          : await intr.from("cheltuieli").insert(valori).select().single();
      }
      const { data, error } = rezultat;
      if (error) {
        /* [K23] Prin functie pot cadea doua chei unice: codul pe lista si
           numele furnizorului nou; doar prima inseamna "cod dublat". */
        if (error.code === "23505" && /cheltuieli_lista_cod_key/.test(error.message)) throw new Error(`Codul ${cod} exista deja pe lista.`);
        if (cid && error.code === "PGRST116") {
          /* [P4] Verificarea de mai sus a gasit randul, cu tipul "factura",
             inainte de a urca vreun scan: daca update-ul tot nu-l gaseste,
             lista s-a publicat sau randul a disparut chiar intre verificare
             si scriere (RLS filtreaza tacit) — o cursa rara, care nu mai are
             cum sa fie randul fondului (deja exclus mai sus). */
          throw new Error("Randul nu mai poate fi modificat. Reincarca lista si incearca din nou.");
        }
        arunca(error);
      }
      return data.id;
    },

    /* .select() dupa delete intoarce randurile chiar sterse: pe o lista
       publicata, politica RLS de delete nu se potriveste, deci fara el un
       delete care nu a atins niciun rand ar parea reusit (NOU-4). */
    async stergeCheltuiala(cid) {
      const randuri = await ok(intr.from("cheltuieli").delete().eq("id", cid).select());
      if (randuri.length === 0) {
        const r = await intr.from("cheltuieli").select("lista_id, l:liste_lunare!inner(stare)").eq("id", cid).maybeSingle();
        if (r.data && r.data.l.stare !== "ciorna") throw new Error("Lista este deja publicata; cheltuiala nu se mai poate sterge.");
        throw new Error("Randul nu mai exista. Reincarca lista si incearca din nou.");
      }
    },

    async dateMotor(listaId) {
      const dm = await ok(intr.rpc("date_pentru_motor", { p_lista_id: listaId }));
      const numere = (o) => Object.fromEntries(Object.entries(o || {}).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([t, x]) => [t, Number(x)]))]));
      return {
        apartamente: dm.apartamente.map((a) => ({ id: a.id, numar: a.numar, persoane: Number(a.persoane), cota: Number(a.cota), scutitLift: !!a.scutitLift })),
        cheltuieli: dm.cheltuieli.map((x) => ({ id: x.id, cod: x.cod, suma: Number(x.suma), metoda: x.metoda, tipApa: x.tipApa })),
        consum: numere(dm.consum),
        contorGeneral: Object.fromEntries(Object.entries(dm.contorGeneral || {}).map(([t, x]) => [t, Number(x)])),
      };
    },

    publicaLista: (listaId) => invoca("publica-lista", { lista_id: listaId }),
    marcheazaFacturaPlatita: (cid, platita) => ok(intr.rpc("marcheaza_factura_platita", { p_cheltuiala_id: cid, p_platita: platita })),

    async inregistreazaNumerar(apartamentId, suma) {
      const plataId = await ok(fin.rpc("inregistreaza_plata_numerar", { p_apartament_id: apartamentId, p_suma: suma }));
      return { plataId };
    },

    trimiteInstiintare: (apartamentId) => ok(com.rpc("trimite_instiintare", { p_apartament_id: apartamentId })),

    async schimbaPersoane(apartamentId, numar, dinLuna, motiv) {
      const { error } = await org.from("apartamente_persoane").insert({
        apartament_id: apartamentId, valabil_din: zi1(dinLuna), numar_persoane: numar, motiv: motiv || null, modificat_de: cerCtx().profilId,
      });
      if (error) {
        if (error.code === "23505") throw new Error("Exista deja o modificare pentru luna aceasta. Istoricul nu se rescrie.");
        arunca(error);
      }
    },

    /* Fisa apartamentului: singura cale spre organizare.apartamente */
    schimbaFisaApartament: (apartamentId, { proprietar, cota, mp, scutitLift, etaj }) => ok(org.rpc("schimba_fisa_apartament", {
      p_apartament_id: apartamentId,
      p_proprietar_nume: proprietar,
      p_cota_indiviza: numarSauNull(cota),
      p_suprafata_mp: numarSauNull(mp),
      p_scutit_lift: !!scutitLift,
      p_etaj: numarSauNull(etaj),
    })),

    /* Redistribuie cotele blocului dintr-o data: pe un bloc activ, schimbaFisaApartament
       nu poate muta procente de la un apartament la altul, pentru ca fiecare pas
       intermediar ar strica suma de 100 (C4). cote: [{ apartamentId, cota }, ...],
       cate o intrare pentru fiecare apartament al blocului. */
    schimbaCoteleBlocului: (cote) => ok(org.rpc("schimba_cotele_blocului", {
      p_bloc_id: cerCtx().blocId,
      p_cote: (cote || []).map((c) => ({ apartament_id: c.apartamentId, cota: numarSauNull(c.cota) })),
    })),

    /* Iesire din fond: suma, descrierea si data se verifica aici, ieftin,
       inainte sa se incarce documentul (C6) — altfel orice refuz din RPC (care
       reverifica aceleasi campuri) lasa un document orfan, vizibil locatarilor
       prin comunicare.documente. La fel si soldul (G3): e cel mai frecvent
       refuz, iar soldul fondului este deja cunoscut de la ultimul incarca()
       (ctx.fonduriSold), deci se poate verifica fara nicio cerere in plus.
       Existenta fondului si dreptul de a-l atinge raman verificate doar in
       RPC: astea chiar nu se pot verifica ieftin, fara o cerere la server. */
    async inregistreazaIesireFond({ fondId, suma, descriere, data, fisier }) {
      if (!fisier) throw new Error("Alege documentul care justifica iesirea din fond.");
      const sumaNoua = numarSauNull(suma);
      if (sumaNoua == null || !(sumaNoua < 0)) throw new Error("Suma unei iesiri din fond este negativa: scrie cat au iesit din fond.");
      if (!(descriere || "").trim()) throw new Error("Scrie pentru ce au iesit banii din fond.");
      if (!data || data > aziIso()) throw new Error("Data iesirii din fond nu poate fi in viitor.");
      const soldCunoscut = cerCtx().fonduriSold[fondId];
      if (soldCunoscut != null && round2(soldCunoscut + sumaNoua) < 0) {
        throw new Error(`Fondul are ${soldCunoscut.toFixed(2)} lei; o iesire de ${(-sumaNoua).toFixed(2)} lei l-ar duce pe minus.`);
      }
      const doc = await document({ titlu: descriere.trim(), tip: "factura", fisier });
      return ok(fin.rpc("inregistreaza_iesire_fond", {
        p_fond_id: fondId, p_suma: sumaNoua, p_descriere: descriere, p_data: data, p_document_id: doc.id,
      }));
    },

    invitaLocatar: (apartamentId, calitate) => ok(id.rpc("invita_locatar", { p_apartament_id: apartamentId, p_calitate: calitate })),
    inchideAcces: (locatarId) => ok(id.rpc("inchide_acces_locatar", { p_locatar_id: locatarId })),
    valideazaCitire: (citireId, accepta, motiv) => ok(cont.rpc("valideaza_citire", { p_citire_id: citireId, p_accepta: accepta, p_motiv: motiv })),
    /* [A5] Un singur apel valideaza sau respinge, dintr-o data, toate citirile
       "trimise" ale apartamentului pe acea luna: nu ramane nimic pe jumatate
       validat daca reteaua pica intre doua apeluri pe contor. */
    valideazaCitiriApartament: (apartamentId, l, accepta, motiv) => ok(cont.rpc("valideaza_citiri_apartament", {
      p_apartament_id: apartamentId, p_luna: zi1(l), p_accepta: accepta, p_motiv: motiv,
    })),
    citesteContorGeneral: (l, tip, index) => ok(cont.rpc("citeste_contor_general", { p_bloc_id: cerCtx().blocId, p_luna: zi1(l), p_tip: tip, p_index: index })),

    async estimeazaCitiri(l) {
      const n = await ok(cont.rpc("estimeaza_citiri", { p_bloc_id: cerCtx().blocId, p_luna: zi1(l) }));
      return { estimate: n };
    },

    preiaSesizare: (sid) => ok(ses.rpc("preia_sesizare", { p_sesizare_id: sid })),
    rezolvaSesizare: (sid) => ok(ses.rpc("rezolva_sesizare", { p_sesizare_id: sid })),
    publicaAnunt: ({ titlu, corp, urgent }) => ok(com.rpc("publica_anunt", { p_bloc_id: cerCtx().blocId, p_titlu: titlu, p_corp: corp, p_urgent: !!urgent })),
    seteazaReminder: (tip, activ, zile) => ok(com.rpc("seteaza_reminder", { p_asociatie_id: cerCtx().asociatieId, p_tip: tip, p_activ: activ, p_zile: zile })),
    trimiteReminder: (tip) => ok(com.rpc("trimite_reminder", { p_bloc_id: cerCtx().blocId, p_tip: tip })),

    deschideVot: ({ titlu, descriere, optiuni, inchideLa, numarare }) => ok(guv.rpc("deschide_vot", {
      p_asociatie_id: cerCtx().asociatieId, p_titlu: titlu, p_descriere: descriere, p_optiuni: optiuni,
      p_inchide_la: new Date(oraSeriiRomania(inchideLa)).toISOString(), p_numarare: numarare,
    })),

    reamintesteVot: (votId) => ok(guv.rpc("reaminteste_vot", { p_vot_id: votId })),
    convoacaAdunare: ({ dataOra, loc, ordineDeZi }) => ok(guv.rpc("convoaca_adunare", {
      p_asociatie_id: cerCtx().asociatieId, p_data_ora: dataOra, p_loc: loc, p_ordine_de_zi: ordineDeZi,
    })),

    async incarcaDocument({ titlu, tip, fisier, vizibil }) {
      if (!fisier) throw new Error("Alege fisierul.");
      await document({ titlu: titlu.trim(), tip, fisier, vizibil });
    },
  };
}
