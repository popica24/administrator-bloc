/* =============================================================================
   Cum functioneaza AdminBloc: explicatiile fiecarei functii, pe roluri
   -----------------------------------------------------------------------------
   Folosite de pagina publica cum-functioneaza/. Textul descrie ce face
   aplicatia azi (docs/harta-functii.md), nu ce ar putea face.
============================================================================= */

/* Cate o sectiune pentru fiecare tab al rolului, plus contul. */
export const GHID_INTRO = "AdminBloc tine intretinerea blocului la vedere: orice suma se deschide in calculul, factura si documentul din spatele ei. Sumele se calculeaza o singura data, cand administratorul publica lista, deci toata lumea vede aceleasi cifre.";
export const GHID = {
  locatar: [
    {
      titlu: "Contul tau", rezumat: "Cum intri in aplicatie.",
      puncte: [
        "Primesti de la administrator un cod de 8 caractere. La inregistrare scrii codul, numele, telefonul, emailul si o parola.",
        "Confirmi adresa de email din mesajul primit, apoi intri in cont cu emailul si parola.",
        "Codul se foloseste o singura data si expira in 30 de zile. Daca nu merge, cere administratorului unul nou.",
      ],
    },
    {
      titlu: "Acasa", rezumat: "Ce ai de platit si ce ai de facut, dintr-o privire.",
      puncte: [
        "Sus vezi cat ai de plata acum si pana cand. Daca totul e platit, scrie Achitat; daca ai platit in plus, vezi si avansul, care se scade din urmatoarea lista.",
        "O fraza iti spune cu cat platesti mai mult sau mai putin decat luna trecuta.",
        "La De facut gasesti ce te asteapta: sa trimiti indexul la apa, sa platesti, sa votezi sau sa confirmi ca vii la adunare.",
        "Mai jos: mesajele noi, anunturile de la avizier, consumul tau de apa fata de media blocului, sesizarile tale si pe cine suni.",
      ],
    },
    {
      titlu: "Plata", rezumat: "Lista de plata, cu calculul din spatele fiecarei sume.",
      puncte: [
        "Alegi luna. Totalul e impartit in trei: cheltuielile lunii, fondurile si datoriile din lunile trecute.",
        "Atinge orice rand ca sa vezi calculul complet: cat a costat factura, cum s-a impartit, cat ti-a revenit si documentul facturii.",
        "Jos vezi verificarea: totalul facturilor este egal cu totalul impartit pe apartamente. Nimic nu ramane nealocat si nimic nu se plateste de doua ori.",
        "Ecranul iti spune cum platesti: in numerar la administrator, cu programul si telefonul lui, sau prin transfer bancar, cu contul asociatiei.",
        "La Platile mele vezi fiecare plata, ce a acoperit si chitanta ei. Banii acopera intai datoria cea mai veche.",
      ],
    },
    {
      titlu: "Contoare", rezumat: "Indexul la apa, cu poza, si consumul tau.",
      puncte: [
        "Pana la termenul din luna scrii indexul fiecarui contor si faci o poza cu el. Poza este obligatorie.",
        "Administratorul verifica indexul. Daca il respinge, vezi motivul si il trimiti din nou.",
        "Daca nu trimiti la timp, administratorul poate trece un consum estimat, din media ultimelor trei luni. Pe lista apare scris Estimat.",
        "Vezi graficul consumului pe ultimele luni si de ce blocul plateste mai multa apa decat arata contoarele.",
      ],
    },
    {
      titlu: "Sesizari", rezumat: "Spui ce s-a stricat si vezi raspunsul.",
      puncte: [
        "Alegi o sesizare gata scrisa, de exemplu Bec ars pe scara, sau scrii tu, cu pana la trei poze.",
        "La Ale mele vorbesti cu administratia pana cand problema e rezolvata.",
        "La Din tot blocul vezi ce au semnalat vecinii, fara nume, ca sa nu scrii de doua ori despre acelasi lucru.",
      ],
    },
    {
      titlu: "Bloc", rezumat: "Avizierul, voturile, actele si fondurile blocului.",
      puncte: [
        "Avizier: anunturile administratiei si pe cine suni.",
        "Vot si adunare: proprietarul voteaza o singura data pentru apartament, iar votul nu se mai poate schimba. Confirmi daca vii la adunarea generala.",
        "Acte: documentele asociatiei, de exemplu facturi, contracte si procese verbale.",
        "Fonduri: cati bani sunt in fondul de reparatii si in cel de rulment si unde s-au dus, fiecare cheltuiala cu documentul ei. Vezi si cate apartamente au datorii, fara nume.",
      ],
    },
  ],
  administrator: [
    {
      titlu: "Contul tau", rezumat: "Cum ajungi sa administrezi blocul in aplicatie.",
      puncte: [
        "La inregistrare scrii numarul atestatului de administrator si poti adauga o poza a lui.",
        "Contul se verifica inainte sa vada datele vreunei asociatii. Te anuntam pe email.",
        "Daca cererea e respinsa, vezi motivul si o trimiti din nou, corectata.",
      ],
    },
    {
      titlu: "Sumar", rezumat: "Starea blocului, pe un singur ecran.",
      puncte: [
        "Cat e de incasat pe lista curenta si cat s-a incasat deja.",
        "Restantele, penalizarile, citirile de verificat, sesizarile deschise si fondul de reparatii. Atinge oricare ca sa ajungi la ele.",
        "Facturile de platit catre furnizori, cu scadenta lor, si restantierii, cu butonul de instiintare.",
        "De aici trimiti reminderul de plata si exporti lista in PDF.",
      ],
    },
    {
      titlu: "Apartamente", rezumat: "Fisa fiecarui apartament, citirile si fondurile.",
      puncte: [
        "Cauti un apartament dupa nume sau numar. Fisa lui arata datele, soldul la zi si fiecare datorie.",
        "Din fisa incasezi numerar: banii acopera intai datoria cea mai veche, iar chitanta se emite pe loc. Tot de acolo schimbi numarul de persoane, corectezi datele si cotele, inviti un locatar cu un cod sau ii inchizi accesul.",
        "Citiri contoare: citesti contorul general, validezi sau respingi indexurile, cu motiv, si estimezi ce lipseste dupa termen. O citire validata din greseala o poti respinge cat timp lista lunii nu e publicata.",
        "Fonduri: vezi fiecare miscare si inregistrezi o cheltuiala din fond, cu documentul ei. Fondul nu poate ajunge sub zero.",
      ],
    },
    {
      titlu: "Facturi", rezumat: "Lista lunii, de la prima factura la publicare.",
      puncte: [
        "Incepi lista lunii; fondul de reparatii e deja trecut pe ea.",
        "Adaugi facturile: furnizorul, suma, codul pe lista si cum se imparte, pe persoane, pe apartament, pe cota sau pe consum. Vezi pe loc cat revine fiecarui apartament, inainte sa salvezi.",
        "Calculezi lista pe apartamente si verifici ca totalul impartit este egal cu totalul facturilor.",
        "Publici lista dupa ce ai verificat toate citirile lunii. Dupa publicare sumele nu se mai schimba, iar locatarii sunt anuntati.",
        "Exporti PDF-ul pentru avizier, fara nume si fara restante, si lista interna, cu toate datele. Marchezi facturile platite furnizorilor.",
      ],
    },
    {
      titlu: "Sesizari", rezumat: "Problemele semnalate de locatari.",
      puncte: [
        "Cele deschise apar intai pe cele mai vechi, cu cate zile asteapta fiecare. Dupa trei zile apar cu rosu.",
        "Preiei sesizarea, raspunzi, iar locatarul e anuntat, apoi o marchezi rezolvata.",
      ],
    },
    {
      titlu: "Comunicare", rezumat: "Anunturi, remindere, voturi, adunari si acte.",
      puncte: [
        "Anunturi: un anunt urgent ajunge imediat ca notificare la toti locatarii cu cont. Vezi cati l-au citit.",
        "Remindere: alegi care pleaca singure si cu cate zile inainte, pentru citire, plata, restante si adunare. Le poti trimite si pe loc.",
        "Vot si adunare: deschizi un vot, numarat pe apartament sau pe cota, vezi cine n-a votat si le reamintesti. Convoci adunarea generala.",
        "Acte: incarci documente, vizibile locatarilor sau doar administratiei.",
      ],
    },
  ],
};
