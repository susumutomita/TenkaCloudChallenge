#include "arena.h"

#include <stdlib.h>
#include <string.h>

/* 64 MiB: larger than the last-level cache of every host this problem declares
 * support for, so the ring cannot be resident. */
#define ARENA_BYTES (64ULL * 1024 * 1024)
#define LINE_BYTES 64
#define SLOTS (ARENA_BYTES / LINE_BYTES)

/* A seed-derived permutation, built as a single cycle so the chase never falls
 * into a short loop that would fit in cache. Sattolo's algorithm gives exactly
 * that: one cycle through every slot. */
static void build_ring(void **arena, uint64_t seed) {
    size_t *order = malloc(SLOTS * sizeof(size_t));
    if (order == NULL) return;
    for (size_t i = 0; i < SLOTS; i++) order[i] = i;

    uint64_t state = seed * 6364136223846793005ULL + 1442695040888963407ULL;
    for (size_t i = SLOTS - 1; i > 0; i--) {
        state = state * 6364136223846793005ULL + 1442695040888963407ULL;
        size_t j = (size_t)((state >> 17) % i); /* strictly below i: one cycle */
        size_t tmp = order[i];
        order[i] = order[j];
        order[j] = tmp;
    }

    for (size_t i = 0; i < SLOTS; i++) {
        size_t here = order[i];
        size_t next = order[(i + 1) % SLOTS];
        arena[here * (LINE_BYTES / sizeof(void *))] =
            &arena[next * (LINE_BYTES / sizeof(void *))];
    }
    free(order);
}

void *tc_arena_create(uint64_t seed) {
    void **arena = aligned_alloc(4096, ARENA_BYTES);
    if (arena == NULL) return NULL;
    memset(arena, 0, ARENA_BYTES);
    build_ring(arena, seed);
    return arena;
}

void tc_arena_destroy(void *arena) { free(arena); }

void *tc_arena_entry(void *arena, int index) {
    void **lines = (void **)arena;
    /* A large odd stride in units of cache lines: consecutive samples land far
     * apart, and the sequence does not repeat within one run. 8191 is prime, so
     * 101 samples spread across the whole ring rather than clustering. */
    size_t slot = ((size_t)(index & 0xffff) * 8191u) % SLOTS;
    return &lines[slot * (LINE_BYTES / sizeof(void *))];
}
