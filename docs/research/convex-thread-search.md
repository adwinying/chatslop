# Thread search with Convex full-text search

Ticket: #6. Researched 2026-10-21 against the Convex docs and convex-backend `95d8719`, which uses the Convex tantivy fork at `2bb95af`.

## Answer

Yes for English and other space-separated text. Japanese needs a workaround.

Use two search indexes, each filtered by User: one on Thread titles and one on message text. Run both in one query function. Group message hits by Thread, list title hits first, and return at most around 20 Threads with `take()`. All of this works on self-hosted Convex.

The tokenizer splits only on whitespace and punctuation, so unspaced Japanese is indexed as whole clauses, and clauses of 11 or more kana or kanji are silently dropped. The fix is to store a derived `searchText` field in which CJK runs are expanded into space-separated bigrams. Apply the same transform to the query, then keep only hits whose original text contains the raw query.

## Findings

### Index shape and filtering by User

- A search index has exactly one `searchField`, which must be a `string`, plus up to 16 `filterFields` for equality filtering. Dot paths reach nested fields ([text search docs][ts]).
- A query is one `.search()` plus up to 8 `.eq()` on filter fields. Filters inside `withSearchIndex` run in the index. A later `.filter()` runs row by row on what the index returns, and those rows count toward the scan limit ([text search docs][ts]).
- So `userId` must be a field on each indexed document. Messages need `userId` stored on them, not only `threadId`.
- An AI SDK `parts` array can't be the search field. Store the plain text in a string field.
- Limits: at most 4 search indexes per table, which also count toward the 32 indexes per table ([limits][limits]).

### Titles and messages: two indexes

- An index covers one field on one table, and a query uses one index ([text search docs][ts]). Titles live on Threads and contents live on messages, so two indexes is the natural fit.
- Results are documents ordered by relevance. The docs describe no score field for text search, so title hits and message hits can't be merged by score. Use a fixed order instead: title matches, then Threads with matching messages.
- Grouping: take about 100 message hits and keep the first (best) hit per `threadId`. Load each Thread with `db.get`, and keep the matched message for a snippet. Convex returns no highlight offsets, so build the snippet in our own code.

```ts
// sketch; the schema itself belongs to #10
threads: defineTable({ userId: v.string(), title: v.string() /* ... */ })
  .searchIndex("search_title", { searchField: "title", filterFields: ["userId"] }),
messages: defineTable({ userId: v.string(), threadId: v.id("threads"), searchText: v.string() /* ... */ })
  .searchIndex("search_text", { searchField: "searchText", filterFields: ["userId"] }),

const titleHits = await ctx.db.query("threads")
  .withSearchIndex("search_title", (q) => q.search("title", text).eq("userId", userId))
  .take(20);
const messageHits = await ctx.db.query("messages")
  .withSearchIndex("search_text", (q) => q.search("searchText", text).eq("userId", userId))
  .take(100);
```

### Matching, relevance, ordering

- Query terms are OR-ed. A document matches if it contains at least one term, and filter fields are AND-ed ([convex_query.rs#L33-L36][cq]). `"react hooks"` also returns documents that contain only `react`.
- Ranking combines BM25 with proximity and the number of exact matches. When scores tie, newer documents come first. The docs say "relevance order is subject to change" ([text search docs][ts]).
- Only relevance order is supported. Recency can't be the sort order ([text search docs][ts]).
- The last query term is a prefix match, so typeahead works. Every other term must match exactly. There is no typo tolerance: `stake` does not match `snake` ([text search docs][ts]).
- Matching is case-insensitive and ignores punctuation ([text search docs][ts], [constants.rs][const]).

### Limits and pagination

- At most 16 terms per query. Terms of 32 bytes or more are silently dropped, both when indexing and in queries ([constants.rs][const], [remove_long.rs#L35-L37][rlong]).
- A search scans at most 1024 candidates from the index, and `.collect()` throws above 1024 ([text search docs][ts], [constants.rs][const]). Filtering on `userId` inside the index keeps that scope per User.
- `.paginate()` works with search ([text search docs][ts]), but pages hold messages, not Threads. Grouping by Thread breaks page boundaries. With fewer than 20 Users, one `take()` is enough. Skip pagination.
- Search queries are reactive ([text search docs][ts]), so a live search re-runs whenever indexed documents change. Debounce the input.

### Japanese (CJK) tokenization

- The tokenizer is tantivy's `SimpleTokenizer`, then `RemoveLongFilter(32)`, then `LowerCaser`, with no language analyzer. The docs say it "works best with English or other Latin-script languages" ([constants.rs][const], [text search docs][ts]).
- `SimpleTokenizer` ends a token at any character that is not `char::is_alphanumeric()` ([simple_tokenizer.rs#L27-L33][simple]). Kana and kanji count as alphanumeric, so `今日は良い天気ですね` is one token. `、` and `。` do split. Mixed text such as `Reactのフック` also becomes one token.
- The length check is in bytes: `token.text.len() < 32` ([remove_long.rs#L35-L37][rlong]). Kana and kanji take 3 bytes each in UTF-8, so Japanese runs of 11 or more characters vanish from the index.
- In practice a Japanese query matches only when it equals a whole short clause, or when it is a prefix of one and is the last term. Searching `天気` in the sentence above finds nothing.
- Workaround (my design, not from Convex):
  - On write, set `searchText = toSearchText(text)`. The function replaces each run of Han, Hiragana, Katakana, or `ー` with its overlapping bigrams, space-separated and padded with spaces, so `東京タワー` becomes ` 東京 京タ タワ ワー `. Latin text passes through unchanged.
  - Apply the same transform to the query. Then filter the hits in our code to those whose original text contains the raw query, case-insensitively. This removes the noise from OR-ed bigrams.
  - Caps: the 16-term limit means CJK queries can be about 17 characters long, so truncate longer ones. A single-kanji query only prefix-matches bigrams that start with it. Emitting a unigram for the last character of each run fixes this.
  - `Intl.Segmenter` might segment words better, but whether Convex's V8 runtime ships the ICU data for Japanese is unverified. The bigram approach needs no dependency and behaves deterministically.

### Writes during streaming

- Each write to an indexed field updates the search index and re-runs live search subscriptions ([text search docs][ts]). If resumable streams patch message text chunk by chunk, set `searchText` only once the message is complete. This is an input for #10.

### Cost and resources

- On Convex Cloud, each search query bills the full index size in query-GBs ([text search docs][ts], [limits][limits]). Self-hosted has no billing.
- The backend snapshots its in-memory search index at 10 MiB (soft limit) and rejects new additions at 100 MiB (hard limit) ([knobs.rs#L717-L832][knobs]). Our data volume won't come close.

### Self-hosted support

- "Self-hosted Convex supports all the free-tier features of the cloud-hosted product" ([self-hosted README][sh-readme]). Text search runs inside the backend process (`InProcessSearcher`, [searcher/in_process.rs][inproc]), so it needs no separate search service.
- Search index segments go to local storage under `/convex/data` unless S3 is configured ([self-hosted README][sh-readme], [s3_storage.md][s3]). This fits the single-volume setup from #3.
- The 2025-08-27 self-hosted release fixed "full text search bug where some filters were ignored" ([CHANGELOG][changelog]). Our `userId` scoping depends on filters, so pin an image built after that date. Any current image qualifies, including `95d8719`, the revision #3 researched.

## Recommendation

1. Add `userId` and `searchText` to messages, with `search_text` on `searchText` filtered by `userId`. Add `search_title` on Threads filtered by `userId`.
2. Write `searchText` through one shared `toSearchText()` (CJK bigrams) when a message finishes. Use it for queries too.
3. A single `searchThreads({ query })` query function: run both searches with `take()`, group message hits by Thread, list title hits first, post-filter CJK hits on the raw substring, and cap the result at about 20 Threads.
4. Debounce the input on the client and build snippets ourselves.
5. Add a smoke test with English and Japanese fixtures, covering prefix, mid-sentence kanji, and a long clause, against the pinned backend. Japanese behaviour depends on the tokenizer, and the docs don't spell it out.

## Open questions

- Should title matches be re-tokenized the same way? Yes if titles can be Japanese. Pass titles through `toSearchText` into a `searchTitle` field.
- If a User deletes Threads by soft delete, add `deletedAt` (or similar) as a filter field. The data model in #10 decides this.

[ts]: https://docs.convex.dev/search/text-search
[limits]: https://docs.convex.dev/production/state/limits
[const]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/search/src/constants.rs
[cq]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/search/src/convex_query.rs#L33-L36
[knobs]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/common/src/knobs.rs#L717-L832
[inproc]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/crates/search/src/searcher/in_process.rs
[sh-readme]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/README.md
[s3]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/advanced/s3_storage.md
[changelog]: https://github.com/get-convex/convex-backend/blob/95d8719cb6931cd2322453bb900dfcd5a732fe81/self-hosted/CHANGELOG.md
[simple]: https://github.com/convex/tantivy/blob/2bb95afa29cc2ac94e303ea68ca4e16222d8e777/src/tokenizer/simple_tokenizer.rs#L27-L33
[rlong]: https://github.com/convex/tantivy/blob/2bb95afa29cc2ac94e303ea68ca4e16222d8e777/src/tokenizer/remove_long.rs#L35-L37
