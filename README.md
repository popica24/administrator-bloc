# AdminBloc

Mockup functional pentru administrarea unui bloc de locuinte: lista de intretinere,
citiri de contoare, sesizari si comunicare intre administrator si locatari.

Aplicatia ruleaza integral in browser, pe date mock. Nu exista backend, nu exista
fetch, iar starea traieste intr-un singur React Context.

## Ce contine

Doua roluri, comutabile din bara de sus:

**Locatar** — Acasa, Plata, Contoare, Sesizari, Bloc
**Administrator** — Sumar, Apartamente, Facturi, Sesizari, Comunicare

Elementul central este randul din lista de intretinere care se desface si arata
calculul complet al sumei, cheltuiala cu cheltuiala.

## Instalare

```bash
npm install
npm run dev
```

Aplicatia porneste pe http://localhost:5173.

## Scripturi

| Comanda | Efect |
| --- | --- |
| `npm run dev` | server de dezvoltare cu hot reload |
| `npm run build` | build de productie in `dist/` |
| `npm run preview` | serveste local build-ul de productie |
| `npm run lint` | ruleaza ESLint pe tot proiectul |

## Structura

```
.
├── index.html            punctul de intrare HTML
├── src
│   ├── main.jsx          montarea aplicatiei in #root
│   ├── index.css         reset la nivel de document
│   └── AdminBloc.jsx     intreaga aplicatie, intr-un singur fisier
├── vite.config.js
└── eslint.config.js
```

`AdminBloc.jsx` este impartit in sectiuni numerotate, in ordinea in care se
citeste aplicatia:

1. **TOKENS** — paleta, spatieri, raze, fonturi
2. **HELPERS** — formatare si utilitare, JavaScript pur
3. **MOCK DATA** — blocul, apartamentele, facturile, sesizarile
4. **ENGINE** — repartizarea cheltuielilor, singura sursa de adevar pentru sume
5. **PRIMITIVE** — `Box`, `Txt`, `Btn`, singurele componente care ating DOM-ul
6. **STARE PARTAJATA** — Context-ul cu toata starea mutabila
7. **ELEMENTUL SEMNATURA** — randul din lista care se desface
8. **ECRANE LOCATAR**
9. **ECRANE ADMINISTRATOR**

Ecranele nu contin numere scrise de mana. Tot ce se afiseaza iese din engine,
deci lista locatarului si raportul administratorului nu se pot contrazice.

## Portare catre React Native

Fisierul este scris cu portarea in minte: layout doar cu flexbox, fara grid,
fara pseudo-selectori, fara unitati CSS in afara de px, fara librarii externe.

| Web | React Native |
| --- | --- |
| `<Box>` | `<View>` |
| `<Txt>` | `<Text>` |
| `<Btn>` | `<Pressable>` |
| `.map()` pe liste | `<FlatList>` |
| `style={{...}}` | `StyleSheet.create({...})`, aceleasi chei flexbox |
| `onChange` pe input | `onChangeText` pe `TextInput` |
| ecranele si tab bar-ul | `@react-navigation/bottom-tabs` |

Sectiunile 2, 3 si 4 se copiaza fara nicio modificare. Blocul `BASE_CSS` dispare
la portare, React Native nu foloseste CSS.

## Stack

React 19, Vite 7, ESLint 9. Fara dependinte de UI.

## Licenta

[MIT](LICENSE)
