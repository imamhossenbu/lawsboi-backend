import { createClient } from "@supabase/supabase-js";
import { putFile } from "../src/lib/storage.js";
import { db } from "../src/lib/supabase.js";

// One-off: copies every ticket attachment from the old Supabase Storage bucket "ticket-files" to the new storage (S3_*), under the
// same key, so the storage_path in ticket_files keeps pointing at it. Safe to run again (it overwrites).
// Needs SUPABASE_URL, SUPABASE_SECRET_KEY and S3_* in .env. Delete the Supabase bucket once this has finished.

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, { auth: { persistSession: false } });
const { data: files, error } = await db.from("ticket_files").select("id, storage_path, mime");
if (error) throw new Error(error.message);

let moved = 0;
for (const f of files ?? []) {
  const { data, error: dl } = await supabase.storage.from("ticket-files").download(f.storage_path);
  if (dl || !data) {
    console.warn(`skipped ${f.storage_path}: ${dl?.message ?? "not found"}`);
    continue;
  }
  await putFile(f.storage_path, Buffer.from(await data.arrayBuffer()), f.mime);
  moved++;
}
console.log(`${moved} of ${files?.length ?? 0} files copied to the new storage.`);
