create function private.client_piece(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
select auth.uid() is not null and exists(select 1 from public.clients where id=cid and auth_user_id=auth.uid())
$$;
revoke all on function private.client_piece(uuid) from public,anon;
grant execute on function private.client_piece(uuid) to authenticated;
alter policy pieces_storage_insert on storage.objects with check(bucket_id='pieces-missions' and (storage.foldername(name))[2]=auth.uid()::text and private.acces_dossier_piece(((storage.foldername(name))[1])::uuid,null,false));
alter policy pieces_lecture on public.pieces_mission using(public.est_admin() or auteur=auth.uid() or (partage_client and private.client_piece(client_id)) or (partage_partenaire and exists(select 1 from public.missions m join public.convoyeurs p on p.id=m.convoyeur_id where m.id=mission_id and p.auth_user_id=auth.uid() and public.partenaire_actif())));
