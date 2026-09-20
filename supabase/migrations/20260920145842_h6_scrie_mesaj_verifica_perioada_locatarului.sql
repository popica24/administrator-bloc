-- H6: sesizari.scrie_mesaj() verifica doar ca apartamentul sesizarii e
-- printre apartamentele mele azi (private.apartamentele_mele()), fara
-- conditia de perioada pe care reparatia K4 a adaugat-o politicii de
-- citire ("Sesizarile proprii si cele din blocurile conduse": sesizarea
-- trebuie creata dupa activ_din al legaturii curente). Un proprietar nou
-- putea deci scrie in conversatia deschisa de predecesorul lui, desi nu o
-- putea citi — exact contradictia pe care K4 a vrut sa o elimine pentru
-- citire, ramasa la scriere.
--
-- Reparatie: acelasi test ca in politica RLS de citire, in loc de
-- private.apartamentele_mele().

create or replace function sesizari.scrie_mesaj(p_sesizare_id uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s sesizari.sesizari;
  v_admin boolean;
  v_locatar_in_perioada boolean;
begin
  select * into v_s from sesizari.sesizari where id = p_sesizare_id for update;
  if not found then
    raise exception 'Sesizarea nu exista.';
  end if;
  v_admin := v_s.bloc_id in (select private.blocuri_administrate());
  v_locatar_in_perioada := exists (
    select 1 from identitate.locatari l
    where l.profil_id = auth.uid()
      and l.apartament_id = v_s.apartament_id
      and l.activ_din <= current_date
      and (l.activ_pana is null or l.activ_pana > current_date)
      and v_s.creat_la >= l.activ_din
  );
  if not v_admin and not v_locatar_in_perioada then
    raise exception 'Nu poti scrie la aceasta sesizare.';
  end if;
  if v_s.stare = 'rezolvata' then
    raise exception 'Sesizarea este rezolvata. Scrie o sesizare noua daca problema a revenit.';
  end if;
  insert into sesizari.sesizari_mesaje (sesizare_id, autor_id, din_administratie, text)
  values (p_sesizare_id, auth.uid(), v_admin, btrim(p_text));
  if v_admin then
    if v_s.stare = 'noua' then
      update sesizari.sesizari set stare = 'in_lucru', preluata_de = auth.uid(), preluata_la = now() where id = p_sesizare_id;
    end if;
    perform evenimente.inregistreaza('SesizareRaspuns', 'sesizari', p_sesizare_id,
      jsonb_build_object('sesizare_id', p_sesizare_id, 'apartament_id', v_s.apartament_id, 'titlu', v_s.titlu, 'text', btrim(p_text)));
  end if;
end;
$$;
