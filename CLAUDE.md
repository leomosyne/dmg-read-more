# CLAUDE.md — DMG Read More

Context file for Claude Code sessions. This project is a **WordPress tech test** (DMG Media style): a Gutenberg block + a WP-CLI command, delivered as a single plugin. Leo is preparing it for interview review, so code quality, performance rationale, and being able to *explain every decision* matter as much as functionality.

## What this plugin is

Two deliverables, both in this one plugin:

1. **Gutenberg block `dmg/read-more`** — lets editors search for a published post (in InspectorControls) and inserts a stylized anchor link to it. Built with native WP React tooling (`@wordpress/scripts`), no ACF or other plugin dependencies (a hard requirement of the brief).
2. **WP-CLI command `wp dmg-read-more search`** — finds IDs of posts containing that block within a date range. Must stay performant against `wp_posts` tables with **tens of millions of rows** (explicit requirement; expect the reviewer to probe this).

## Required output format (from the brief — do not change)

The block must save exactly this shape:

```html
<p class="... dmg-read-more">Read More: <a href="{post permalink}">{post title}</a></p>
```

- Paragraph element with CSS class `dmg-read-more` (block wrapper class `wp-block-dmg-read-more` also appears — that's fine, the required class is present).
- Anchor text = post title; href = permalink; literal `Read More: ` prepended before the anchor.
- Choosing a different post must update the link in the editor (it does — attributes drive both edit preview and save).

## Repo layout

```
dmg-read-more/
├── dmg-read-more.php                       # Bootstrap: block registration (anonymous init callback) + CLI registration
├── includes/
│   └── ReadMoreCommand.php                 # Leo\DmgReadMore\ReadMoreCommand — the WP-CLI command
├── src/                                    # Block source (JS/SCSS) — compiled by wp-scripts into build/
│   ├── block.json                          # apiVersion 3; attributes: postId (number), postTitle, postUrl (strings)
│   ├── index.js                            # registerBlockType
│   ├── edit.js                             # Inspector search UI + editor preview (the interesting file)
│   ├── save.js                             # Static save; returns null if no postId/postUrl
│   ├── editor.scss                         # Sidebar results-list styles
│   └── style.scss                          # Front-end link styles
├── build/                                  # Compiled output — currently GITIGNORED, see "Known issues"
├── phpcs.xml                               # PSR-12, scans dmg-read-more.php + includes/ only
├── composer.json                           # php_codesniffer ^4.0; scripts: lint / lint:fix; PSR-4 autoload (see gotcha)
├── package.json                            # @wordpress/scripts; npm run build / start
└── .husky/, .prettierrc, .eslintrc, ...    # Leo's own tooling additions
```

## Commands

```bash
npm install && npm run build     # compile the block (webpack via wp-scripts) → build/
npm run start                    # watch mode
composer install                 # dev deps (phpcs)
composer lint                    # phpcs (PSR-12) — passes clean as of last session
composer lint:fix                # phpcbf auto-fix
php -l <file>                    # syntax check (no WP install needed)
```

**After editing anything in `src/`, you must `npm run build` and the user must hard-refresh the editor (Cmd+Shift+R)** — the editor loads `build/index.js`, not the source.

## How the block works (src/edit.js)

- **Data fetching**: direct `apiFetch` to `/wp/v2/posts` with `parse: false` so the `X-WP-TotalPages` response header drives pagination. `_fields=id,title,link` keeps payloads minimal. Deliberately NOT `getEntityRecords` — chosen to get total-pages cheaply and keep control of merging.
- **Default state**: no search term → recent posts, `orderby=date`. With a term → `orderby=relevance`. 10 per page (`PER_PAGE`), Previous/Next buttons + "Page X of Y".
- **Post-ID search**: if the (trimmed) search term is all digits and we're on page 1, an extra fetch to `/wp/v2/posts/<id>` runs; a hit is merged (deduped) to the top of the text-search results. A 404 is swallowed — text results still show.
- **Debounce (was a bug, now fixed)**: `useDebounce` from `@wordpress/compose` memoizes on callback identity and *cancels the pending timer when the callback changes*. An inline arrow callback meant every keystroke's re-render cancelled the pending call → search never fired. Fix: callback wrapped in `useCallback` with `[]` deps (`setQueryAndResetPage`). **Do not "simplify" this back to an inline function.**
- **Stale-response guard**: monotonic counter in `fetchIdRef`; late responses from superseded requests are discarded.
- **Selection**: stores `postId`, decoded `postTitle`, `postUrl` as attributes. Save is fully static — zero front-end queries. Title entities are decoded on selection (`decodeEntities`), empty titles fall back to "(no title)".
- Editor preview anchor has `onClick` preventDefault so editors don't navigate away.

## How the CLI command works (includes/ReadMoreCommand.php)

`wp dmg-read-more search [--date-after=<date>] [--date-before=<date>]`

- Dates accept anything `strtotime()`-compatible; both omitted → defaults to `--date-after="30 days ago"`. Invalid dates or after > before → `WP_CLI::error` (non-zero exit).
- **Output contract**: matching post IDs to STDOUT, one per line, nothing else. "No posts found" is a `WP_CLI::warning`, errors are `WP_CLI::error` — both STDERR, so STDOUT pipes cleanly (`| wc -l`). Per-batch progress and final count only appear with `--debug`.
- **Performance design** (be ready to defend each point):
  - `WP_Query` with `fields => 'ids'` — never hydrates post objects.
  - **Keyset pagination**: batches of 1000 (`BATCH_SIZE`) using `WHERE ID < cursor ORDER BY ID DESC` via a `posts_where` filter, NOT `paged`/OFFSET (OFFSET degrades linearly on huge tables). Cursor lives in `$this->cursorId`; loop continues while a full batch comes back.
  - **Targeted LIKE, not `s=`**: `post_content LIKE '%<!-- wp:dmg/read-more %'`. WP_Query's `s` would also scan title/excerpt and add relevance ordering. `BLOCK_MARKER` has a **deliberate trailing space** — matches the block comment with or without attributes while excluding other blocks whose names merely start with `dmg/read-more`. Don't trim it.
  - `no_found_rows`, `cache_results => false`, meta/term cache updates off.
  - The `date_query` narrows via the `type_status_date` index before the unindexed leading-wildcard LIKE evaluates.
  - The LIKE clause is gated on a custom query var (`dmg_read_more_search`) so the filter can't leak into other queries; the filter is removed after the loop (and in the catch path).

## Coding standards & conventions

- **PHP: PSR-12** (Leo's explicit choice, enforced via `phpcs.xml`, phpcs 4.x). This is *not* WPCS — so no space-inside-parens, braces on their own lines for functions/classes, camelCase methods, PascalCase classes, 4-space indent. `composer lint` must stay green.
- CLI class is namespaced `Leo\DmgReadMore` (matches composer's vendor namespace), class `ReadMoreCommand`, methods `search` / `filterPostsWhere` / `validateDate`. The hook callbacks reference method names as strings — if renaming methods, update the `add_filter`/`remove_filter` arrays too.
- The bootstrap intentionally has **no named function declarations** (anonymous `init` callback) so PSR-1's "no symbols + side effects in one file" sniff passes without exclusions. Keep it that way.
- JS: Leo reformatted to his own Prettier config (4-space, single quotes, arrow parens avoided). Match the existing file style, not WP's default 	tab style.
- Husky + commitlint are set up — commits may be checked for conventional-commit format.

## Known issues / open decisions (as of 2026-07-29)

1. **`/build` is gitignored** but the README says the compiled build ships with the repo. For a tech test, a reviewer cloning the repo won't have the block until they run `npm install && npm run build`. Leo was advised to either un-ignore `build/` or fix the README claim. **Unresolved — check with Leo before "fixing" either way.**
2. ~~Composer PSR-4 mismatch~~ — RESOLVED: autoload now maps `Leo\DmgReadMore\` → `includes/` and the class file is `includes/ReadMoreCommand.php`. The bootstrap still uses a plain `require_once` (the plugin doesn't load `vendor/autoload.php`, and shouldn't need to just for one class); the mapping exists for coherence and any future tooling.
3. **Hover colour**: Leo is styling the link hover with `--wp--preset--color--vivid-cyan-blue`. Advice given: keep the preset but add a fallback (`var(--wp--preset--color--vivid-cyan-blue, #0693e3)`) because themes with `defaultPalette: false` won't output that variable; or let the theme's link styles cascade. Whatever he lands on may already be in `style.scss` — read it before commenting.
4. The user has been making his own edits throughout (formatting, tooling, styles) — **always read current file state before editing; don't assume the last-known content**.

## Environment / workflow notes

- **No Docker on Leo's machines** — never suggest `wp-env` or Docker-based testing. Verification is static: `php -l`, `composer lint`, `npm run build`. He has a real WP install somewhere (he runs `wp` commands himself); give him commands to run rather than trying to run WP here.
- Test-data recipes already given to him:
  - Bulk filler: `wp post generate --count=50000 --post_status=publish`
  - Posts actually containing the block (for CLI testing): loop of `wp post create --post_content='<!-- wp:dmg/read-more {...} --><p class="wp-block-dmg-read-more dmg-read-more">Read More: <a href="...">...</a></p><!-- /wp:dmg/read-more -->'` with randomized `--post_date` over the last 60 days (macOS `date -v` syntax). Roughly half fall in the default 30-day window — useful sanity check: plain `wp dmg-read-more search` ≈ half, `--date-after="60 days ago"` = all.
- Interview framing: when Leo asks "would X pass / is Y good enough", he wants a defensible position with the trade-offs spelled out, not just a yes/no.
