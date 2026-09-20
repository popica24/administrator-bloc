-- [K12] preia_sesizare nu facea nimic, fara nicio eroare, cand nu se putea
-- aplica (sesizare deja in lucru/rezolvata, din alt bloc, sau apelata de
-- cineva care nu administreaza blocul), iar UI-ul arata totusi "Sesizarea
-- este in lucru". Acum e consecventa cu sesizari.rezolva_sesizare: un singur
-- update cu toate conditiile, si o eroare clara cand nu s-a schimbat nimic.

create or replace function sesizari.preia_sesizare(p_sesizare_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s sesizari.sesizari;
begin
  update sesizari.sesizari
     set stare = 'in_lucru', preluata_de = auth.uid(), preluata_la = now()
   where id = p_sesizare_id and stare = 'noua' and bloc_id in (select private.blocuri_administrate())
  returning * into v_s;
  if not found then
    raise exception 'Sesizarea nu exista, este deja preluata sau nu este din blocul tau.';
  end if;
end;
$$;
