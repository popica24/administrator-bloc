// cont-locatar: administratorul face contul unui locatar, sau ii da alta
// parola cand si-a uitat-o.
//
// Contul nu si-l face omul: administratorul ii trece numarul de telefon in
// aplicatie, iar sistemul creeaza contul cu o parola pe care o afla numai
// administratorul, o singura data, si i-o da omului cum stie el (pe hartie,
// la telefon). Nu se trimite niciun SMS si niciun email.
//
// Este Edge Function, nu doar SQL, pentru ca un cont se creeaza prin API-ul de
// administrare Supabase Auth, care merge doar cu cheia de serviciu. Dreptul
// administratorului pe apartament se verifica intai, cu tokenul lui
// (identitate.apartament_de_administrat).
//
// Corp: { apartament_id, nume, telefon, calitate }             -> cont nou
//        { apartament_id, locatar_id, actiune: "parola" }      -> parola noua
//        { asociatie_id, nume, telefon, rol, actiune: "conducere" } -> presedinte
//                                                                 sau cenzor
//
// Daca numarul are deja cont (acelasi om, al doilea apartament), contul se
// leaga de apartamentul nou si raspunsul vine fara parola.

import { adresaContului, normalizeazaTelefon } from "../_shared/telefon.js";
import { traduceAuth } from "../_shared/mesaje.js";
import { genereazaParola } from "../_shared/parola.js";
import { clientServiciu, clientUtilizator, eroare, porneste, raspuns } from "../_shared/server.ts";

porneste(async (req) => {
  if (req.method !== "POST") return eroare("Metoda nu este permisa.", 405);

  try {
    const { apartament_id, asociatie_id, locatar_id, nume, telefon, calitate = "proprietar", rol, actiune = "creeaza" } = await req.json();
    const conducere = actiune === "conducere";
    if (!conducere && !apartament_id) return eroare("Lipseste apartamentul.");

    const cititor = clientUtilizator(req);
    const { data: utilizator, error: eAuth } = await cititor.auth.getUser();
    if (eAuth || !utilizator.user) return eroare("Nu esti autentificat.", 401);

    const admin = clientServiciu();
    const parola = genereazaParola();

    if (conducere) {
      // Un presedinte sau un cenzor din afara blocului nu are cont, deci i-l
      // face administratorul. [C4] Dreptul se verifica INAINTE de a atinge
      // Auth: altfel orice om cu cont putea sa puna cheia de serviciu sa faca
      // si sa stearga conturi pe numere alese de el, iar o stergere cazuta
      // lasa un cont strain pe numarul unui om real.
      const numar = normalizeazaTelefon(telefon);
      if (!numar) return eroare("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
      if (!String(nume ?? "").trim()) return eroare("Scrie numele persoanei.");
      if (rol !== "presedinte" && rol !== "cenzor") return eroare("Mandatul este de presedinte sau de cenzor.");

      const { data: asociatie, error: eDreptAsoc } = await cititor.schema("identitate")
        .rpc("asociatia_de_administrat", { p_asociatie_id: asociatie_id ?? null });
      if (eDreptAsoc) return eroare("Doar administratorul asociatiei numeste presedintele si cenzorul.", 403);

      const { data: existent, error: eCautare } = await admin.schema("identitate").from("profiluri")
        .select("id").eq("telefon", numar).maybeSingle();
      if (eCautare) return eroare(eCautare.message);

      let profilId = existent?.id ?? null;
      if (!profilId) {
        const { data: cont, error: eCont } = await admin.auth.admin.createUser({
          email: adresaContului(numar)!,
          phone: `+4${numar}`,
          password: parola,
          email_confirm: true,
          phone_confirm: true,
          user_metadata: { nume: String(nume).trim(), telefon: numar },
        });
        if (eCont) return eroare(traduceAuth(eCont.message));
        profilId = cont.user.id;
      }

      // Mandatul se scrie cu tokenul administratorului, in asociatia pe care
      // tocmai am verificat-o, nu in "una dintre ale lui".
      const { error: eMandat } = await cititor.schema("identitate")
        .rpc("numeste_in_conducere", { p_profil_id: profilId, p_rol: rol, p_asociatie_id: asociatie });
      if (eMandat) {
        if (!existent) await admin.auth.admin.deleteUser(profilId);
        return eroare(eMandat.message, 403);
      }
      return raspuns({ profil_id: profilId, telefon: numar, parola: existent ? null : parola });
    }

    // Verifica dreptul pe apartament cu tokenul administratorului
    const { error: eDrept } = await cititor.schema("identitate").rpc("apartament_de_administrat", { p_apartament_id: apartament_id });
    if (eDrept) return eroare(eDrept.message, 403);

    if (actiune === "parola") {
      if (!locatar_id) return eroare("Lipseste locatarul.");
      const { data: locatar, error: e1 } = await admin.schema("identitate").from("locatari")
        .select("profil_id, activ_pana").eq("id", locatar_id).eq("apartament_id", apartament_id).maybeSingle();
      if (e1) return eroare(e1.message);
      if (!locatar) return eroare("Locatarul nu este al acestui apartament.", 404);
      // [A4] Un acces inchis nu primeste parola noua: omul s-a mutat.
      const azi = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Bucharest" });
      if (locatar.activ_pana && locatar.activ_pana <= azi) {
        return eroare("Locatarul nu mai are acces la acest apartament.");
      }
      const { error: e2 } = await admin.auth.admin.updateUserById(locatar.profil_id, { password: parola });
      if (e2) return eroare(traduceAuth(e2.message));
      // [A4] ... si cine era inauntru cu parola veche iese
      const { error: e5 } = await admin.schema("identitate").rpc("inchide_sesiunile", { p_profil_id: locatar.profil_id });
      if (e5) return eroare(e5.message);
      return raspuns({ parola });
    }

    const numar = normalizeazaTelefon(telefon);
    if (!numar) return eroare("Numarul de telefon nu este bun. Scrie-l ca in agenda: 07xx xxx xxx.");
    if (!String(nume ?? "").trim()) return eroare("Scrie numele locatarului.");

    // Acelasi om poate avea doua apartamente in acelasi bloc: numarul lui are
    // deja cont, deci nu se face altul, ci se leaga contul si de apartamentul
    // acesta. Parola lui ramane cea pe care o stie.
    const { data: existent, error: eCautare } = await admin.schema("identitate").from("profiluri")
      .select("id").eq("telefon", numar).maybeSingle();
    if (eCautare) return eroare(eCautare.message);
    if (existent) {
      const { data: legatId, error: eLegat } = await admin.schema("identitate").rpc("leaga_locatar", {
        p_profil_id: existent.id, p_apartament_id: apartament_id, p_calitate: calitate,
      });
      if (eLegat) return eroare(eLegat.message);
      return raspuns({ locatar_id: legatId, profil_id: existent.id, telefon: numar, parola: null });
    }

    const { data: cont, error: e3 } = await admin.auth.admin.createUser({
      email: adresaContului(numar)!,
      phone: `+4${numar}`,
      password: parola,
      email_confirm: true,
      phone_confirm: true,
      user_metadata: { nume: String(nume).trim(), telefon: numar },
    });
    // Mesajele Auth sunt in engleza si vorbesc despre adresa, care pentru om
    // nu exista: traduceAuth le da pe romaneste [A9].
    if (e3) return eroare(traduceAuth(e3.message));

    const { data: locatarId, error: e4 } = await admin.schema("identitate").rpc("leaga_locatar", {
      p_profil_id: cont.user.id, p_apartament_id: apartament_id, p_calitate: calitate,
    });
    if (e4) {
      // Contul ramane fara apartament daca legarea cade: il stergem, ca
      // administratorul sa poata incerca din nou cu acelasi numar.
      await admin.auth.admin.deleteUser(cont.user.id);
      return eroare(e4.message);
    }

    return raspuns({ locatar_id: locatarId, profil_id: cont.user.id, telefon: numar, parola });
  } catch (e) {
    return eroare((e as Error).message, 500);
  }
});
