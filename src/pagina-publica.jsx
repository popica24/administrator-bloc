/* =============================================================================
   Pagina publica "Cum functioneaza AdminBloc" (cum-functioneaza/)
   -----------------------------------------------------------------------------
   O pagina de prezentare, fara cont: ce este aplicatia, pe ce principiu
   lucreaza si ce face fiecare functie. Nu face parte din aplicatie (nu trebuie
   sa fie portabila spre React Native), deci foloseste HTML si CSS simplu.

   Lista din deschidere nu e o imagine: se calculeaza in pagina, cu sursa
   demonstrativa si motorul real, deci cifrele sunt aceleasi cu cele din
   aplicatie. Pagina doar citeste ce a calculat motorul (suma, baza, detaliul),
   ca RandLista din aplicatie; nu recalculeaza nimic.
============================================================================= */
import React, { useEffect, useState } from "react";
import { creeazaSursaMock } from "./sursa-mock.js";
import { GHID, GHID_INTRO } from "./ghid.js";

const bani = new Intl.NumberFormat("ro-RO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cifra = new Intl.NumberFormat("ro-RO", { maximumFractionDigits: 4 });
const lei = (n) => `${bani.format(n)} lei`;

const METODE = {
  consum: "pe consum, după contoare",
  persoane: "pe persoane",
  persoane_fara_lift: "pe persoane, fără apartamentele scutite de lift",
  apartamente: "în părți egale, pe apartament",
  cota: "pe cotă indiviză",
};

/* Ordinea de pe foaia de la avizier: C1, C2, ... C10, nu C1, C10, C2 */
const dupaNumar = (a, b) => a.localeCompare(b, "ro", { numeric: true });

/* Lista publicata cea mai noua, pregatita pentru tabel */
function pregateste(d) {
  const lista = d.liste.filter((l) => l.stare === "publicata").sort((a, b) => b.luna.localeCompare(a.luna))[0];
  const cheltuieli = d.cheltuieli.filter((c) => c.listaId === lista.id).sort((a, b) => dupaNumar(a.cod, b.cod));
  const apartamente = d.apartamente.slice().sort((a, b) => dupaNumar(a.numar, b.numar));
  const repartizari = new Map(d.repartizari.filter((r) => r.listaId === lista.id).map((r) => [`${r.cheltuialaId}|${r.apartamentId}`, r]));
  return { lista, cheltuieli, apartamente, repartizari, bloc: d.bloc };
}

const LUNI = ["ianuarie", "februarie", "martie", "aprilie", "mai", "iunie", "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie"];
const numeLuna = (l) => `${LUNI[Number(l.slice(5, 7)) - 1]} ${l.slice(0, 4)}`;

/* Socoteala unei sume, in cuvinte, din ce a pastrat motorul */
export function Socoteala({ c, ap, r }) {
  const factura = c.furnizor ? `${c.categorie}, factura ${c.furnizor}${c.serie ? ` ${c.serie}` : ""}` : c.categorie;
  const d = r.detaliu;
  return (
    <>
      <p className="calcul-titlu">{factura}: {lei(c.suma)}, împărțită {METODE[c.metoda]}.</p>
      {c.metoda === "consum" ? (
        <ol className="calcul-pasi">
          <li>Contorul general al blocului a arătat {cifra.format(d.contorGeneral)} mc, deci apa costă {cifra.format(d.pretMc)} lei pe mc.</li>
          <li>Contoarele apartamentelor însumează {cifra.format(d.sumaContoare)} mc. Diferența de {cifra.format(d.diferenta)} mc se pierde pe coloană și se împarte pe persoane: apartamentul are {d.persoane} din {d.totalPersoane}, adică {cifra.format(d.cotaDiferenta)} mc.</li>
          <li>Apartamentul {ap.numar}: {cifra.format(d.consumPropriu)} mc pe contoarele lui și {cifra.format(d.cotaDiferenta)} mc din diferența, în total {cifra.format(r.baza.valoare)} mc.</li>
          <li className="calcul-rezultat">{cifra.format(r.baza.valoare)} mc × {cifra.format(d.pretMc)} lei = {lei(r.suma)}</li>
        </ol>
      ) : (
        <ol className="calcul-pasi">
          <li>Apartamentul {ap.numar}: {cifra.format(r.baza.valoare)} din {cifra.format(r.baza.total)} {r.baza.unitate}.</li>
          <li className="calcul-rezultat">{lei(c.suma)} × {cifra.format(r.baza.valoare)} / {cifra.format(r.baza.total)} = {lei(r.suma)}</li>
        </ol>
      )}
      {r.rotunjire !== 0 && (
        <p className="calcul-nota">Suma conține o rotunjire la ban de {lei(r.rotunjire)}: ce rămâne după împărțire se așează la apartamentul cu partea cea mai mare, ca totalul să iasă exact.</p>
      )}
    </>
  );
}

function ListaDinDeschidere({ date }) {
  const { lista, cheltuieli, apartamente, repartizari, bloc } = date;
  const [ales, setAles] = useState({ cod: "C1", numar: "17" });
  const cAles = cheltuieli.find((c) => c.cod === ales.cod);
  const apAles = apartamente.find((a) => a.numar === ales.numar);
  const totalFacturi = cheltuieli.reduce((s, c) => s + c.suma, 0);
  const titlu = `Lista de întreținere pe ${numeLuna(lista.luna)}, ${bloc.denumire}`;
  return (
    <div className="avizier">
      <div className="foaie">
        <div className="foaie-derulare">
          <table className="lista" aria-label={titlu}>
            <caption>{titlu}</caption>
            <thead>
              <tr>
                <th scope="col">Ap.</th>
                {cheltuieli.map((c) => <th key={c.id} scope="col"><abbr title={c.categorie}>{c.cod}</abbr></th>)}
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {apartamente.map((ap) => {
                const total = cheltuieli.reduce((s, c) => s + repartizari.get(`${c.id}|${ap.id}`).suma, 0);
                return (
                  <tr key={ap.id}>
                    <th scope="row">{ap.numar}</th>
                    {cheltuieli.map((c) => {
                      const r = repartizari.get(`${c.id}|${ap.id}`);
                      const eAles = c.cod === ales.cod && ap.numar === ales.numar;
                      return (
                        <td key={c.id}>
                          <button
                            type="button"
                            className={eAles ? "suma aleasa" : "suma"}
                            aria-pressed={eAles}
                            aria-label={`Ap. ${ap.numar}, ${c.categorie}: ${lei(r.suma)}`}
                            onClick={() => setAles({ cod: c.cod, numar: ap.numar })}
                          >
                            {bani.format(r.suma)}
                          </button>
                        </td>
                      );
                    })}
                    <td className="total">{bani.format(total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="verificare">
          {`Facturile lunii: ${lei(totalFacturi)}. Împărțit pe apartamente: ${lei(lista.totalRepartizat)}. Nealocat: ${lei(totalFacturi - lista.totalRepartizat)}.`}
        </p>
        <section className="adnotare" aria-label="Socoteala sumei alese" aria-live="polite">
          <Socoteala c={cAles} ap={apAles} r={repartizari.get(`${cAles.id}|${apAles.id}`)} />
        </section>
        <dl className="legenda">
          {cheltuieli.map((c) => (
            <div key={c.id}><dt>{c.cod}</dt><dd>{c.categorie}, {METODE[c.metoda]}</dd></div>
          ))}
        </dl>
      </div>
    </div>
  );
}

const PASI = [
  "Administratorul începe lista lunii și adaugă facturile. Pentru fiecare alege cum se împarte, pe persoane, pe apartament, pe cotă sau pe consum, și vede pe loc cât revine fiecărui apartament.",
  "Locatarii trimit indexul la apă, cu o poză a contorului, până la termenul din luna.",
  "Administratorul verifică fiecare index. Unul respins se retrimite; unul lipsă se estimează din media ultimelor trei luni.",
  "Administratorul publică lista. Abia acum se calculează sumele, o singură dată, iar locatarii sunt anunțați.",
  "Locatarii plătesc în numerar la administrator sau prin transfer bancar; ecranul le spune unde și cum. Banii acoperă întâi datoria cea mai veche, iar chitanța, numerotată fără goluri, se descarcă pe loc.",
  "După scadență și zilele de grație se calculează penalizări, cu formula la vedere. Nu cresc peste datorie și nu se calculează penalizări la penalizări.",
];

function Rol({ id, titlu, sectiuni }) {
  return (
    <section className="rol" aria-labelledby={id}>
      <h3 id={id}>{titlu}</h3>
      {sectiuni.map((sec) => (
        <div key={sec.titlu} className="functie">
          <h4>{sec.titlu}</h4>
          <p className="functie-rezumat">{sec.rezumat}</p>
          <ul>{sec.puncte.map((p) => <li key={p}>{p}</li>)}</ul>
        </div>
      ))}
    </section>
  );
}

export default function PaginaPublica() {
  const [date, setDate] = useState(null);
  useEffect(() => {
    (async () => {
      const s = creeazaSursaMock();
      await s.intra("0745 210 118", "Bloc-D14-2026");
      setDate(pregateste(await s.incarca()));
    })();
  }, []);

  return (
    <>
      <header className="perete">
        <div className="perete-text">
          <p className="marca">AdminBloc</p>
          <h1>Lista de întreținere, cu socoteala la vedere</h1>
          <p className="intro">
            AdminBloc este o aplicație pentru administrarea unui bloc de locuințe. Face un lucru altfel decât foaia de la
            avizier: orice sumă de pe lista se deschide în calculul, factura și documentul din spatele ei. Atinge o sumă din
            lista de mai jos.
          </p>
        </div>
        {date ? <ListaDinDeschidere date={date} /> : <p className="se-calculeaza">Se calculează lista...</p>}
        <p className="despre-lista">
          Blocul demonstrativ D14, cu 20 de apartamente. Cifrele se calculează chiar acum, în pagina, de același motor care
          calculează listele reale.
        </p>
      </header>

      <main className="document">
        <section aria-labelledby="azi">
          <h2 id="azi">Ce se întâmplă azi</h2>
          <p>
            În cele mai multe blocuri, lista de întreținere e o foaie lipită la avizier: un tabel cu sume, fără nicio
            explicație. Cine vrea să înțeleagă de unde vine suma lui îl întreabă pe administrator, iar răspunsul depinde de
            cine întreabă și când. Când lista locatarului și raportul administratorului nu dau aceleași cifre, nimeni nu
            poate spune care e greșită.
          </p>
        </section>

        <section aria-labelledby="principiu">
          <h2 id="principiu">Cum lucrează AdminBloc</h2>
          <p>{GHID_INTRO}</p>
          <p>
            Fiecare sumă își păstrează baza: factura, contorul, numărul de persoane sau cota. Din ele se reface calculul,
            pas cu pas, pe ecranul fiecăruia, ca în lista de mai sus. Banii se țin într-un registru în care doar se adaugă:
            soldul nu se scrie niciodată de mână, se calculează din datorii și plăți.
          </p>
        </section>

        <section aria-labelledby="luna">
          <h2 id="luna">O lună, de la factură la chitanță</h2>
          <ol className="pasi" aria-label="O lună, de la factură la chitanță">
            {PASI.map((p) => <li key={p}>{p}</li>)}
          </ol>
        </section>

        <section aria-labelledby="functii">
          <h2 id="functii">Ce face fiecare parte a aplicației</h2>
          <p>Fiecare om vede aplicația rolului lui: locatarul, apartamentul său; administratorul, tot blocul.</p>
          <Rol id="rol-locatar" titlu="Ce vede locatarul" sectiuni={GHID.locatar} />
          <Rol id="rol-administrator" titlu="Ce vede administratorul" sectiuni={GHID.administrator} />
        </section>

        <section aria-labelledby="date">
          <h2 id="date">Datele oamenilor</h2>
          <ul>
            <li>Fiecare locatar vede doar apartamentul lui. Regula nu e în ecran, ci în baza de date: o cerere pentru datele vecinului nu întoarce nimic.</li>
            <li>Lista pentru avizier se tipărește fără nume și fără restanțe. Situația încasărilor arată câte apartamente au datorii, nu care.</li>
            <li>Sesizările vecinilor apar fără autor și fără apartament.</li>
          </ul>
        </section>

        <section aria-labelledby="stadiu">
          <h2 id="stadiu">Stadiul proiectului</h2>
          <p>
            AdminBloc este un prototip funcțional: aplicația e publicată, cu baza de date și serverul ei, iar blocul
            demonstrativ are 20 de apartamente și patru luni de liste, citiri și plăți.
          </p>
          <p>
            Banii se încasează în numerar, în mâna administratorului, sau prin transfer în contul asociației;
            administratorul confirmă încasarea în aplicație, care emite chitanța pe loc.
          </p>
          <p>
            Fiecare regula are teste care o verifica: peste 1.000 de teste ale aplicatiei, cu tot codul acoperit, peste
            1.200 de teste ale bazei de date si aproape 600 de scenarii parcurse in browser, pe telefon si pe desktop.
            Codul a trecut prin sapte runde de audit.
          </p>
        </section>

        <p className="deschide">
          <a href="../">Deschide aplicația</a>
        </p>
      </main>
    </>
  );
}
