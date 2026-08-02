<?php

/**
 * WP-CLI command for the DMG Read More plugin.
 *
 * Only loaded from the plugin bootstrap when WP-CLI is running.
 *
 * @package dmg-read-more
 */

namespace Leo\DmgReadMore;

use Throwable;
use WP_CLI;
use WP_Query;

/**
 * Finds posts containing the dmg/read-more block.
 */
class ReadMoreCommand
{
    /**
     * Leading fragment of the serialized block comment. The trailing space is
     * intentional: it matches both "<!-- wp:dmg/read-more -->" and
     * "<!-- wp:dmg/read-more {"postId":1} -->" while excluding any other block
     * whose name merely starts with "dmg/read-more".
     */
    private const BLOCK_MARKER = '<!-- wp:dmg/read-more ';

    /**
     * Number of post IDs fetched per query. Keeps memory flat regardless of
     * how many rows match.
     */
    private const BATCH_SIZE = 1000;

    /**
     * Keyset-pagination cursor: only rows with ID below this are fetched.
     *
     * @var int
     */
    private $cursorId = 0;

    /**
     * Searches published posts for the dmg/read-more block within a date range.
     *
     * Logs each matching post ID to STDOUT, one per line. Warnings and errors
     * go to STDERR so the ID stream stays pipeable.
     *
     * ## OPTIONS
     *
     * [--date-after=<date>]
     * : Only include posts published on or after this date. Accepts any
     * strtotime()-compatible value, e.g. 2026-01-01. When both date options
     * are omitted, defaults to 30 days ago.
     *
     * [--date-before=<date>]
     * : Only include posts published on or before this date. Accepts any
     * strtotime()-compatible value, e.g. 2026-06-30.
     *
     * ## EXAMPLES
     *
     *     # Posts from the last 30 days containing the block.
     *     wp dmg-read-more search
     *
     *     # Posts within an explicit date range.
     *     wp dmg-read-more search --date-after=2026-01-01 --date-before=2026-06-30
     *
     *     # Open-ended range: everything since 1st Jan 2026.
     *     wp dmg-read-more search --date-after=2026-01-01
     *
     * @when after_wp_load
     *
     * @param array $args       Positional arguments (unused).
     * @param array $assoc_args Associative arguments.
     */
    public function search($args, $assoc_args)
    {
        $before = $assoc_args['date-before'] ?? null;
        $after  = $assoc_args['date-after'] ?? null;

        // Default to the last 30 days when no range is supplied.
        if (null === $before && null === $after) {
            $after = '30 days ago';
        }

        $after_ts  = $this->validateDate($after, 'date-after');
        $before_ts = $this->validateDate($before, 'date-before');

        if (null !== $after_ts && null !== $before_ts && $after_ts > $before_ts) {
            WP_CLI::error('The --date-after value is later than the --date-before value.');
        }

        $date_query = array( 'inclusive' => true );
        if (null !== $after) {
            $date_query['after'] = $after;
        }
        if (null !== $before) {
            $date_query['before'] = $before;
        }

        $this->cursorId = 0;
        $total          = 0;

        add_filter('posts_where', array( $this, 'filterPostsWhere' ), 10, 2);

        try {
            do {
                $query = new WP_Query(
                    array(
                        'post_type'              => 'post',
                        'post_status'            => 'publish',
                        'posts_per_page'         => self::BATCH_SIZE,
                        // Only fetch IDs: avoids hydrating full post objects.
                        'fields'                 => 'ids',
                        // Keyset pagination (WHERE ID < cursor ORDER BY ID DESC)
                        // instead of paged/OFFSET, which degrades linearly on
                        // large tables.
                        'orderby'                => 'ID',
                        'order'                  => 'DESC',
                        'no_found_rows'          => true,
                        'ignore_sticky_posts'    => true,
                        'cache_results'          => false,
                        'update_post_meta_cache' => false,
                        'update_post_term_cache' => false,
                        'suppress_filters'       => false,
                        'date_query'             => $date_query,
                        // Flag consumed by filterPostsWhere() so the LIKE
                        // clause only ever applies to this command's queries.
                        'dmg_read_more_search'   => true,
                    )
                );

                $ids = $query->posts;

                foreach ($ids as $id) {
                    WP_CLI::log((string) $id);
                }

                $batch_count = count($ids);
                $total      += $batch_count;

                if ($batch_count > 0) {
                    $this->cursorId = (int) end($ids);
                }

                WP_CLI::debug(
                    sprintf('Batch complete: %d IDs (running total %d).', $batch_count, $total),
                    'dmg-read-more'
                );
            } while ($batch_count === self::BATCH_SIZE);
        } catch (Throwable $e) {
            remove_filter('posts_where', array( $this, 'filterPostsWhere' ));
            WP_CLI::error('Search failed: ' . $e->getMessage());
        }

        remove_filter('posts_where', array( $this, 'filterPostsWhere' ));

        if (0 === $total) {
            WP_CLI::warning(
                'No published posts containing the dmg/read-more block were found in the given date range.'
            );
            return;
        }

        WP_CLI::debug(sprintf('Found %d matching post(s).', $total), 'dmg-read-more');
    }

    /**
     * Narrows the query to posts whose content contains the serialized block,
     * and applies the keyset-pagination cursor.
     *
     * @param string   $where SQL WHERE clause.
     * @param WP_Query $query Current query.
     * @return string
     */
    public function filterPostsWhere($where, $query)
    {
        global $wpdb;

        if (true !== $query->get('dmg_read_more_search')) {
            return $where;
        }

        $where .= $wpdb->prepare(
            " AND {$wpdb->posts}.post_content LIKE %s",
            '%' . $wpdb->esc_like(self::BLOCK_MARKER) . '%'
        );

        if ($this->cursorId > 0) {
            $where .= $wpdb->prepare(" AND {$wpdb->posts}.ID < %d", $this->cursorId);
        }

        return $where;
    }

    /**
     * Validates a date option, exiting with an error message if unparseable.
     *
     * @param string|null $value Raw option value.
     * @param string      $flag  Option name, for error messages.
     * @return int|null Unix timestamp, or null when no value was given.
     */
    private function validateDate($value, $flag)
    {
        if (null === $value || '' === $value) {
            return null;
        }

        $timestamp = strtotime((string) $value);

        if (false === $timestamp) {
            WP_CLI::error(
                sprintf('Invalid --%s value "%s". Use a strtotime()-compatible date such as 2026-06-30.', $flag, $value)
            );
        }

        return $timestamp;
    }
}
