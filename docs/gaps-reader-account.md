# Gaps found while wiring the reader site's account pages (wave 2, agent J)

The reader site's pricing, checkout, My plan, library, history, help centre, site pages, bell and banner now read
these routes. What the site works around today, most useful first:

0. **Bug: deleting an account fails once the reader has voted on a help article.** `DELETE /me` (and Supabase's own
   admin delete) answers 500 "Database error deleting user": the cascade from `auth.users` deletes the reader's
   `help_article_votes`, whose `recount_article_votes()` trigger then updates `help_articles` as Supabase Auth's
   role, which has no rights on public tables. Fix: make `recount_article_votes()` `security definer` with
   `set search_path = public` (the same likely applies to any trigger a cascade from `profiles` can reach, e.g.
   `count_law_read()` if `catalogue_reads` ever cascades). Reproduced and worked around in testing by deleting the
   vote first.
1. **History and saved paths must start with `/dashboard/`.** Public pages (`/bd/laws/…`, `/bd/cases/…`) record
   visits and searches and offer "save"; the site rewrites `/bd/` to `/dashboard/` before sending. Accepting
   `/bd/…` (and storing the dashboard form) would let any caller send the page it is on.
2. **The seeded legal pages still say data lives in the browser.** `site_pages` privacy (`intro` glance points:
   "Your account, chats and plan are stored in your own browser for now", "You can clear everything we keep on
   your device") and the matching sections were imported from the old text. The content team should rewrite them
   in the admin panel now that everything is on the account.
3. **`GET /billing/plans` has no "popular" mark.** The site marks the cheapest paid plan as "Most popular". A
   `popular` (or `featured`) boolean on plans, set in the admin's Plans page, would let the team choose.
4. **The comparison table's rows are matched to the site's labels by position.** `matrix[i]` ↔ the dictionary's
   `pricing.compare.rows[i]`. Labels in both languages on each matrix row (`label: { en, bn }`) would remove the
   coupling.
5. **No `excluded` list per plan.** The plan cards list what a plan leaves out from the matrix rows that are
   `false` for it.
6. **Plan names/descriptions/features seeded by `supabase/seed.sql` are shorter than the site's old copy** (for
   example "Read the laws and a few judgments."). Fine, but the team may want to edit them in Plans.
7. **No email when a payment is verified or rejected.** The confirmation page says "We'll email you when your
   plan is active"; `POST /admin/billing/payments/:id/verify|reject` could send that (billing email can't be
   turned off).
8. **Article votes: no way to read the reader's own vote.** `GET /content/articles/:slug` could carry `myVote`
   for a signed-in reader so the thumbs show their earlier answer.
9. **The bell has no paging** (`GET /content/announcements` returns everything); fine for now, worth a `limit`.
10. **`DELETE /library/history` takes `only` as a query parameter** while other filters are bodies; documented in
    docs/library.md as `only?` without saying where. The site sends `?only=`.


## Status (agent F)

| # | Now |
| --- | --- |
| 0 | Reproduced against the live database today and it no longer fails (`recount_article_votes()` runs as its owner with `search_path = public`); a vote plus a read, then `DELETE /me`, gives 204. |
| 1 | `/bd/laws/…` and `/bd/cases/…` are accepted on saved items and history and stored as `/dashboard/…`. |
| 2 | Content for the team to rewrite in the panel (the privacy page's text); not changed by the API. |
| 3 | `popular` on plans (one at most), set with `PUT /admin/billing/plans/:id/popular`; Researcher carries it now, as the site showed. |
| 4 | Each matrix row has `label: { en, bn }`. |
| 5 | `excluded: [{ key, label }]` on each plan from `GET /billing/plans`. |
| 6 | Content for the team (Plans page). |
| 7 | Verifying or rejecting a payment emails the reader, in their language. |
| 8 | `myVote` on `GET /content/articles/:slug` with a reader token. |
| 9 | The bell pages with `limit` and `before`; `unread` counts the whole bell; `next` gives the next `before`. |
| 10 | docs/library.md says `only` is a query parameter. |
