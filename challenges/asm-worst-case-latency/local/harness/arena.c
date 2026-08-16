#define _GNU_SOURCE /* MAP_ANONYMOUS */

#include "arena.h"

#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

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
    void *block = mmap(NULL, ARENA_BYTES, PROT_READ | PROT_WRITE,
                       MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
    if (block == MAP_FAILED) return NULL;
    build_ring((void **)block, seed);

    /* Read-only for the measurement. The instruction under test runs in this
     * process, and the arena is the only mapped memory the frame leaves it a
     * pointer to (see wrapper.S.in: every other register is zero). Making it
     * unwritable means a store through that pointer faults instead of changing
     * what the next sample measures — the operand rules in splice.py refuse the
     * stores they can see, and this refuses the ones they cannot. */
    if (mprotect(block, ARENA_BYTES, PROT_READ) != 0) {
        munmap(block, ARENA_BYTES);
        return NULL;
    }
    return block;
}

void tc_arena_destroy(void *arena) {
    if (arena != NULL) munmap(arena, ARENA_BYTES);
}

void *tc_arena_entry(void *arena, int index) {
    void **lines = (void **)arena;
    /* A large odd stride in units of cache lines: consecutive samples land far
     * apart, and the sequence does not repeat within one run. 8191 is prime, so
     * 101 samples spread across the whole ring rather than clustering. */
    size_t slot = ((size_t)(index & 0xffff) * 8191u) % SLOTS;
    return &lines[slot * (LINE_BYTES / sizeof(void *))];
}
