"""Mirrors for sha256-compress-digest.

`avalanche` is a measured Hamming distance, so its answer is a number near 128 rather
than a seed-specific one; the sweep's distinct-answer count is the measurement of how
much it actually moves. `properties` / `storage` are fixed statement sets in a
seed-derived order, so their answer is a permutation of a fixed T/F multiset.
"""

EXPECTED = {
    "avalanche": lambda server, _seed: server.avalanche_distance(),
    "properties": lambda server, seed: server.quiz_answer(server.property_quiz(seed)),
    "storage": lambda server, seed: server.quiz_answer(server.storage_quiz(seed)),
}


#: 128 is the number a player writes down without running anything: half of 256 is what
#: avalanche is *supposed* to be. The rate at which the fixture's true distance is exactly
#: 128 is the rate at which the checkpoint rewards the guess.
VISIBLE = {"avalanche": lambda server, _seed: {"halfOfDigestBits": server.DIGEST_BITS // 2}}
