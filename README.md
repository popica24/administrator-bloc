# AdminBloc

Aplicatia prin care o administratie de bloc devine transparenta: omul vede cat are de plata,
de ce atat si cum s-a ajuns la suma aceea. Lista de intretinere, incasarile confirmate de administrator, citirile de
contoare cu poza, sesizari, avizier, voturi, fonduri si penalizari.

Elementul central este randul din lista de intretinere care se desface si arata calculul
complet al sumei: factura, baza de repartizare, aritmetica si documentul justificativ.

## Pornire rapida

```bash
npm install
supabase start            # stack-ul local in Docker
supabase db reset         # migratiile de la zero
npm run seed              # blocul demo D14, prin comenzile reale ale backend-ului
cp .env.example .env.local   # si completeaza ANON_KEY din `supabase status`
npm run dev               # http://localhost:5173
```

Contul se tine pe numarul de telefon: omul intra cu numarul lui si cu parola primita de la
administrator, care ii face contul din fisa apartamentului. Conturile de test (numere si parola)
sunt in `conturi-test.txt`. Fara `.env.local`, aplicatia porneste in modul demonstrativ, cu
aceleasi date tinute in memorie.

## Scripturi

| Comanda | Efect |
| --- | --- |
| `npm run dev` | server de dezvoltare cu hot reload |
| `npm run build` | build de productie in `dist/` |
| `npm run preview` | serveste local build-ul de productie |
| `npm run lint` | ruleaza ESLint pe tot proiectul |
| `npm run seed` | incarca datele demo in baza locala |
| `npm test` | testele unitare (motor, PDF, modul demonstrativ, toate ecranele) |
| `npm run test:integrare` | sursa Supabase contra stack-ului local |
| `npm run test:acoperire` | testele JS cu acoperire; pica sub 100% |
| `npm run test:functii` | Edge Functions (Deno), cu acoperire; pica sub 100% |
| `npm run test:db` | testele SQL (pgTAP) |
| `npm run acoperire:sql` | verifica ca fiecare functie, eroare si politica RLS are test |

## Structura

```
.
├── src
│   ├── AdminBloc.jsx        interfata, intr-un singur fisier, pe sectiuni numerotate
│   ├── sursa.js             alege sursa de date: Supabase sau modul demonstrativ
│   ├── sursa-supabase.js    citiri prin RLS, comenzi prin RPC si Edge Functions
│   ├── sursa-mock.js        aceeasi interfata, in memorie
│   ├── date-demo.js         blocul demo: apartamente, facturi, citiri, plati
│   └── pdf.js               chitanta si lista pentru avizier, ca PDF
├── supabase
│   ├── migrations/          schema: cate o schema Postgres pe context (DDD)
│   ├── functions/           Edge Functions; _shared/motor.js este motorul de repartizare
│   └── seed.sql             secretele locale pentru webhook
├── scripts/seed-demo.mjs    rejoaca datele demo prin backend
└── docs/schema-propunere.md modelul domeniului
```

## Principiul

Motorul de repartizare (`supabase/functions/_shared/motor.js`) este singurul cod care
calculeaza cat plateste un apartament. Ruleaza o singura data, la publicarea listei, iar
rezultatul se salveaza; ecranele doar il citesc. Banii sunt un registru in care doar se adauga
(datorii, plati, alocari), iar soldul se calculeaza, nu se stocheaza.

## Portare catre React Native

Interfata foloseste doar primitivele din sectiunea 5 (`Box`, `Txt`, `Btn`, ...), layout doar cu
flexbox, fara librarii de UI. `Box` → `View`, `Txt` → `Text`, `Btn` → `Pressable`.

## Punerea in productie

Inainte de primul `supabase db push` si de primul deploy de Edge Functions,
proiectul din productie are nevoie de un secret:

```bash
supabase secrets set SITE_URL=https://adresa-aplicatiei
```

`SITE_URL` este adresa de la care raspund functiile: fara ea, antetele CORS
cad pe `http://localhost:5173`, iar aplicatia reala primeste "Serverul nu
raspunde" la publicarea listei. Trebuie sa fie aceeasi adresa cu
`auth.site_url` din `supabase/config.toml`.

## Stack

React 19, Vite 7, Supabase (Postgres 17, Auth, Storage, Edge Functions, pg_cron, pg_net).

## Licenta

[MIT](LICENSE)
