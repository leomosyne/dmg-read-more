<?php

/**
 * Plugin Name:       DMG Read More
 * Description:       A "Read More" Gutenberg block plus a WP-CLI command to find posts that use it.
 * Version:           1.0.0
 * Requires at least: 6.4
 * Requires PHP:      7.4
 * Author:            Leo
 * License:           GPL-2.0-or-later
 * Text Domain:       dmg-read-more
 */

defined('ABSPATH') || exit;

/*
 * Register the dmg/read-more block from its compiled build metadata.
 */
add_action('init', static function () {
    $block_dir = __DIR__ . '/build';

    if (!file_exists($block_dir . '/block.json')) {
        add_action('admin_notices', static function () {
            printf(
                '<div class="notice notice-error"><p>%s</p></div>',
                esc_html__(
                    'DMG Read More: block assets are missing. Run "npm install && npm run build".',
                    'dmg-read-more'
                )
            );
        });
        return;
    }

    register_block_type($block_dir);
});

if (defined('WP_CLI') && WP_CLI) {
    require_once __DIR__ . '/includes/ReadMoreCommand.php';
    WP_CLI::add_command('dmg-read-more', \Leo\DmgReadMore\ReadMoreCommand::class);
}
