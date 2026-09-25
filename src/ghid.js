/* =============================================================================
   Cum functioneaza AdminBloc: explicatiile fiecarei functii, pe roluri
   -----------------------------------------------------------------------------
   Folosite de pagina publica cum-functioneaza/. Textul descrie ce face
   aplicatia azi (docs/harta-functii.md), nu ce ar putea face.
============================================================================= */

/* Cate o sectiune pentru fiecare tab al rolului, plus contul. */
export const GHID_INTRO = "AdminBloc ține întreținerea blocului la vedere: orice sumă se deschide în calculul, factura și documentul din spatele ei. Sumele se calculează o singură dată, când administratorul publică lista, deci toată lumea vede aceleași cifre.";
export const GHID = {
  locatar: [
    {
      titlu: "Contul tău", rezumat: "Cum intri în aplicație.",
      puncte: [
        "Contul ți-l face administratorul, pe numărul tău de telefon. El îți spune și parola, pe hârtie sau la telefon.",
        "Intri în aplicație cu numărul tău de telefon și cu parola primită. Numărul se poate scrie cu spații sau fără.",
        "Dacă ai uitat parola, cere-i administratorului alta: apasă un buton și îți dă una nouă.",
      ],
    },
    {
      titlu: "Acasă", rezumat: "Ce ai de plătit și ce ai de făcut, dintr-o privire.",
      puncte: [
        "Sus vezi cât ai de plată acum și până când. Dacă totul e plătit, scrie Achitat; dacă ai plătit în plus, vezi și avansul, care se scade din următoarea listă.",
        "O frază îți spune cu cât plătești mai mult sau mai puțin decât luna trecută.",
        "La De făcut găsești ce te așteaptă: să trimiți indexul la apă, să plătești, să votezi sau să confirmi că vii la adunare.",
        "Mai jos: mesajele noi, anunțurile de la avizier, consumul tău de apă față de media blocului, sesizările tale și pe cine suni.",
      ],
    },
    {
      titlu: "Plata", rezumat: "Lista de plată, cu calculul din spatele fiecărei sume.",
      puncte: [
        "Alegi luna. Totalul e împărțit în trei: cheltuielile lunii, fondurile și datoriile din lunile trecute.",
        "Atinge orice rând ca să vezi calculul complet: cât a costat factura, cum s-a împărțit, cât ți-a revenit și documentul facturii.",
        "Jos vezi verificarea: totalul facturilor este egal cu totalul împărțit pe apartamente. Nimic nu rămâne nealocat și nimic nu se plătește de două ori.",
        "Ecranul îți spune cum plătești: în numerar la administrator, cu programul și telefonul lui, sau prin transfer bancar, cu contul asociației.",
        "La Plățile mele vezi fiecare plată, ce a acoperit și chitanța ei. Banii acoperă întâi datoria cea mai veche.",
      ],
    },
    {
      titlu: "Contoare", rezumat: "Indexul la apă, cu poză, și consumul tău.",
      puncte: [
        "Până la termenul din luna scrii indexul fiecărui contor și faci o poză cu el. Poza este obligatorie.",
        "Administratorul verifică indexul. Dacă îl respinge, vezi motivul și îl trimiți din nou.",
        "Dacă nu trimiți la timp, administratorul poate trece un consum estimat, din media ultimelor trei luni. Pe lista apare scris Estimat.",
        "Vezi graficul consumului pe ultimele luni și de ce blocul plătește mai multă apă decât arată contoarele.",
      ],
    },
    {
      titlu: "Sesizări", rezumat: "Spui ce s-a stricat și vezi răspunsul.",
      puncte: [
        "Alegi o sesizare gata scrisă, de exemplu Bec ars pe scară, sau scrii tu, cu până la trei poze.",
        "La Ale mele vorbești cu administrația până când problema e rezolvată.",
        "La Din tot blocul vezi ce au semnalat vecinii, fără nume, ca să nu scrii de două ori despre același lucru.",
      ],
    },
    {
      titlu: "Bloc", rezumat: "Avizierul, voturile, actele și fondurile blocului.",
      puncte: [
        "Avizier: anunțurile administrației și pe cine suni.",
        "Vot și adunare: proprietarul votează o singură dată pentru apartament, iar votul nu se mai poate schimba. Confirmi dacă vii la adunarea generală.",
        "Acte: documentele asociației, de exemplu facturi, contracte și procese verbale.",
        "Fonduri: câți bani sunt în fondul de reparații și în cel de rulment și unde s-au dus, fiecare cheltuială cu documentul ei. Vezi și câte apartamente au datorii, fără nume.",
      ],
    },
  ],
  administrator: [
    {
      titlu: "Contul tău", rezumat: "Cum ajungi să administrezi blocul în aplicație.",
      puncte: [
        "Contul de administrator ți-l facem noi, pe numărul tău de telefon, după ce verificăm atestatul și asociația.",
        "Intri cu numărul tău de telefon și cu parola primită.",
        "Conturile locatarilor le faci tu, din fișa fiecărui apartament: scrii numele și numărul, iar aplicația îți dă parola pentru el.",
      ],
    },
    {
      titlu: "Sumar", rezumat: "Starea blocului, pe un singur ecran.",
      puncte: [
        "Cât e de încasat pe lista curentă și cât s-a încasat deja.",
        "Restanțele, penalizările, citirile de verificat, sesizările deschise și fondul de reparații. Atinge oricare ca să ajungi la ele.",
        "Facturile de plătit către furnizori, cu scadența lor, și restanțierii, cu butonul de înștiințare.",
        "De aici trimiți reminderul de plată și exporti lista în PDF.",
      ],
    },
    {
      titlu: "Apartamente", rezumat: "Fișa fiecărui apartament, citirile și fondurile.",
      puncte: [
        "Cauți un apartament după nume sau număr. Fișa lui arată datele, soldul la zi și fiecare datorie.",
        "Din fișa confirmi banii primiți, în numerar sau prin transfer: ei acoperă întâi datoria cea mai veche, iar chitanța se emite pe loc. Tot de acolo schimbi numărul de persoane, corectezi datele și cotele, faci contul unui locatar pe numărul lui de telefon sau îi închizi accesul.",
        "Citiri contoare: citești contorul general, validezi sau respingi indexurile, cu motiv, și estimezi ce lipsește după termen. O citire validată din greșeală o poți respinge cât timp lista lunii nu e publicată.",
        "Fonduri: vezi fiecare mișcare și înregistrezi o cheltuială din fond, cu documentul ei. Fondul nu poate ajunge sub zero.",
      ],
    },
    {
      titlu: "Facturi", rezumat: "Lista lunii, de la prima factură la publicare.",
      puncte: [
        "Începi lista lunii; fondul de reparații e deja trecut pe ea.",
        "Adaugi facturile: furnizorul, suma, codul pe lista și cum se împarte, pe persoane, pe apartament, pe cotă sau pe consum. Vezi pe loc cât revine fiecărui apartament, înainte să salvezi.",
        "Calculezi lista pe apartamente și verifici că totalul împărțit este egal cu totalul facturilor.",
        "Publici lista după ce ai verificat toate citirile lunii. După publicare sumele nu se mai schimbă, iar locatarii sunt anunțați.",
        "Exporti PDF-ul pentru avizier, fără nume și fără restanțe, și lista internă, cu toate datele. Marchezi facturile plătite furnizorilor.",
      ],
    },
    {
      titlu: "Sesizări", rezumat: "Problemele semnalate de locatari.",
      puncte: [
        "Cele deschise apar întâi pe cele mai vechi, cu câte zile așteaptă fiecare. După trei zile apar cu roșu.",
        "Preiei sesizarea, răspunzi, iar locatarul e anunțat, apoi o marchezi rezolvată.",
      ],
    },
    {
      titlu: "Comunicare", rezumat: "Anunțuri, remindere, voturi, adunări și acte.",
      puncte: [
        "Anunțuri: un anunț urgent ajunge imediat ca notificare la toți locatarii cu cont. Vezi câți l-au citit.",
        "Remindere: alegi care pleacă singure și cu câte zile înainte, pentru citire, plată, restanțe și adunare. Le poți trimite și pe loc.",
        "Vot și adunare: deschizi un vot, numărat pe apartament sau pe cotă, vezi cine n-a votat și le reamintești. Convoci adunarea generală.",
        "Acte: încarci documente, vizibile locatarilor sau doar administrației.",
      ],
    },
  ],
};
