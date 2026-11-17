-- LancerSnap protected report image storage (LS-08, RC-09)
--
-- A PRIVATE bucket for report photographs. There are deliberately no
-- storage.objects policies for it, so nobody can list, read, upload, or delete
-- files in it with a user token or the publishable key. All access goes
-- through the backend, which checks report permissions and then hands out a
-- short-lived signed URL for one file.
--
-- The size and type limits are also enforced by Supabase Storage itself, so a
-- signed upload URL cannot be used to store something else.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'report-media',
  'report-media',
  false,
  10485760, -- 10 MB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;
