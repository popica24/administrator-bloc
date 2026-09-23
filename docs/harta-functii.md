# Harta functiilor AdminBloc

Tot ce face aplicatia, pe roluri si ecrane, cu regulile de business si locul din cod unde sta
fiecare functie. Starea la 2026-09-20, pe ramura `supabase-administratii-locale`.

Cum se citeste:
- **UI** = componenta din `src/AdminBloc.jsx`; **Comanda** = metoda din `src/sursa-supabase.js`
  (aceeasi in `src/sursa-mock.js`); **Backend** = functia SQL (`schema.functie`) sau Edge Function.
- Pentru fiecare functie scrie ce face, cine o poate folosi, ce reguli verifica si ce declanseaza
  mai departe.
- Sectiunea 9 aduna ce exista in schema, dar nu are inca ecran sau comanda.

---

## Cuprins

1. [Harta de ansamblu](#1-harta-de-ansamblu)
2. [Autentificare si acces](#2-autentificare-si-acces)
3. [Locatar](#3-locatar)
4. [Administrator](#4-administrator)
5. [Motorul de repartizare](#5-motorul-de-repartizare)
6. [Banii: registrul financiar](#6-banii-registrul-financiar)
7. [Procese automate](#7-procese-automate)
8. [Operatiuni ale dezvoltatorului](#8-operatiuni-ale-dezvoltatorului)
9. [Declarat, dar neterminat](#9-declarat-dar-neterminat)
10. [Infrastructura transversala](#10-infrastructura-transversala)
11. [Index: comanda din UI → backend](#11-index-comanda-din-ui--backend)

---

## 1. Harta de ansamblu

```
AdminBloc
├── Autentificare (EcranAutentificare, EcranFaraAcces)
│   ├── Intrare cu numar de telefon + parola
│   ├── Conducere (presedinte, cenzor): ecranele administratorului, doar citire
│   └── Cont fara apartament: asteapta sa fie legat de administrator
│
├── LOCATAR (5 taburi)
│   ├── Acasa ─────── sold de plata, mesaje noi, "De facut", avizier, consum vs. bloc, sesizarile mele, contacte
│   ├── Plata ─────── lista de plata in 3 trepte + RandLista, cum platesti, verificarea repartitiei,
│   │                 istoric lunar, platile mele cu chitante PDF
│   ├── Contoare ──── transmitere index cu poza, corectare, istoric consum, explicatia diferentei pe coloana
│   ├── Sesizari ──── sesizare noua (rapida / libera, pana la 3 poze), conversatie, sesizarile blocului (anonim)
│   └── Bloc ──────── Avizier · Vot si adunare · Acte · Fonduri
│
├── ADMINISTRATOR (5 taburi)
│   ├── Sumar ─────── incasari pe lista curenta, KPI, lista in lucru, facturi de platit furnizorilor,
│   │                 restantieri, actiuni rapide, export PDF
│   ├── Apartamente ─ Fise (cautare, filtre, fisa apartamentului) · Citiri contoare (validare, contor general, estimare) · Fonduri (solduri, miscari, iesiri cu document)
│   ├── Facturi ───── lista lunara: ciorna → facturi → previzualizare → publicare; plata catre furnizori; export
│   ├── Sesizari ──── triere (noua → in lucru → rezolvata), raspuns, timp de asteptare
│   └── Comunicare ── Anunturi · Remindere · Vot si AG · Acte
│
├── AUTOMAT (backend)
│   ├── Publicarea listei → motor.js → repartizari salvate → datorii + fond reparatii + notificari
│   ├── Plata → alocare pe cea mai veche datorie → chitanta cu numar fara goluri → notificare
│   ├── Penalizari lunare (pg_cron, pe 1 ale lunii)
│   ├── Remindere zilnice (pg_cron, ora 9)
│   └── Coada de evenimente de domeniu (webhook pg_net + pg_cron la fiecare minut)
│
└── DEZVOLTATOR (service role)
    ├── creeaza-asociatie, aprobarea administratorilor
    ├── inrolarea unui bloc de pe hartie + activarea blocului
    ├── recalcularea unei liste publicate
    └── exporta-bloc (JSON)
```

**Doua surse de date, aceeasi interfata** (`src/sursa.js`): Supabase cand exista
`VITE_SUPABASE_URL` si `VITE_SUPABASE_ANON_KEY`, altfel modul demonstrativ din memorie
(`src/sursa-mock.js` care rejoaca `src/date-demo.js`), resetat la reincarcare. Pe ecranul de
autentificare, modul demonstrativ afiseaza conturile de test.

---

## 2. Autentificare si acces

### 2.1 Intrare in cont
- **UI:** `EcranAutentificare`: numarul de telefon si parola. Butonul se deblocheaza doar la un
  numar romanesc intreg (10 cifre, `07`/`02`/`03`), scris oricum: cu spatii, cu puncte sau cu
  `+40` (`supabase/functions/_shared/telefon.js`).
- **Comanda:** `intra(telefon, parola)` → Supabase Auth `signInWithPassword`, apoi `incarca()`.
- **De ce o adresa interna:** intrarea cu telefon in Supabase Auth cere un furnizor de SMS, iar
  aplicatia nu trimite niciun SMS. Fiecare cont are o adresa facuta din numarul lui
  (`0722123456@telefon.adminbloc.ro`), pe care omul nu o vede si nu o scrie niciodata.
- **Rolul** il decide `identitate.eu()`, in aceasta ordine de prioritate:
  1. `administrator`: administrator aprobat, cu mandat activ pe o asociatie. Blocul lui este cel
     mai vechi bloc nearhivat al asociatiei.
  2. `locatar`: are o legatura activa cu un apartament.
  3. `in_asteptare` sau `respins`: are un rand in `identitate.administratori`.
  4. `fara_apartament`: altfel.

### 2.2 Contul locatarului, facut de administrator
- **UI:** fisa apartamentului → "Adauga un locatar in aplicatie": numele, numarul de telefon si
  calitatea (proprietar, chirias, membru al familiei).
- **Flux:** `adaugaLocatar()` → Edge Function `cont-locatar`, care:
  1. verifica dreptul pe apartament cu tokenul administratorului
     (`identitate.apartament_de_administrat`);
  2. daca numarul are deja cont (acelasi om, al doilea apartament), il leaga si de apartamentul
     acesta si raspunde fara parola;
  3. altfel creeaza contul in Auth (adresa interna din numar, parola generata de
     `_shared/parola.js`: doua cuvinte romanesti si patru cifre, citibile la telefon) si il leaga
     cu `identitate.leaga_locatar` (doar cheia de serviciu). Daca legarea cade, contul nou se
     sterge, ca numarul sa ramana liber.
- **Parola** se vede o singura data, pe ecranul administratorului; el o da omului cum stie (pe
  hartie, la telefon). Nu se trimite niciun SMS si niciun email.
- **Parola uitata:** butonul "Parola noua" de pe fiecare locatar → aceeasi functie, cu
  `actiune: "parola"`.

### 2.3 Contul administratorului
- Il facem noi: Edge Function `creeaza-asociatie` (asociatie noua cu primul ei administrator, pe
  numar de telefon) sau, pentru un administrator in plus, cheia de serviciu plus
  `identitate.numeste_administrator` (§8.2). Nimeni nu isi face singur cont.

### 2.4 Conducerea asociatiei: presedinte si cenzor
- **Cine ii numeste:** adunarea generala ii alege; administratorul trece hotararea in aplicatie
  (Comunicare → Conducere). `numesteInConducere(profilId, rol)` →
  `identitate.numeste_in_conducere`; pentru cineva din afara blocului (un cenzor contabil),
  `adaugaInConducere(nume, telefon, rol)` → Edge Function `cont-locatar` cu
  `actiune: "conducere"`, care face contul si apoi mandatul.
- **Mandatul** se incheie cu `incheieMandat(id)` → `identitate.incheie_mandat`, care scrie
  `activ_pana` cu data reala, ca la `inchide_acces_locatar`: un mandat incheiat azi nu mai da
  niciun drept azi [C6]. Randul nu se sterge, iar o realegere este un rand nou, cu perioada lui
  [C7], deci ecranul arata toate mandatele omului, nu doar ultimul.
- **Cine nu poate fi numit:** administratorul asociatiei [C8] (el este cel verificat) si nimeni cu
  data de inceput in viitor [C12]. Asociatia in care intra mandatul o spune ecranul
  (`p_asociatie_id`), iar `identitate.asociatia_de_administrat()` o verifica — aceeasi asociatie
  pe care o arata `eu()` [C5].
- **Ce vad:** tot blocul, cu ecranele administratorului (`identitate.eu()` le da rolul, iar
  `private.blocuri_supravegheate()` dreptul de citire). Nu scriu nimic: comenzile cer
  `private.blocuri_administrate()`, iar ecranele nu le arata butoanele (steagul `doarVerifica`).
  Asa ramane separat cel care tine banii de cel care il verifica.
- **Sesizarile fac exceptie** [C1]: ce scrie un om despre casa lui ramane intre el si
  administrator (migratia H11). Conducerea le vede anonim, ca orice locatar (titlu, categorie,
  stare), iar ecranul spune de ce nu vede mai mult.
- **Un presedinte care sta in bloc** ramane si locatar [C2]: `eu()` ii da rolul de conducere *si*
  apartamentul lui, aplicatia porneste in ecranele lui de locatar (index, sesizare, vot), iar
  verificarea blocului se deschide din tabul Bloc, cu butonul "Verifica blocul", si se inchide cu
  "Inapoi la apartamentul meu". Cine nu are apartament in bloc (un cenzor contabil din afara)
  vede direct panoul.

### 2.5 Cont fara apartament
- **UI:** `EcranFaraAcces`: "Contul nu este legat de un apartament", cu indrumarea catre
  administratorul blocului si, cand exista, motivul respingerii unei cereri de administrator.

### 2.6 Iesire
- `BaraSus` → "Iesi" → `iesi()` (signOut doar pe dispozitivul curent, starea se goleste).

### 2.7 Pagina publica "Cum functioneaza AdminBloc" (`cum-functioneaza/`)
- **Unde:** `/cum-functioneaza/`, a doua pagina a site-ului, fara cont. Build-ul are doua intrari
  (`vite.config.js`): aplicatia si pagina aceasta.
- **Ce arata:** lista de intretinere pe ultima luna publicata a blocului demonstrativ, calculata in
  pagina cu sursa demo si motorul real; orice suma se deschide in socoteala ei, pe baza pe care a
  pastrat-o motorul. Sub ea: verificarea "facturi = impartit", principiul aplicatiei, pasii unei
  luni, ce vede fiecare rol, datele oamenilor si stadiul proiectului.
- **Continut:** explicatiile pe roluri vin din `src/ghid.js`.
- **Nu face parte din aplicatie:** HTML si CSS simplu (`src/pagina-publica.jsx`,
  `src/pagina-publica.css`), deci regula de portabilitate spre React Native nu i se aplica.

## 3. Locatar

### 3.1 Acasa (`LocatarAcasa`)

| Bloc de continut | Ce arata | Date / reguli |
|---|---|---|
| **De plata acum** | Soldul apartamentului, cu badge "Achitat", "Mai ai N zile", "Scadent azi" sau "Termen depasit" | Soldul este suma resturilor din datoriile deschise (`financiar.datorii_rest`), calculat, niciodata stocat. Textul explica procentul de penalizare si zilele de gratie. |
| Butoane | "Cum platesc" (duce la Plata, la instructiunile de plata), "De unde vine suma"; daca totul e achitat, "Descarca ultima chitanta" | |
| **Fraza de comparatie** | "Intretinerea pe X este A. Pe Y a fost B, deci luna aceasta platesti cu Z mai mult/putin." | `frazaComparatie()` pe ultimele doua liste publicate; duce la "Platile mele" |
| **Mesaje noi** | Pana la 3 notificari necitite, cu "Am citit" | `comunicare.notificari`; `marcheaza_notificare_citita`. Instiintarile de restanta apar cu rosu. |
| **De facut** | Sarcini: transmite indexul (sau retrimite-l, daca a fost respins), plateste, voteaza, confirma prezenta la AG; "Nimic de facut acum" cand nu e nimic | Termenul de citire este ziua `zi_limita_citire` din luna curenta |
| **De la avizier** | Ultimele 2 anunturi, cu badge Urgent / Nou | |
| **Consumul tau fata de bloc** | Apa rece pe persoana: apartamentul tau fata de media blocului | `contorizare.consum_mediu_bloc` intoarce media fara sa expuna randurile altor apartamente |
| **Sesizarile tale** | Sesizarile deschise, cu ultimul raspuns al administratiei | |
| **Pe cine suni** | Contactele (administrator, presedinte, cenzor, urgente lift), cu buton `tel:` | `organizare.contacte_asociatie` |

Badge-ul de pe tabul Acasa numara notificarile necitite.

### 3.2 Plata (`LocatarPlata`)

Doua subtaburi: **Lista de plata** si **Platile mele**.

**Lista de plata**
- **Alegerea lunii** (`AlegeLuna`): butoane cand sunt pana la 4 liste publicate, lista derulanta
  cand sunt mai multe.
- **Cardul de total**, in trei trepte (`defalcare()`):
  1. **Cheltuielile lunii**, grupate: Apa (C1, C2); Curent, lift si curatenie (C3–C6, C8);
     Administrarea blocului (C7); Alte cheltuieli.
  2. **Fonduri**: contributia la fondul de reparatii.
  3. **Datorii din lunile trecute**, doar pentru lista curenta: intretinerea neplatita (cu zilele
     de intarziere si link la lista de pe hartie cand restanta a fost preluata de acolo) si
     penalizarile, fiecare cu formula `rest × procent × zile taxate`.
  - Ce s-a platit deja din lista curenta se scade. Pentru lista curenta, totalul este exact
    soldul apartamentului.
- **RandLista, elementul central.** Fiecare rand se desface si arata calculul complet:
  - *consum*: contorul general, suma contoarelor, diferenta pe coloana, pretul pe mc
    (factura ÷ contorul general), consumul propriu, cota din diferenta pe persoane, apoi
    `(consum + cota) × pret`;
  - *celelalte metode*: suma de repartizat, baza blocului, baza apartamentului, apoi
    `suma × baza ap. ÷ baza bloc`;
  - note speciale: consum estimat, scutit de lift, rotunjirea la ban adaugata acestui apartament;
  - documentul justificativ: furnizorul, seria facturii si butonul "Vezi documentul" (URL semnat,
    valabil 10 minute);
  - procentul din cheltuiala care revine apartamentului.
- **Cum platesti** (`CardCumPlatesti`), cat timp apartamentul are ceva de plata: incasarea in
  numerar la administrator (contactul si programul lui din `organizare.contacte`) si datele pentru
  transfer bancar (IBAN-ul, banca si denumirea asociatiei, plus apartamentul de scris la detalii).
  Chitanta vine dupa ce administratorul inregistreaza banii.
- **Verificarea repartitiei**: totalul facturilor fata de totalul repartizat pe apartamente, cu
  diferenta 0. Este dovada ca "nimic nu ramane nealocat si nimic nu se plateste de doua ori".

**Platile mele**
- Fraza de comparatie, grafic cu bare pe ultimele 6 luni (`BareLunare`), apoi fiecare luna cu
  totalul si badge Achitat/Neachitat.
- Fiecare plata confirmata apare cu ce a acoperit (`descriereAlocari`: intretinerea pe luna X,
  penalizarea, avansul), data, metoda, numarul chitantei si butonul "Descarca chitanta" (PDF generat
  local cu `src/pdf.js`).

### 3.3 Contoare (`LocatarConsum`)
- **Transmiterea indexului** pentru luna curenta, pe fiecare contor (rece si calda):
  - validari in formular: doar cifre; indexul nu poate fi mai mic decat cel anterior; un consum
    peste 60 mc produce un avertisment;
  - **poza este obligatorie**. Se micsoreaza local la 1600 px JPEG (`micsoreazaPoza`), pentru ca
    bucket-ul `poze` accepta cel mult 1 MB;
  - **Backend:** `contorizare.transmite_citire`. Accepta doar luna curenta si doar contoarele
    active ale apartamentului, refuza un index mai mic decat cel anterior si refuza daca citirea a
    fost deja validata. O retrimitere inlocuieste citirea `trimisa`. Emite `CitireTransmisa`.
- **Stari:** Trimis, in verificare → Validat; Respins (cu motivul administratorului, si locatarul
  poate retrimite); Estimat; Index de pornire.
- **Corectarea** unui index trimis si nevalidat este posibila pana la termen.
- **Evolutia consumului:** grafic pe ultimele 8 luni, rece sau cald, cu consumul pe persoana
  alaturi de media blocului.
- **Istoric:** indexurile pe fiecare luna, cu starea fiecaruia.
- **"De ce plateste blocul mai multa apa decat arata contoarele":** explicatia diferentei pe
  coloana, cu cifrele din ultima repartizare a apei reci.

### 3.4 Sesizari (`LocatarSesizari`)
- **Sesizare noua**:
  - 7 sesizari rapide gata scrise ("Bec ars pe scara", "Liftul nu merge", …) care completeaza
    titlul si categoria dintr-un singur apasat;
  - sau text liber, categoria (instalatii, iluminat, acces, curatenie, altele), o descriere
    optionala si pana la 3 poze micsorate;
  - **Backend:** `sesizari.adauga_sesizare`. Doar pentru apartamentul propriu; o descriere goala
    devine titlul; se pastreaza doar pozele din folderul `<bloc>/<apartament>/`. Emite
    `SesizareDeschisa`.
- **Ale mele:** conversatia cu administratia si un camp de mesaj cat timp sesizarea nu e rezolvata
  (`sesizari.scrie_mesaj`).
- **Din tot blocul:** sesizarile altor apartamente, **fara autor si fara apartament**, ca omul sa
  nu scrie de doua ori despre acelasi lucru. Contine sesizarile deschise si cele rezolvate in
  ultimele 30 de zile (`sesizari.sesizari_bloc`).
- Badge-ul de pe tab numara sesizarile proprii nerezolvate.

### 3.5 Bloc (`LocatarBloc`)

| Subtab | Functii |
|---|---|
| **Avizier** | Anunturile, cu Urgent, data si autorul. Afisarea tabului le marcheaza citite (`comunicare.marcheaza_anunt_citit`). Dedesubt, contactele. Badge-ul de pe tab numara anunturile necitite. |
| **Vot si adunare** | **Voturile deschise**: alegerea variantei, apoi o confirmare ("Votul nu se mai poate schimba"), prin `guvernanta.voteaza` (un vot pe apartament, doar in fereastra deschisa). Dupa vot, rezultatele live. **Adunarile viitoare**: data, locul, ordinea de zi, cate apartamente au confirmat, butonul "Confirm ca particip" (`guvernanta.confirma_prezenta`, doar inainte de adunare). **Voturile inchise**, cu rezultatele: procent pe varianta, numar de voturi si, la numararea pe cota, procentul din cote. |
| **Acte** | Documentele asociatiei vizibile locatarilor (facturi, contracte, procese verbale, regulament). Se deschid prin URL semnat. |
| **Fonduri** | Soldul fondului de reparatii si al fondului de rulment. **"Unde s-au dus banii"**: fiecare intrare si iesire, cu documentul ei. **Situatia incasarilor la nivel de bloc, fara nume**: cate apartamente sunt fara restanta si totalul restantelor (`financiar.situatie_bloc`). |

---

## 4. Administrator

### 4.1 Sumar (`AdminSumar`)
- **Lista de plata curenta:** suma de incasat, cat s-a incasat (bara si procent), cate
  apartamente au platit integral.
  - "Trimite reminder de plata" (`comunicare.trimite_reminder('plata')`): toast cu numarul de
    destinatari si de apartamente cu sold.
  - "Exporta lista PDF" (§4.3).
- **KPI:** Restante (duce la Apartamente filtrate pe restanta), Penalizari neachitate, Citiri de
  verificat (duce la Citiri), Sesizari deschise, Fondul de reparatii.
- **Lista in lucru:** cate cheltuieli are ciorna lunii urmatoare.
- **Facturi de platit catre furnizori:** facturile listelor publicate fara `achitata_furnizor_la`,
  cu scadenta furnizorului.
- **Restantieri**, cel mai vechi datornic primul: zilele de intarziere, penalizarile si butonul
  "Instiintare" (`comunicare.trimite_instiintare`). Daca apartamentul nu are cont, toastul spune
  ca instiintarea se da pe hartie.
- **Actiuni rapide:** Adauga factura, Inregistreaza incasare, Scrie un anunt, Deschide un vot.

### 4.2 Apartamente (`AdminApartamente`)

**Subtab Apartamente** (`ListaApartamente`)
- Cautare dupa nume sau numar; filtrele Toate / Cu sold / Restante; fiecare rand arata totalul
  lunii si o stare colorata (restanta, achitat, in termen).

**Fisa apartamentului** (`FisaApartament`):

| Sectiune | Ce contine |
|---|---|
| Date | Proprietar, etaj, persoane, cota indiviza, suprafata, lift (scutit sau plateste) |
| **Sold la zi** | Fiecare datorie deschisa: tipul (intretinere, penalizare, restanta preluata, fond de rulment, corectie), scadenta, restul. Cele scadente apar colorate. |
| **Confirma banii primiti** | Cum au venit banii (in numerar sau prin transfer bancar) si suma (implicit, soldul) → `financiar.inregistreaza_incasare`. Banii se aloca automat pe cea mai veche datorie si chitanta se emite imediat, cu PDF descarcabil. |
| **Instiintare de plata** | Activa doar cand apartamentul are restanta |
| **Numarul de persoane** | Numarul nou, luna de la care se aplica (luna curenta sau urmatoarele doua, fara lunile deja folosite) si motivul. Se insereaza direct in `organizare.apartamente_persoane`; RLS cere `valabil_din` ≥ luna curenta. Listele publicate nu se schimba. |
| **Invita un locatar** | Calitatea (proprietar, chirias, membru al familiei) → `identitate.invita_locatar` → codul de 8 caractere afisat mare, valabil 30 de zile |
| **Corecteaza datele apartamentului** | Proprietar, etaj, suprafata, scutirea de lift si corectii mici de cota → `organizare.schimba_fisa_apartament`. Pe un bloc activ, o cota se accepta doar cat timp suma blocului ramane 100%. |
| **Redistribuie cotele blocului** | Editor cu cota fiecarui apartament si totalul la vedere; salvarea e blocata pana cand suma este 100% → `organizare.schimba_cotele_blocului`. Listele deja publicate nu se schimba: repartizarile lor au bazele inghetate. |
| Defalcarea lunii | Aceleasi `RandLista` pe care le vede locatarul |
| Consum apa | Ultimele 3 luni si starea citirii din luna curenta |
| Istoricul persoanelor | Fiecare schimbare, cu luna si motivul |
| **Locatari cu cont** | Nume, calitate, de cand, telefon; "Inchide accesul" (`identitate.inchide_acces_locatar`, istoricul ramane); codurile nefolosite; accesele inchise |

**Subtab Fonduri** (`AdminFonduri`)
- Soldul fiecarui fond si toate miscarile lui, cu documentul fiecareia, in acelasi format pe
  care il vede locatarul la Bloc → Fonduri.
- **"Inregistreaza o iesire"**: suma scrisa pozitiv (se scade din fond), motivul, data si un
  document obligatoriu → `financiar.inregistreaza_iesire_fond`. Soldul nu poate trece sub zero.
  Este singura cale prin care ies bani dintr-un fond; intrarile vin automat, la publicarea
  listei.

**Subtab Citiri contoare** (`AdminCitiri`)
- Alegerea lunii; KPI Transmise si De verificat.
- **Contorul general al blocului** (rece si cald): indexul nou sau corectat, prin
  `contorizare.citeste_contor_general`. Citirea intra direct ca `validata`.
- **Estimeaza citirile lipsa** (`contorizare.estimeaza_citiri`): pentru contoarele fara citire,
  consumul este media ultimelor 3 luni validate (0 daca nu exista istoric). Citirea apare ca
  "Estimat" si pe lista locatarului.
- **Pe fiecare apartament:** indexul anterior → indexul curent, consumul, starea, poza (URL semnat)
  si butoanele Valideaza / Respinge (`contorizare.valideaza_citiri_apartament`, o singura comanda
  pentru toate contoarele apartamentului pe acea luna: ori trec toate, ori niciunul, si nicio
  citire nu se mai verifica pe o luna deja publicata). Respingerea cere un motiv (3
  motive predefinite sau text liber), iar locatarul primeste notificare.
- Badge-ul de pe tab numara citirile `trimisa`.

### 4.3 Facturi si liste (`AdminFacturi`)

Ciclul de viata al unei liste lunare: **ciorna → publicata**.

1. **Incepe lista** pe luna urmatoare ultimei liste (`intretinere.deschide_lista`). Operatia se
   poate repeta fara efecte duble. Lista porneste cu fondul de reparatii din
   `cheltuieli_recurente`.
2. **Factura noua / modifica** (`SheetFactura`):
   - furnizorul: ales din lista, cu categoria, metoda, tipul de apa si codul completate din
     implicitele lui, sau un furnizor nou;
   - categoria, suma, codul pe lista (implicit primul cod liber de la C10; dublurile sunt
     refuzate), metoda de repartizare cu explicatia ei, tipul de apa la metoda consum;
   - seria facturii, data emiterii, scadenta furnizorului, factura scanata (imagine micsorata sau
     PDF, in bucket-ul `documente`);
   - **previzualizare pe loc**: `motor.js` ruleaza in browser pe `date_pentru_motor` si arata cat
     revine fiecarui apartament, fara sa salveze nimic;
   - salvarea scrie direct in `intretinere.cheltuieli`; RLS permite asta doar cat lista e ciorna.
3. **Sterge sau modifica** o cheltuiala, doar in ciorna.
4. **Starea citirilor**, cand lista are apa pe consum: "Citiri validate: N din M apartamente.
   Contorul general: citit/necitit."
5. **Previzualizarea listei:** totalul pe fiecare apartament si totalul repartizat fata de totalul
   facturilor. Daca datele sunt incomplete, afiseaza problemele gasite de `verificaDate`.
6. **Publica lista:** o confirmare arata termenul de plata (ziua `zi_scadenta` din luna urmatoare).
   Apoi Edge Function `publica-lista` (§7.1). Dupa publicare, sumele sunt inghetate.
7. **Lista publicata:** totalul facturilor, totalul repartizat si "Nealocat" (0).
   - **Marcheaza platita** sau **Anuleaza plata furnizor** (`intretinere.marcheaza_factura_platita`)
     este singura modificare permisa dupa publicare.
   - **Exporta PDF pentru avizier** (`listaPdf`): landscape, un rand pe apartament si o coloana pe
     cheltuiala, ca foaia de hartie. **Fara nume si fara restante**: la avizier ajung numarul
     apartamentului, coloanele de cheltuieli si totalul lunii. Legenda arata fiecare cod,
     furnizorul si metoda.
   - **Exporta lista interna** (`listaPdfIntern`): aceleasi cifre, plus proprietarul, persoanele,
     restantele, penalizarile si totalul de plata. Este pentru administratie, nu pentru avizier;
     fisierul se numeste ca atare.

### 4.4 Sesizari (`AdminSesizari`)
- Filtrele Deschise (cele mai vechi primele) / Rezolvate / Toate.
- Fiecare sesizare arata apartamentul, categoria, data si **"Asteapta de N zile"**, cu rosu dupa
  3 zile.
- **Detaliu:** descrierea, datele de preluare si rezolvare, pozele, conversatia, raspunsul
  administratiei.
  - `scrie_mesaj`: un raspuns trece automat sesizarea din `noua` in `in_lucru` si notifica
    locatarul.
  - "Preiau sesizarea" (`preia_sesizare`).
  - "Marcheaza rezolvata" (`rezolva_sesizare`, cu notificare). O sesizare rezolvata nu mai
    primeste mesaje.
- Badge-ul de pe tab numara sesizarile `noua`.

### 4.5 Comunicare (`AdminBlocEcran`)

| Subtab | Functii |
|---|---|
| **Anunturi** | Anunt nou: titlu, continut, optiunea urgent (`comunicare.publica_anunt`). Un anunt urgent trimite imediat notificare tuturor locatarilor cu cont. Pe fiecare anunt: "Citit de X din Y locatari cu cont", cu bara. |
| **Remindere** | Cele 5 remindere (tabelul de mai jos), fiecare cu un comutator si numarul de zile (1, 3, 5, 7, 10, 15 sau 30), prin `seteaza_reminder`. **Trimite acum**: reamintirea de citire, de plata si instiintarea restantierilor (`trimite_reminder`). |
| **Vot si AG** | Vot nou: titlu, detalii, 2–5 variante, data inchiderii, numararea pe apartament sau ponderata cu cota (`guvernanta.deschide_vot`, care notifica toata asociatia). Pe fiecare vot: rezultatele, prezenta, **lista apartamentelor care nu au votat** (vizibila doar conducerii) si "Reaminteste celor care nu au votat" (`reaminteste_vot`). Convocarea AG: data, ora, locul, ordinea de zi (`convoaca_adunare`, cu notificare). |
| **Acte** | Incarcarea unui document: titlu, tip (lista de plata, raport, proces verbal, contract, regulament, factura, altul), fisier, vizibil locatarilor sau doar administratiei. Lista actelor are badge Public / Doar admin. |

**Reminderele**

| Tip | Cand pleaca automat | Destinatari |
|---|---|---|
| `lista_publicata` | La publicarea listei (eveniment) | Toti locatarii blocului |
| `citire_contoare` | Cu N zile inainte de `zi_limita_citire` | Apartamentele fara citire in luna curenta |
| `plata` | Cu N zile inainte de scadenta | Apartamentele cu orice datorie deschisa |
| `restanta` | La N zile dupa scadenta | Apartamentele cu datorii scadente |
| `adunare_generala` | Cu N zile inainte de AG (oprit implicit) | Locatarii blocului |

---

## 5. Motorul de repartizare

`supabase/functions/_shared/motor.js`: JavaScript pur, acelasi cod in browser (previzualizare) si
in Deno (`publica-lista`). **Este singurul loc unde se calculeaza cat plateste un apartament.**

| Metoda | Baza apartamentului / baza blocului |
|---|---|
| `persoane` | persoanele apartamentului / toate persoanele |
| `persoane_fara_lift` | 0 daca apartamentul e `scutit_lift`, altfel persoanele / persoanele apartamentelor nescutite |
| `apartamente` | 1 / numarul de apartamente |
| `cota` | cota / suma cotelor (DB-ul nu activeaza un bloc cu suma ≠ 100) |
| `consum` | `pretMc = factura ÷ contorul general`; `diferenta = contorul general − suma contoarelor`; `cotaDiferenta = diferenta × persoanele ap. ÷ toate persoanele`; `suma = (consumul propriu + cotaDiferenta) × pretMc` |

- **Rotunjirea:** fiecare parte se rotunjeste la ban. Restul (factura − suma partilor) merge la
  apartamentul cu partea cea mai mare si se salveaza in `rotunjire`, iar locatarul il vede explicat
  in `RandLista`.
- **Verificari inainte de calcul** (`verificaDate`): exista apartamente, metoda e cunoscuta, suma e
  pozitiva, tipul de apa e completat, contorul general are citire, fiecare apartament are citire.
- **Iesire:** un rand pe cheltuiala × apartament, inclusiv randurile cu 0, fiecare cu `baza` si
  `detaliu`, adica tot ce afiseaza `RandLista`.
- **Consumul** vine din `contorizare.consum_validat`: doar citiri validate, fara indexurile de
  pornire.

---

## 6. Banii: registrul financiar

Principiu: **un registru in care doar se adauga.** Nu exista o coloana `sold`; soldul se
calculeaza din datorii minus plati (`financiar.datorii_rest`, `financiar.solduri`).

### 6.1 Datorii
- **Tipuri:** `intretinere` (una pe lista si apartament, la publicare), `penalizare`,
  `sold_initial` (restanta preluata de pe hartie, cu documentul ei), `corectie` (dupa o
  recalculare, poate fi negativa), `fond_rulment` (declarat, dar negenerat),
  `anulare_penalizare` (negativa, legata prin `anuleaza_datorie_id` de penalizarea pe care o
  reduce; nu are rest propriu, ci se scade din restul penalizarii).
- Fiecare operatie pe bani blocheaza contul apartamentului (`financiar.conturi`, `for update`),
  asa ca platile simultane se executa pe rand.

### 6.2 Alocarea platilor
- `aloca_plata`: suma primita acopera datoriile in ordinea `scadenta, creat_la`, deci **intai cea
  mai veche**, cu penalizari cu tot.
- Ce ramane este **avans**. `aloca_avansuri` il muta automat pe fiecare datorie noua.
- Chitanta si ecranul "Platile mele" arata alocarea in cuvinte.

### 6.3 Plata cu cardul: nu exista
Banii ajung la asociatie in numerar, in mana administratorului, sau prin transfer in contul ei;
administratorul confirma incasarea in aplicatie (§6.4). Nu exista procesator de plati, Edge
Function de plata sau webhook: lantul lor a fost scos cu totul (migratia
`scoate_plata_cu_cardul`), iar `financiar.plati` nu mai are nici coloanele procesatorului, nici
starile `in_asteptare` / `esuata`.

### 6.4 Confirmarea banilor primiti (numerar sau transfer)
- `inregistreaza_incasare`: doar administratorul blocului, si doar cu metoda `numerar` sau
  `transfer`. Plata se inregistreaza direct
  `confirmata`, cu `inregistrata_de`, si trece prin aceeasi alocare, chitanta si notificare.

### 6.5 Chitante
- Numerotare **fara goluri** pe asociatie: `setari_financiare.chitanta_ultimul_numar` se
  incrementeaza cu blocare in aceeasi tranzactie. Formatul este `SERIE nr. 000123`.
- PDF-ul se genereaza in browser (`chitantaPdf` → `src/pdf.js`, PDF 1.4 fara librarii). Contine
  datele asociatiei, platitorul, alocarea si modalitatea de plata.

### 6.6 Penalizari
- Job `calculeaza-penalizari`, pe 1 ale lunii la 00:05.
- Formula: `min(rest, round(rest × procent_zi/100 × zile_taxate, 2))`. Zilele taxate incep dupa
  `scadenta + zile_gratie` (implicit 30) sau de la ultimul calcul pentru aceeasi datorie.
- **Nu se capitalizeaza:** penalizarile nu genereaza penalizari. **Nu depasesc datoria.**
- Parametrii folositi se ingheata in `financiar.penalizari`. Locatarul vede formula cu cifrele lui.
- Valorile implicite sunt 0,02% pe zi, 30 de zile de gratie si scadenta pe 25.
- **Recalcularea in jos anuleaza penalizarea in plus** (K7, varianta A): cand o recalculare a
  listei scade datoria, fiecare penalizare calculata pe ea se reface cu parametrii ei inghetati,
  pe datoria corectata, ca si cum lista ar fi fost corecta de la inceput. Diferenta intra in
  registru ca `anulare_penalizare` (`financiar.anuleaza_penalizari_in_plus`), iar platile alocate
  pe partea anulata se elibereaza si se realoca. Doar in jos: o corectie care mareste datoria nu
  mareste retroactiv penalizarea. Plafonul "nu depasesc datoria" se socoteste pe penalizarile
  nete. Locatarul vede sub penalizare "Din ea s-au anulat X lei dupa recalcularea listei".

### 6.7 Fonduri
- Fondul de reparatii se alimenteaza automat la publicare, cu o miscare "Contributii fond
  reparatii, lista pe …". Fondul de rulment are `suma_per_apartament`.
- Soldurile sunt suma miscarilor (`fonduri_solduri`). Locatarii vad fiecare miscare, cu documentul
  ei.

---

## 7. Procese automate

### 7.1 Publicarea listei (`publica-lista`)
1. Citeste `intretinere.date_pentru_motor` cu clientul utilizatorului, deci si cu verificarea ca
   apelantul este administrator.
2. Ruleaza `calculeazaLista`. La date incomplete intoarce 422 si problemele gasite.
3. `intretinere.salveaza_lista_publicata` (doar service role), intr-o singura tranzactie:
   - blocul trebuie sa fie `activ`, iar lista `ciorna`;
   - fiecare cheltuiala trebuie impartita **exact** pe **toate** apartamentele, altfel refuza;
   - salveaza `repartizari`, stabileste scadenta, marcheaza lista publicata si emite
     `ListaPublicata`.
4. Proceseaza evenimentul imediat:
   - Financiar: o datorie `intretinere` pe apartament, alocarea avansurilor, miscarea in fondul de
     reparatii;
   - Comunicare: notificarea "Lista pe <luna> a fost publicata".

### 7.2 Evenimente de domeniu
- Coada `evenimente.coada`. Un trigger trimite fiecare eveniment prin pg_net la Edge Function
  `proceseaza-eveniment`, iar pg_cron preia la fiecare minut ce a ramas neprocesat.
- `evenimente.proceseaza`: toti handlerii unui eveniment ruleaza intr-un singur bloc; daca unul
  esueaza, efectele se anuleaza si se reincearca. Dupa 10 incercari evenimentul este abandonat.

| Eveniment | Efecte |
|---|---|
| ListaPublicata | datorii, fond reparatii, notificare |
| ListaRecalculata | datorii `corectie` cu diferenta, notificare "lista corectata" |
| ApartamentCreat | contoare + indexuri de pornire, cont financiar, `sold_initial` |
| PlataConfirmata | notificare "Am primit X lei. Chitanta …" |
| CitireRespinsa | notificare cu motivul |
| SesizareRaspuns / SesizareRezolvata | notificare catre apartament |
| VotDeschis / VotReamintit / AdunareConvocata | notificari |
| AdministratorAprobat | notificare de bun venit |
| CitireTransmisa, SesizareDeschisa | niciun consumator (administratorul le vede direct) |

### 7.3 Joburi pg_cron

| Job | Program | Ce face |
|---|---|---|
| `calculeaza-penalizari` | `5 0 1 * *` | penalizarile lunare |
| `trimite-remindere` | `0 9 * * *` | reminderele active (§4.5) |
| `proceseaza-evenimente` | `* * * * *` | pana la 200 de evenimente neprocesate |
| `curata-evenimente` | `30 3 * * *` | sterge evenimentele procesate de peste 30 de zile |

---

## 8. Operatiuni ale dezvoltatorului

Doar cu service role, fara interfata in aplicatie.

| Operatiune | Cum |
|---|---|
| **8.1 Asociatie noua** | Edge Function `creeaza-asociatie` → `organizare.creeaza_asociatie`: asociatia, setarile financiare, cele 5 remindere, optional blocul cu setarile de contorizare si fondurile. Apoi contul administratorului, pe numarul lui de telefon (cu parola ceruta sau una generata, intoarsa o singura data) si `identitate.numeste_administrator`. Se poate rula din nou fara efecte duble (dupa CUI sau dupa numarul administratorului). |
| **8.2 Aprobarea unui administrator** | `identitate.verifica_administrator(profil, aprobat, motiv)`; aprobarea emite `AdministratorAprobat` |
| **8.3 Inrolarea unui bloc de pe hartie** | Randuri in `organizare.inrolare_apartamente` (`propus`), apoi `confirma_inrolare` pe fiecare (apartament, persoane, contoare, indexuri de pornire, restanta preluata), apoi `activeaza_bloc`, care verifica: cotele insumeaza 100, fiecare apartament are persoane, fiecare contor are citire, nu mai exista randuri propuse. Starea se vede in `organizare.verificari_bloc`. |
| **8.4 Recalcularea unei liste publicate** | `publica-lista` cu `recalculare: true`: versiunea creste cu 1, randurile vechi raman, iar diferentele devin datorii `corectie`, vizibile locatarilor |
| **8.5 Exportul unui bloc** | `exporta-bloc?bloc_id=`: JSON cu toate tabelele blocului, fara notificari, audit si fisiere |
| **8.6 Datele demo** | `npm run seed` (`scripts/seed-demo.mjs`) rejoaca blocul D14 prin comenzile reale, cu date retroactive |

---

## 9. Declarat, dar neterminat

Exista in schema, dar nu au ecran, comanda sau consumator.

**Inrolare si organizare**
- Inrolarea, `activeaza_bloc` si `verificari_bloc` nu au interfata. Varianta ghidata si
  precompletarea automata `extrage-lista` din `docs/schema-propunere.md` §11.4 nu sunt
  implementate.
- Nu exista comanda pentru arhivarea unei asociatii sau a unui bloc.
- Contoarele nu pot fi adaugate, inlocuite sau scoase de utilizatori.

**Identitate**
  revoca automat codurile nefolosite ale apartamentului.
- Omul nu-si poate schimba singur numele de pe ecran (numai `nume` este scriibil, iar aplicatia nu
  are ecranul); numarul de telefon nu se schimba deloc din aplicatie [A2], pentru ca el este
  identitatea contului.

**Contorizare**
- `estimeaza_citiri` nu este programata in cron.
- Termenul de citire nu este impus la transmitere.

**Intretinere**
- `deschide_lista` copiaza doar cheltuielile recurente de tip `fond_reparatii`; cele de tip
  `factura` sunt ignorate.
- Recalcularea se face doar de dezvoltator, iar cheltuielile publicate nu se pot edita. Pagina de
  lista corectata cu ambele versiuni (§7 din schema) nu exista.
- `liste_lunare.document_id` nu este completat de nicio comanda.

**Financiar**
- Platile prin transfer bancar si rambursarile nu au flux.
- Datoriile `fond_rulment` nu se genereaza; fondul `special` nu are comenzi.
- `chitante.pdf_cale` nu se completeaza (PDF-ul se genereaza doar in browser).
- O factura platita furnizorului nu creeaza iesire din fond.
- O `corectie` negativa reduce restul datoriei de intretinere a aceleiasi liste (`datorii_rest`,
  `aloca_plata`). Cand nu are o datorie frate pe aceeasi lista, ramane doar in sold.
- Webhook-ul nu compara suma confirmata cu suma platii.

**Guvernanta**
- Voturile si prezenta de pe hartie si procesul verbal al AG se introduc doar din seed.
- Numararea pe cota nu are logica de cvorum sau majoritate.

**Comunicare**
- `anunturi.expira_la` nu este folosit; `zile` nu conteaza la reminderul `lista_publicata`.
- Canalele email si SMS sunt declarate, dar nimic nu trimite pe ele.
- `audit.jurnal` se scrie, dar nu se citeste nicaieri.

**Plati**
- Procesatorul de plati este simulat.

---

## 10. Infrastructura transversala

| Subiect | Pe scurt |
|---|---|
| **Contexte (DDD)** | O schema Postgres pe context: `organizare`, `identitate`, `intretinere`, `contorizare`, `financiar`, `sesizari`, `guvernanta`, `comunicare`, `nomenclator`. Neexpuse: `private`, `evenimente`, `audit`. Modelul este in `docs/schema-propunere.md`. |
| **RLS** | Citirile trec prin helperii din `private` (`blocuri_administrate`, `apartamentele_mele`, `blocuri_conduse`, …). Conducerea (administrator, presedinte, cenzor) vede tot blocul; locatarul vede apartamentul lui plus ce e comun blocului. Scrierile trec prin functii `security definer`, una pe agregat. |
| **Storage** | `documente` (10 MB, pdf/jpeg/png/webp), `poze` (1 MB, jpeg/webp), `atestate` (5 MB). Toate private, cu URL semnat la deschidere. |
| **Audit** | `audit.jurnal`: fiecare modificare pe apartamente, persoane, locatari, administratori, citiri, liste, cheltuieli, datorii, plati, miscari de fond, sesizari, voturi (cu optiunile si voturile exprimate), documente si chitante, cu starea veche si noua si autorul. |
| **Nomenclator** | `nomenclator.administratii_locale`: judete, municipii, orase, comune si sectoare, cu codul SIRUTA. Contine doar randurile demo. |
| **PDF** | `src/pdf.js`: generator PDF 1.4 fara librarii, cu Helvetica si WinAnsi (de aici textele fara diacritice). Produce chitanta si lista pentru avizier. |
| **Fotografii** | Micsorare locala la 1600 px JPEG inainte de upload (`micsoreazaPoza`) |
| **Autentificare** | Contul se tine pe numarul de telefon, iar parola o genereaza sistemul (minim 10 caractere, cu litere mari, mici si cifre); nimeni nu isi face singur cont. Schimbarea parolei cere autentificare recenta; sesiunea expira la 24 de ore, sau dupa 8 ore de inactivitate (`supabase/config.toml`). |
| **Secretele din productie** | `SITE_URL` (singura adresa careia Edge Functions ii raspund cu antete CORS). Vezi README, "Punerea in productie". |
| **Date personale** | `identitate.anonimizeaza_profil` (doar dezvoltatorul) inlocuieste numele si numarul de telefon, inchide legaturile si mandatele si sterge sesiunile, pastrand randurile contabile. |
| **UI** | O coloana de telefon (maxim 520 px), flexbox, primitivele din sectiunea 5 (portabile pe React Native), 5 taburi cu badge-uri, toast dupa fiecare comanda, tinte mari la atingere pentru utilizatori de peste 50 de ani |
| **Ciclul unei comenzi** | `cmd()` in `AdminBloc`: apelul catre sursa, reincarcarea datelor, toastul; ecranul primeste `{ ok, rezultat }` |

---

## 11. Index: comanda din UI → backend

| Comanda (`sursa.*`) | Rol | Backend |
|---|---|---|
| `intra`, `iesi` | toti | Supabase Auth (adresa interna din numarul de telefon) |
| `adaugaLocatar`, `parolaNoua`, `adaugaInConducere` | admin | Edge `cont-locatar` |
| `numesteInConducere`, `incheieMandat` | admin | `identitate.numeste_in_conducere`, `identitate.incheie_mandat` |
| `incarca` | toti | select-uri prin RLS + `identitate.eu`, `contacte_asociatie`, `consum_mediu_bloc`, `situatie_bloc`, `sesizari_bloc`, `situatie_voturi`, `situatie_adunari` |
| `transmiteCitire` | locatar | Storage `poze` + `contorizare.transmite_citire` |
| `adaugaSesizare` | locatar | Storage `poze` + `sesizari.adauga_sesizare` |
| `scrieMesaj` | ambele | `sesizari.scrie_mesaj` |
| `voteaza` | locatar | `guvernanta.voteaza` |
| `confirmaPrezenta` | locatar | `guvernanta.confirma_prezenta` |
| `marcheazaAnuntCitit` | locatar | `comunicare.marcheaza_anunt_citit` |
| `marcheazaNotificareCitita` | locatar | `comunicare.marcheaza_notificare_citita` |
| `deschideDocument`, `urlFisier` | ambele | URL semnat Storage (`documente` 10 min, `poze` 1 h) |
| `deschideLista` | admin | `intretinere.deschide_lista` |
| `salveazaCheltuiala`, `stergeCheltuiala` | admin | insert/update/delete pe `intretinere.cheltuieli` (+ `furnizori`, `documente`), doar in ciorna |
| `dateMotor` | admin | `intretinere.date_pentru_motor` (+ `motor.js` in browser) |
| `publicaLista` | admin | Edge `publica-lista` |
| `marcheazaFacturaPlatita` | admin | `intretinere.marcheaza_factura_platita` |
| `inregistreazaIncasare` | admin | `financiar.inregistreaza_incasare` |
| `trimiteInstiintare` | admin | `comunicare.trimite_instiintare` |
| `schimbaPersoane` | admin | insert pe `organizare.apartamente_persoane` |
| `schimbaFisaApartament` | admin | `organizare.schimba_fisa_apartament` (proprietar, suprafata, etaj, scutire de lift, corectii mici de cota) |
| `schimbaCoteleBlocului` | admin | `organizare.schimba_cotele_blocului` (toate cotele deodata, cu verificarea sumei la 100) |
| `inregistreazaIesireFond` | admin | Storage `documente` + `financiar.inregistreaza_iesire_fond` (suma negativa, document obligatoriu, soldul nu poate trece sub zero) |
| `inchideAcces` | admin | `identitate.inchide_acces_locatar` |
| `valideazaCitiriApartament` | admin | `contorizare.valideaza_citiri_apartament` (toate contoarele apartamentului pe o luna, totul sau nimic) |
| `valideazaCitire` | admin | `contorizare.valideaza_citire` (o singura citire; nefolosit de ecrane) |
| `citesteContorGeneral` | admin | `contorizare.citeste_contor_general` |
| `estimeazaCitiri` | admin | `contorizare.estimeaza_citiri` |
| `preiaSesizare`, `rezolvaSesizare` | admin | `sesizari.preia_sesizare`, `sesizari.rezolva_sesizare` |
| `publicaAnunt` | admin | `comunicare.publica_anunt` |
| `seteazaReminder`, `trimiteReminder` | admin | `comunicare.seteaza_reminder`, `comunicare.trimite_reminder` |
| `deschideVot`, `reamintesteVot` | admin | `guvernanta.deschide_vot`, `guvernanta.reaminteste_vot` |
| `convoacaAdunare` | admin | `guvernanta.convoaca_adunare` |
| `incarcaDocument` | admin | Storage `documente` + insert pe `comunicare.documente` |
