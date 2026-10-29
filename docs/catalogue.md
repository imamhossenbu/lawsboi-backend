# Catalogue API

Laws, their sections and Orders, judgments and search. Public routes need no sign-in and return only published
rows; team routes under `/admin/catalogue` need a team token and the `laws.*` permissions.

Text fields that the content team edits come as `{ "en": "...", "bn": "..." }` (`Text`); where no Bangla exists the
enacted text stands in for both, as the reader site did. Laws and judgments are addressed by slug
(`cpc-1908`, `19-scob-2024-ad-1`); sections by number (`151`, `561A`), Orders by id (`39`, `27A`).

Blocks are the reader's own: `{ kind: "para" | "clause" | "tail", mark?, text, notes?: number[] }`.

## Public

| Route | Query / body | Returns |
| --- | --- | --- |
| `GET /catalogue/subjects` | | `{ subjects: [{ key, label: Text }], types: [{ key, label: Text }] }` |
| `GET /catalogue/totals` | | `{ laws: { constitution, act, ordinance, po, amendments }, courts: { supreme, AD, HCD, district, tribunal } }` |
| `GET /catalogue/laws` | `q`, `field=all\|title\|actNo\|year`, `types=act,ordinance`, `statuses=in-force,repealed`, `yearFrom`, `yearTo`, `subject`, `letter` (A–Z or a Bangla letter), `sort=popular\|newest\|oldest\|az\|za`, `page`, `perPage` (≤200, or `all` for the whole catalogue) | `{ laws: LawRecord[], total, page, perPage }` |
| `GET /catalogue/laws/search` | `q`, `limit` (≤500) | `{ hits: LawHit[] }` — provisions ranked in Postgres; a query naming a provision ("section 151", "o.39 r.1", "১৪৪") goes straight to it; matching laws come first as `kind: "act"` |
| `GET /catalogue/laws/:slug` | | `{ law: LawRecord, parts: [{ id, title: Text, range, banner, sub, sections: [{ n, title: Text }] }], orders: [{ n, roman, title: Text, ruleCount }], translated }` |
| `GET /catalogue/laws/:slug/text` | | `{ text: ActText }` — every part and section with body, footnotes and translation, for the reading view |
| `GET /catalogue/laws/:slug/sections/:n` | | `{ section: SectionView }` — body, explanation, translation `{ title, body[], footnotes[] }`, footnotes, amendments, related, prev/next |
| `GET /catalogue/laws/:slug/orders/:n` | | `{ order: { n, roman, title: Text, rules: [{ n, title: Text, body, translation }], prev, next } }` |
| `GET /catalogue/laws/:slug/cases` | | `{ cases: RelatedCase[] }` — judgments citing the law, newest first, with `provision` and `refs` |
| `GET /catalogue/cases` | `q`, `field=all\|title\|citation\|judge\|law`, `courts=AD,HCD`, `types=civil,…`, `yearFrom`, `yearTo`, `law` (slug or title words), `sort=latest\|oldest\|az\|za`, `page`, `perPage` | `{ cases: CaseSummary[], total, page, perPage }` |
| `GET /catalogue/cases/latest` | `limit` | `{ cases: CaseSummary[] }` — newest with a known date |
| `GET /catalogue/cases/:slug` | | `{ case: CaseDetail }` — text (paragraphs), translation, parties, advocates, citations, `laws` with titles, related, prev/next |
| `GET /catalogue/home` | | `{ laws: LawRecord[6], cases: CaseSummary[5], sections: [{ href, law, n, label: Text, title: Text, lawTitle: Text, views: { month, week } }] }` |
| `POST /catalogue/reads` | `{ kind: law\|section\|order\|judgment, slug, n? }` (optional reader token) | `202` — counts towards "most viewed" and the home page's trends |

### Shapes

```ts
LawRecord = { slug, bdlawsId, title: Text, description: Text, actNo: Text, year, type: "constitution"|"act"|"ordinance"|"po",
  status: "in-force"|"repealed", subject, sections: number, unit: "sections"|"articles", orders?: number, language?: "bn",
  curated, views, published, longTitle, preamble, date, updatedAt }
LawHit = { id, kind: "act"|"section"|"rule", slug, lawTitle: Text, heading: Text, title: Text, n, orderN, roman,
  snippet: Text, numbers: string[], year, status, lawType, subject, href, views }
CaseSummary = { slug, title, titleTr, citation, caseNo, court: "AD"|"HCD", date, dateKnown, year, judges, author, type,
  keywords, excerpt, language, published, paragraphs, updatedAt,
  laws: [{ law, lawTitle: Text, readable, kind: "law"|"section"|"article"|"order"|"rule", n, rule }] }
RelatedCase = { slug, title, citation, court, date, dateKnown, provision: { kind, n, rule }, refs: [...], summary, keywords }
```

`href` values are language-neutral site paths (`/dashboard/laws/cpc-1908/section-151`, `/bd/cases/<slug>`); the
reader site prefixes `/bn` itself.

## Team (`/admin/catalogue`, team token)

| Route | Permission | Body | Returns |
| --- | --- | --- | --- |
| `GET /laws` | laws.view | `q`, `status=all\|published\|draft`, `type`, `subject`, `language`, `sort=updated\|az\|newest\|popular`, `page`, `perPage` | `{ laws: (LawRecord & { translated })[], total, … }` |
| `GET /laws/:slug` | laws.view | | the public detail plus `text: ActText` and `history` |
| `GET /laws/:slug/history` | laws.view | | `{ history: [{ at, kind, n, law, by }] }` |
| `POST /laws` | laws.add | `{ slug?, title, titleBn?, actNo, actNoBn?, year, type, status, subject, description, descriptionBn?, language, unit, longTitle, preamble, date, bdlawsId?, parts: [{ id, title, titleTr?, range, banner?, sub?, sections: [{ n, title, body, notes }] }], translations: { [n]: { title, b, f? } }, published }` | `201` the detail; drafts unless `published` |
| `PATCH /laws/:slug` | laws.edit | any of the metadata fields | `{ law }` |
| `POST /laws/:slug/publish` | laws.publish | `{ published }` | `{ law }` |
| `PUT /laws/:slug/sections/:n` | laws.edit | `{ title, body, notes? }` | `{ section }` |
| `PUT /laws/:slug/sections/:n/translation` | laws.translate | `{ title, b: string[], f?: string[] }` | `{ translation }` |
| `DELETE /laws/:slug/sections/:n/translation` | laws.translate | | `204` |
| `GET /cases` | laws.view | `q`, `status`, `court`, `type`, `sort=updated\|latest\|oldest\|az`, `page`, `perPage` | `{ cases: CaseSummary[], total, … }` (drafts included) |
| `GET /cases/:slug` | laws.view | | `{ case: CaseDetail, history }` |
| `POST /cases` | laws.cases | `{ slug?, title, titleTr?, citation, caseNo, origin?, court, date?, dateKnown, hearing?, judges, author?, type, keywords, parties?, petition, advocates, excerpt, citationsReferred, related, source?, language, paragraphs, paragraphsTr?, laws: [{ law, kind, n, rule? }], published }` | `201 { case }` |
| `PATCH /cases/:slug` | laws.cases | any of those fields, `paragraphs`, `paragraphsTr` | `{ case }` |
| `POST /cases/:slug/publish` | laws.publish | `{ published }` | `{ case }` |
| `PUT /cases/:slug/links` | laws.link | `{ links: [{ law, kind, n, rule? }] }` | `{ case }` — replaces the citations; each one added or removed is a history entry |

Every write adds a row to `catalogue_revisions` (the History tab) and an audit entry (`law.create`, `law.edit`,
`law.section`, `law.translate`, `law.untranslate`, `law.publish`, `law.unpublish`, `case.create`, `case.edit`,
`case.link`, `case.unlink`).

## Data

`npx tsx --env-file=.env scripts/import-catalogue.ts [--only=laws,cpc,judgments]` loads the reader site's data
(`READER_DIR`, default `../lawsboi`): 1,298 laws with 36,588 sections, the CPC's 52 Orders and 618 Rules with
their Bangla translations, and 352 SCOB judgments with 734 citations. It upserts laws and judgments by slug and
replaces their parts, sections, Orders, Rules and citations, so it can be run again.

Search runs in Postgres: `law_sections`, `law_rules`, `laws` and `judgments` carry a `search` tsvector
(`simple` configuration, Bangla digits folded to ASCII) with GIN indexes, queried through the `search_provisions`,
`search_laws` and `search_judgments` functions.
