# DMG Read More

A WordPress plugin containing:

1. **A Gutenberg block** (`dmg/read-more`) that lets editors search for a published post and insert a stylized "Read More" anchor link to it.
2. **A WP-CLI command** (`wp dmg-read-more search`) that finds posts containing that block within a date range, built to stay fast against very large `wp_posts` tables.

Built with native WordPress React tooling (`@wordpress/scripts`) — no ACF or other plugin dependencies.

## Installation

```bash
cd wp-content/plugins/dmg-read-more
npm install
npm run build
wp plugin activate dmg-read-more
```

## The block

Insert **Read More Link** from the block inserter. In the block sidebar (InspectorControls) you can:

- Browse **recent posts** (shown by default, newest first).
- **Search** by keyword — debounced, ordered by relevance.
- Search by **post ID** — a numeric search term is also looked up as an exact ID, and any match is surfaced at the top of the results.
- **Paginate** through results (10 per page, with Previous/Next and a page indicator).

Choosing a post immediately updates the preview in the editor canvas. The saved markup is:

```html
<p class="wp-block-dmg-read-more dmg-read-more">
	Read More: <a href="https://example.com/post-permalink/">Post Title</a>
</p>
```

- Anchor text = post title, anchor href = post permalink.
- The anchor is prepended with `Read More: ` inside a paragraph carrying the `dmg-read-more` class.

Design notes:

- Search uses the REST API (`/wp/v2/posts`) via `apiFetch` with `parse: false` so the `X-WP-TotalPages` header drives pagination, and `_fields=id,title,link` to keep responses minimal.
- Stale responses from superseded requests are discarded, so fast typing can't clobber newer results.
- The chosen post's ID, title, and permalink are stored as block attributes, so rendering is static — no extra queries on the front end.

## The WP-CLI command

```bash
# Posts from the last 30 days (the default) containing the block:
wp dmg-read-more search

# Explicit date range (any strtotime()-compatible values):
wp dmg-read-more search --date-after=2026-01-01 --date-before=2026-06-30

# Open-ended — everything since a date:
wp dmg-read-more search --date-after=2026-01-01
```

Matching post IDs are logged to **STDOUT, one per line**. Warnings ("no posts found") and errors go to STDERR, so the output pipes cleanly, e.g. `wp dmg-read-more search | wc -l`. Run with `--debug` for per-batch progress.

### Performance approach

The command is designed for `wp_posts` tables with tens of millions of rows:

- **`WP_Query` with `fields => 'ids'`** — never hydrates full post objects.
- **Batched keyset pagination** — fetches 1,000 IDs at a time using a `WHERE ID < <last seen ID> ORDER BY ID DESC` cursor via `posts_where`, instead of `paged`/`OFFSET`, which degrades linearly as the offset grows. Memory usage stays flat no matter how many rows match.
- **Targeted `LIKE` instead of `s=`** — a `posts_where` filter matches `post_content LIKE '%<!-- wp:dmg/read-more %'` only. WP_Query's native `s` parameter would also scan `post_title` and `post_excerpt` and apply relevance ordering. The trailing space in the marker matches the block both with and without attributes while excluding other blocks whose names merely start with `dmg/read-more`.
- **No wasted work** — `no_found_rows`, `cache_results => false`, and skipped meta/term cache priming, since we only ever need the IDs (`SQL_CALC_FOUND_ROWS` alone can double query cost).
- The `date_query` on `post_type`/`post_status`/`post_date` lets MySQL use the `type_status_date` index to narrow the candidate set before the (unavoidably unindexed) leading-wildcard `LIKE` is evaluated.
- The `LIKE` clause is gated on a custom query flag, so the filter can never leak into other queries running in the same process.

Errors (invalid dates, inverted ranges, query failures) exit non-zero with a clear message; an empty result set produces a warning log message.

## Project structure

```
dmg-read-more/
├── dmg-read-more.php                        # Plugin bootstrap: block + CLI registration
├── includes/
│   └── ReadMoreCommand.php                  # WP-CLI `dmg-read-more search`
├── src/                                     # Block source (compiled to build/)
│   ├── block.json
│   ├── index.js
│   ├── edit.js                              # Inspector search UI + editor preview
│   ├── save.js                              # Static front-end markup
│   ├── editor.scss
│   └── style.scss
└── build/                                   # Compiled assets (wp-scripts build)
```
