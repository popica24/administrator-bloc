-- Golurile din jurnalul de audit (audit 2: X08).
--
-- audit.jurnal acoperea asociatiile, apartamentele, persoanele, locatarii,
-- administratorii, mandatele, listele, cheltuielile, citirile, sesizarile,
-- datoriile, platile si miscarile de fond, dar nu si tabelele in care se vede
-- cine a decis ceva si cine a incasat: voturile si optiunile lor (cine a
-- schimbat textul unei variante dupa ce lumea a votat), voturile exprimate,
-- documentele (cine a ascuns un document de locatari), invitatiile (cine a
-- facut sau a revocat un cod de acces) si chitantele, care sunt documente
-- fiscale cu numerotare fara goluri.
--
-- Trigger-ul este acelasi audit.inregistreaza() folosit peste tot.

create trigger voturi_audit after insert or update or delete on guvernanta.voturi
  for each row execute function audit.inregistreaza();
create trigger voturi_optiuni_audit after insert or update or delete on guvernanta.voturi_optiuni
  for each row execute function audit.inregistreaza();
create trigger voturi_exprimate_audit after insert or update or delete on guvernanta.voturi_exprimate
  for each row execute function audit.inregistreaza();
create trigger documente_audit after insert or update or delete on comunicare.documente
  for each row execute function audit.inregistreaza();
create trigger invitatii_audit after insert or update or delete on identitate.invitatii
  for each row execute function audit.inregistreaza();
create trigger chitante_audit after insert or update or delete on financiar.chitante
  for each row execute function audit.inregistreaza();
