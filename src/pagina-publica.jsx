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
  consum: "pe consum, dupa contoare",
  persoane: "pe persoane",
  persoane_fara_lift: "pe persoane, fara apartamentele scutite de lift",
  apartamente: "in parti egale, pe apartament",
  cota: "pe cota indiviza",
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
      <p className="calcul-titlu">{factura}: {lei(c.suma)}, impartita {METODE[c.metoda]}.</p>
      {c.metoda === "consum" ? (
        <ol className="calcul-pasi">
          <li>Contorul general al blocului a aratat {cifra.format(d.contorGeneral)} mc, deci apa costa {cifra.format(d.pretMc)} lei pe mc.</li>
          <li>Contoarele apartamentelor insumeaza {cifra.format(d.sumaContoare)} mc. Diferenta de {cifra.format(d.diferenta)} mc se pierde pe coloana si se imparte pe persoane: apartamentul are {d.persoane} din {d.totalPersoane}, adica {cifra.format(d.cotaDiferenta)} mc.</li>
          <li>Apartamentul {ap.numar}: {cifra.format(d.consumPropriu)} mc pe contoarele lui si {cifra.format(d.cotaDiferenta)} mc din diferenta, in total {cifra.format(r.baza.valoare)} mc.</li>
          <li className="calcul-rezultat">{cifra.format(r.baza.valoare)} mc × {cifra.format(d.pretMc)} lei = {lei(r.suma)}</li>
        </ol>
      ) : (
        <ol className="calcul-pasi">
          <li>Apartamentul {ap.numar}: {cifra.format(r.baza.valoare)} din {cifra.format(r.baza.total)} {r.baza.unitate}.</li>
          <li className="calcul-rezultat">{lei(c.suma)} × {cifra.format(r.baza.valoare)} / {cifra.format(r.baza.total)} = {lei(r.suma)}</li>
        </ol>
      )}
      {r.rotunjire !== 0 && (
        <p className="calcul-nota">Suma contine o rotunjire la ban de {lei(r.rotunjire)}: ce ramane dupa impartire se aseaza la apartamentul cu partea cea mai mare, ca totalul sa iasa exact.</p>
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
  const titlu = `Lista de intretinere pe ${numeLuna(lista.luna)}, ${bloc.denumire}`;
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
          {`Facturile lunii: ${lei(totalFacturi)}. Impartit pe apartamente: ${lei(lista.totalRepartizat)}. Nealocat: ${lei(totalFacturi - lista.totalRepartizat)}.`}
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
  "Administratorul incepe lista lunii si adauga facturile. Pentru fiecare alege cum se imparte, pe persoane, pe apartament, pe cota sau pe consum, si vede pe loc cat revine fiecarui apartament.",
  "Locatarii trimit indexul la apa, cu o poza a contorului, pana la termenul din luna.",
  "Administratorul verifica fiecare index. Unul respins se retrimite; unul lipsa se estimeaza din media ultimelor trei luni.",
  "Administratorul publica lista. Abia acum se calculeaza sumele, o singura data, iar locatarii sunt anuntati.",
  "Locatarii platesc cu cardul sau la administrator. Banii acopera intai datoria cea mai veche, iar chitanta, numerotata fara goluri, se descarca pe loc.",
  "Dupa scadenta si zilele de gratie se calculeaza penalizari, cu formula la vedere. Nu cresc peste datorie si nu se calculeaza penalizari la penalizari.",
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
      await s.intra("administrator@adminbloc.test", "Bloc-D14-2026");
      setDate(pregateste(await s.incarca()));
    })();
  }, []);

  return (
    <>
      <header className="perete">
        <div className="perete-text">
          <p className="marca">AdminBloc</p>
          <h1>Lista de intretinere, cu socoteala la vedere</h1>
          <p className="intro">
            AdminBloc este o aplicatie pentru administrarea unui bloc de locuinte. Face un lucru altfel decat foaia de la
            avizier: orice suma de pe lista se deschide in calculul, factura si documentul din spatele ei. Atinge o suma din
            lista de mai jos.
          </p>
        </div>
        {date ? <ListaDinDeschidere date={date} /> : <p className="se-calculeaza">Se calculeaza lista...</p>}
        <p className="despre-lista">
          Blocul demonstrativ D14, cu 20 de apartamente. Cifrele se calculeaza chiar acum, in pagina, de acelasi motor care
          calculeaza listele reale.
        </p>
      </header>

      <main className="document">
        <section aria-labelledby="azi">
          <h2 id="azi">Ce se intampla azi</h2>
          <p>
            In cele mai multe blocuri, lista de intretinere e o foaie lipita la avizier: un tabel cu sume, fara nicio
            explicatie. Cine vrea sa inteleaga de unde vine suma lui il intreaba pe administrator, iar raspunsul depinde de
            cine intreaba si cand. Cand lista locatarului si raportul administratorului nu dau aceleasi cifre, nimeni nu
            poate spune care e gresita.
          </p>
        </section>

        <section aria-labelledby="principiu">
          <h2 id="principiu">Cum lucreaza AdminBloc</h2>
          <p>{GHID_INTRO}</p>
          <p>
            Fiecare suma isi pastreaza baza: factura, contorul, numarul de persoane sau cota. Din ele se reface calculul,
            pas cu pas, pe ecranul fiecaruia, ca in lista de mai sus. Banii se tin intr-un registru in care doar se adauga:
            soldul nu se scrie niciodata de mana, se calculeaza din datorii si plati.
          </p>
        </section>

        <section aria-labelledby="luna">
          <h2 id="luna">O luna, de la factura la chitanta</h2>
          <ol className="pasi" aria-label="O luna, de la factura la chitanta">
            {PASI.map((p) => <li key={p}>{p}</li>)}
          </ol>
        </section>

        <section aria-labelledby="functii">
          <h2 id="functii">Ce face fiecare parte a aplicatiei</h2>
          <p>Fiecare om vede aplicatia rolului lui: locatarul, apartamentul sau; administratorul, tot blocul.</p>
          <Rol id="rol-locatar" titlu="Ce vede locatarul" sectiuni={GHID.locatar} />
          <Rol id="rol-administrator" titlu="Ce vede administratorul" sectiuni={GHID.administrator} />
        </section>

        <section aria-labelledby="date">
          <h2 id="date">Datele oamenilor</h2>
          <ul>
            <li>Fiecare locatar vede doar apartamentul lui. Regula nu e in ecran, ci in baza de date: o cerere pentru datele vecinului nu intoarce nimic.</li>
            <li>Lista pentru avizier se tipareste fara nume si fara restante. Situatia incasarilor arata cate apartamente au datorii, nu care.</li>
            <li>Sesizarile vecinilor apar fara autor si fara apartament.</li>
            <li>Datele cardului merg direct la procesatorul de plati; asociatia nu le primeste si nu le pastreaza.</li>
          </ul>
        </section>

        <section aria-labelledby="stadiu">
          <h2 id="stadiu">Stadiul proiectului</h2>
          <p>
            AdminBloc este un prototip functional: aplicatia e publicata, cu baza de date si serverul ei, iar blocul
            demonstrativ are 20 de apartamente si patru luni de liste, citiri si plati.
          </p>
          <p>
            Plata cu cardul trece deocamdata printr-un procesator simulat. Integrarea cu un procesator de plati real este
            urmatorul pas.
          </p>
          <p>
            Fiecare regula are teste care o verifica: peste 1.000 de teste ale aplicatiei, cu tot codul acoperit, peste
            1.200 de teste ale bazei de date si aproape 600 de scenarii parcurse in browser, pe telefon si pe desktop.
            Codul a trecut prin sapte runde de audit.
          </p>
        </section>

        <p className="deschide">
          <a href="../">Deschide aplicatia</a>
        </p>
      </main>
    </>
  );
}
