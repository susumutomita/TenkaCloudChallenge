#define _GNU_SOURCE /* MAP_ANONYMOUS */

#include "arena.h"

#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>

/* 64 MiB keeps consecutive sample entry points far apart. The measured path is
 * also explicitly evicted by tc_arena_prepare(), so correctness does not depend
 * on assuming that every supported host has a smaller last-level cache. */
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

    /* Read-only for the measurement. candidate.py rejects decoded stores before
     * link; this mapping is defense in depth for any implicit write the static
     * boundary does not yet understand. A store through the supplied arena
     * pointer faults instead of changing what later samples measure. */
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

void tc_arena_prepare(void *entry) {
    void *path[TC_SPIN_COUNT];
    void *cursor = entry;

    /* Discover the exact dependent path while it is outside the timing fence,
     * then evict every line after discovery. Flushing as we discover would make
     * the next pointer load bring a previously flushed line back into cache. */
    for (int i = 0; i < TC_SPIN_COUNT; i++) {
        path[i] = cursor;
        cursor = *(void **)cursor;
    }
    for (int i = 0; i < TC_SPIN_COUNT; i++) {
        __asm__ __volatile__("clflush (%0)" : : "r"(path[i]) : "memory");
    }
    __asm__ __volatile__("mfence" : : : "memory");
}
