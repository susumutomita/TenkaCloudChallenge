<?php
declare(strict_types=1);

/**
 * php-attachment-viewer-lab -- the participant surface (port 8080).
 *
 * One PHP file served by PHP's built-in web server (`php -S ... index.php`):
 * every request is routed through here, nothing is served as a static file.
 *
 * ---- The fault, in one paragraph ----------------------------------------
 * `/attachment?file=NAME` is the portal's document viewer. It is meant to show
 * files on the document shelf (ATTACH_DIR) and nothing else. In the starting
 * state (`pathPolicy: "none"`) it simply joins NAME onto the shelf path and
 * reads whatever is there, so a NAME that climbs out of the shelf reaches the
 * private settings file next to it. The SRE console (`/admin/*`) offers three
 * policies: `none` (broken), `strip-dotdot` (a tempting but incomplete patch
 * that removes one pattern and is beaten by a slightly different spelling),
 * and `realpath` (resolve the final path, then require it to sit inside the
 * shelf -- the sound fix). The scorer never reads the policy value; it
 * replays several spellings of the climb against the live viewer and only
 * passes when every one of them is refused while a normal document still
 * opens.
 *
 * There is no shell, no program execution and no outbound network call
 * anywhere in this app; tests/boundary.test.mjs fails the build if one is
 * ever added.
 */

require __DIR__ . '/../lib.php';

$seed = labSeed();
$state = readState();

function send(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), "\n";
    exit;
}

function sendText(int $status, string $body): never
{
    http_response_code($status);
    header('Content-Type: text/plain; charset=utf-8');
    echo $body;
    exit;
}

function bearerAuthorized(string $seed): bool
{
    $header = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? '');
    return hash_equals('Bearer ' . consoleToken($seed), $header);
}

function readJsonBody(): array
{
    $raw = (string) file_get_contents('php://input', false, null, 0, 64 * 1024);
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function shelfListing(): array
{
    $names = [];
    foreach (scandir(ATTACH_DIR) ?: [] as $entry) {
        if ($entry[0] !== '.' && is_file(ATTACH_DIR . '/' . $entry)) {
            $names[] = $entry;
        }
    }
    sort($names);
    return $names;
}

$method = (string) ($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = (string) (parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH) ?? '/');
$path = '/' . ltrim($path, '/');

if ($method === 'GET' && $path === '/healthz') {
    send(200, ['status' => 'ok']);
}

// ---- Portal home --------------------------------------------------------
if ($method === 'GET' && $path === '/') {
    $items = '';
    foreach (shelfListing() as $name) {
        $href = '/attachment?file=' . rawurlencode($name);
        $items .= '<li><a href="' . htmlspecialchars($href, ENT_QUOTES) . '">'
            . htmlspecialchars($name, ENT_QUOTES) . '</a></li>';
    }
    http_response_code(200);
    header('Content-Type: text/html; charset=utf-8');
    echo <<<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Example Co Portal</title>
<style>body{font-family:system-ui,sans-serif;max-width:40rem;margin:2rem auto;padding:0 1rem}code{background:#eee;padding:0 .2rem}</style>
</head><body>
<h1>Example Co Portal</h1>
<p>Staff portal. Pick a document from the shelf below. / 社内ポータル。下の棚から資料を選んでください。</p>
<h2>Document shelf / 資料棚</h2>
<ul>{$items}</ul>
<p>Each link opens the viewer: <code>/attachment?file=NAME</code>. The shelf index is also at <code>/documents</code> (JSON).</p>
<h2>For the SRE on call</h2>
<p>The admin console is at <code>/admin</code> (JSON). It lists the console token and the actions you can run.</p>
</body></html>
HTML;
    exit;
}

if ($method === 'GET' && $path === '/documents') {
    send(200, ['shelf' => 'attachments/', 'documents' => shelfListing(), 'viewer' => '/attachment?file=NAME']);
}

// ---- The document viewer (the planted fault lives here) -----------------
if ($method === 'GET' && $path === '/attachment') {
    $name = (string) ($_GET['file'] ?? '');
    if ($name === '') {
        send(400, ['error' => 'missing_file', 'usage' => '/attachment?file=NAME']);
    }
    if ($state['pathPolicy'] === 'strip-dotdot') {
        // INCOMPLETE PATCH: removes one spelling of the climb, once. Another
        // spelling that turns into the removed one after this pass still works.
        $name = str_replace('../', '', $name);
    }
    $target = ATTACH_DIR . '/' . $name;
    if ($state['pathPolicy'] === 'realpath') {
        // SOUND FIX: resolve what the name finally points at, then require it
        // to be inside the shelf. Spelling no longer matters.
        $resolved = realpath($target);
        $shelf = realpath(ATTACH_DIR);
        if ($resolved === false || $shelf === false || !str_starts_with($resolved, $shelf . '/')) {
            send(403, ['error' => 'outside_shelf']);
        }
        $target = $resolved;
    }
    if (!is_file($target)) {
        send(404, ['error' => 'no_such_document']);
    }
    $body = file_get_contents($target);
    sendText(200, $body === false ? '' : $body);
}

// ---- Internal audit API: needs the audit token from private/config.ini ----
if ($method === 'GET' && $path === '/internal/audit') {
    $token = (string) ($_GET['token'] ?? '');
    if (!hash_equals(auditToken($seed, $state['auditTokenVersion']), $token)) {
        send(401, ['error' => 'bad_audit_token']);
    }
    $accounts = [
        ['username' => 'owner', 'role' => 'admin', 'created' => '2024-01-10'],
        ['username' => 'staff', 'role' => 'viewer', 'created' => '2024-01-10'],
    ];
    if ($state['leftoverAccountPresent']) {
        $accounts[] = ['username' => 'svc-backup', 'role' => 'admin', 'created' => '2026-10-31 03:12', 'note' => 'nobody on the team remembers creating this'];
    }
    send(200, [
        'tokenVersion' => $state['auditTokenVersion'],
        'accounts' => $accounts,
        'recentViewerRequests' => [
            ['at' => '2026-10-31 03:09', 'file' => 'manual.txt'],
            ['at' => '2026-10-31 03:10', 'file' => '(a name that climbed out of the shelf)'],
            ['at' => '2026-10-31 03:12', 'file' => 'welcome.txt'],
        ],
    ]);
}

// ---- SRE console --------------------------------------------------------
if ($method === 'GET' && ($path === '/admin' || $path === '/admin/')) {
    send(200, [
        'console' => 'sre',
        'token' => consoleToken($seed),
        'howToAuth' => 'Authorization: Bearer <token>',
        'endpoints' => [
            'GET /admin/audit' => 'current lab state',
            'POST /admin/action' => 'run one action: {"action": "..."}',
        ],
        'actions' => [
            'set-config' => 'body: {"action":"set-config","pathPolicy":"none|strip-dotdot|realpath"}',
            'remove-leftover-account' => 'delete the account nobody remembers creating',
            'rotate-audit-token' => 'issue a new audit token; the old one stops working',
        ],
        'note' => 'The flag checkpoint expects TC{...}. State checkpoints accept any non-empty submission once the live condition holds.',
    ]);
}

if ($method === 'GET' && $path === '/admin/audit') {
    if (!bearerAuthorized($seed)) {
        send(401, ['error' => 'unauthorized']);
    }
    send(200, $state);
}

if ($method === 'POST' && $path === '/admin/action') {
    if (!bearerAuthorized($seed)) {
        send(401, ['error' => 'unauthorized']);
    }
    $body = readJsonBody();
    switch ($body['action'] ?? '') {
        case 'set-config':
            $policy = $body['pathPolicy'] ?? null;
            if (!is_string($policy) || !in_array($policy, PATH_POLICIES, true)) {
                send(400, ['error' => 'invalid_path_policy', 'pathPolicy' => PATH_POLICIES]);
            }
            $state['pathPolicy'] = $policy;
            writeState($state);
            send(200, ['ok' => true, 'pathPolicy' => $state['pathPolicy']]);
        case 'remove-leftover-account':
            $state['leftoverAccountPresent'] = false;
            writeState($state);
            send(200, ['ok' => true, 'leftoverAccountPresent' => false]);
        case 'rotate-audit-token':
            $state['auditTokenVersion'] += 1;
            writeState($state);
            writePrivateConfig($seed, $state['auditTokenVersion']);
            send(200, ['ok' => true, 'auditTokenVersion' => $state['auditTokenVersion'], 'newToken' => auditToken($seed, $state['auditTokenVersion'])]);
        default:
            send(400, ['error' => 'unknown_action', 'actions' => ['set-config', 'remove-leftover-account', 'rotate-audit-token']]);
    }
}

send(404, ['error' => 'not_found']);
