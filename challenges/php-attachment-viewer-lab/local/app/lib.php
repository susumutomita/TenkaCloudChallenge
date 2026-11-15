<?php
declare(strict_types=1);

/**
 * php-attachment-viewer-lab -- shared helpers for the portal (public/index.php)
 * and the start-up script (bin/bootstrap.php).
 *
 * This is a from-scratch simulator of a tiny company portal, written for
 * TenkaCloud local play. It is not a real CMS and copies no real product's
 * code. It never runs a shell or another program, never makes an outbound
 * network call, and keeps every secret derived from the per-run FLAG_SEED
 * that docker-compose.yml requires -- nothing secret is committed.
 *
 * Everything the app writes (the private settings file and the console
 * state) lives under LAB_ROOT/private and LAB_ROOT/state, which the
 * container mounts as tmpfs. The document shelf (LAB_ROOT/attachments) is
 * the only directory the viewer is meant to show.
 */

define('LAB_ROOT', rtrim((string) (getenv('LAB_ROOT') ?: '/app'), '/'));
define('ATTACH_DIR', LAB_ROOT . '/attachments');
define('PRIVATE_DIR', LAB_ROOT . '/private');
define('STATE_DIR', LAB_ROOT . '/state');
define('STATE_FILE', STATE_DIR . '/state.json');
define('CONFIG_FILE', PRIVATE_DIR . '/config.ini');

/** The viewer policies the SRE console can select. Only one of them is sound. */
const PATH_POLICIES = ['none', 'strip-dotdot', 'realpath'];

const DEFAULT_STATE = [
    // THE PLANTED FAULT: the viewer joins the submitted name onto the shelf
    // path with no containment check at all.
    'pathPolicy' => 'none',
    // Seeded aftermath: a previous run of the same route left an account
    // behind. Cleaning it up is part of the drill.
    'leftoverAccountPresent' => true,
    // The audit token in private/config.ini. Version 0 is the stage-1 flag;
    // rotating it makes whatever leaked useless.
    'auditTokenVersion' => 0,
];

function labSeed(): string
{
    $seed = (string) getenv('FLAG_SEED');
    if ($seed === '') {
        fwrite(STDERR, "FLAG_SEED is required (per-run secret; docker-compose.yml injects it)\n");
        exit(1);
    }
    return $seed;
}

function consoleToken(string $seed): string
{
    return substr(hash('sha256', "console-token:{$seed}"), 0, 32);
}

/** Version 0 is the TC{...} flag stage 1 proves; later versions are plain hex. */
function auditToken(string $seed, int $version): string
{
    if ($version === 0) {
        return 'TC{escape_' . substr(hash('sha256', "flag:read-outside:{$seed}"), 0, 20) . '}';
    }
    return substr(hash('sha256', "audit-token:v{$version}:{$seed}"), 0, 32);
}

function readState(): array
{
    $raw = @file_get_contents(STATE_FILE);
    $decoded = $raw === false ? null : json_decode($raw, true);
    if (!is_array($decoded)) {
        return DEFAULT_STATE;
    }
    $state = DEFAULT_STATE;
    if (isset($decoded['pathPolicy']) && in_array($decoded['pathPolicy'], PATH_POLICIES, true)) {
        $state['pathPolicy'] = $decoded['pathPolicy'];
    }
    if (isset($decoded['leftoverAccountPresent'])) {
        $state['leftoverAccountPresent'] = (bool) $decoded['leftoverAccountPresent'];
    }
    if (isset($decoded['auditTokenVersion']) && is_int($decoded['auditTokenVersion'])) {
        $state['auditTokenVersion'] = max(0, $decoded['auditTokenVersion']);
    }
    return $state;
}

function writeState(array $state): void
{
    if (!is_dir(STATE_DIR)) {
        mkdir(STATE_DIR, 0700, true);
    }
    file_put_contents(STATE_FILE, json_encode($state, JSON_PRETTY_PRINT) . "\n", LOCK_EX);
}

/** Rewrites the private settings file for the given token version. */
function writePrivateConfig(string $seed, int $version): void
{
    if (!is_dir(PRIVATE_DIR)) {
        mkdir(PRIVATE_DIR, 0700, true);
    }
    $lines = [
        '; Example Co Portal -- private settings. This file sits next to the',
        '; document shelf, not inside it, and the viewer must never show it.',
        'portal_name = "Example Co Portal"',
        'audit_token = "' . auditToken($seed, $version) . '"',
        'token_version = ' . $version,
        '',
    ];
    file_put_contents(CONFIG_FILE, implode("\n", $lines), LOCK_EX);
}
