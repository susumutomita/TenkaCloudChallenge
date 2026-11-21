<?php
declare(strict_types=1);

/**
 * Runs once when the surface container starts (see local/Dockerfile CMD) and
 * from tests/lab.test.mjs before the local PHP server is started.
 *
 * It resets the lab to its broken starting state: writes the console state
 * file and the private settings file whose audit token is the stage-1 flag.
 * Both are derived from FLAG_SEED, so every run of the lab is different.
 */

require __DIR__ . '/../lib.php';

$seed = labSeed();
writeState(DEFAULT_STATE);
writePrivateConfig($seed, 0);
fwrite(STDOUT, "[bootstrap] lab state reset; shelf=" . ATTACH_DIR . " private=" . PRIVATE_DIR . "\n");
fwrite(STDOUT, "[bootstrap] SRE console token: " . consoleToken($seed) . "\n");
