/* The measurement harness. The author owns this file; the participant owns only
 * candidate.S. Everything that makes a cycle count trustworthy lives here:
 * serialization around the fence posts, warm-up, a fixed repeat count, a robust
 * statistic over many samples, and the interrupt/migration evidence that decides
 * whether a sample may be counted at all.
 *
 * The participant cannot make their instruction look slow by making the harness
 * sloppy, because they do not get to touch the harness.
 */

#define _GNU_SOURCE /* CPU_ZERO/CPU_SET and sched_setaffinity */

#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sched.h>

#include "arena.h"

/* Provided by candidate.S and reference/solution.S: run the instruction under
 * test SPIN_COUNT times over the arena, and return the value it produced so the
 * compiler cannot decide the work was pointless. */
extern uint64_t tc_candidate(void *arena, uint64_t seed);
/* The fixed comparison point: a dependent chain of the cheapest arithmetic. */
extern uint64_t tc_baseline(void *arena, uint64_t seed);

#define SAMPLES 101
#define WARMUP 8

static inline uint64_t fence_open(void) {
    unsigned lo, hi;
    __asm__ __volatile__("lfence\n\trdtsc" : "=a"(lo), "=d"(hi)::"memory");
    return ((uint64_t)hi << 32) | lo;
}

static inline uint64_t fence_close(void) {
    unsigned lo, hi;
    __asm__ __volatile__("rdtscp\n\tlfence" : "=a"(lo), "=d"(hi)::"rcx", "memory");
    return ((uint64_t)hi << 32) | lo;
}

/* Which CPU the sample ran on, read at the same instant as the closing stamp:
 * rdtscp puts the OS-supplied CPU/node id in ECX. A sample whose open and close
 * disagree crossed cores, and its cycle delta is meaningless. */
static inline uint32_t fence_close_cpu(uint64_t *cycles) {
    unsigned lo, hi, aux;
    __asm__ __volatile__("rdtscp\n\tlfence" : "=a"(lo), "=d"(hi), "=c"(aux)::"memory");
    *cycles = ((uint64_t)hi << 32) | lo;
    return (uint32_t)aux;
}

static inline uint32_t current_cpu(void) {
    unsigned lo, hi, aux;
    __asm__ __volatile__("rdtscp" : "=a"(lo), "=d"(hi), "=c"(aux)::"memory");
    (void)lo;
    (void)hi;
    return (uint32_t)aux;
}

static int compare_u64(const void *a, const void *b) {
    uint64_t x = *(const uint64_t *)a, y = *(const uint64_t *)b;
    return (x > y) - (x < y);
}

typedef struct {
    uint64_t cycles[SAMPLES];
    int kept;
    int rejected_migration;
    uint64_t checksum;
} run_t;

/* One measured run of `fn`. Samples that changed CPU mid-measurement are
 * rejected rather than kept: a migration inflates the delta, and rewarding it
 * would pay the participant for scheduler noise instead of for the instruction.
 */
static run_t measure(uint64_t (*fn)(void *, uint64_t), void *arena, uint64_t seed) {
    run_t run;
    memset(&run, 0, sizeof(run));

    for (int i = 0; i < WARMUP; i++) {
        run.checksum ^= fn(tc_arena_entry(arena, -i - 1), seed);
    }

    for (int i = 0; i < SAMPLES; i++) {
        /* A fresh entry point per sample: see tc_arena_entry. Chosen before the
         * fence posts so the address computation is not inside the measurement. */
        void *entry = tc_arena_entry(arena, i);
        uint32_t cpu_before = current_cpu();
        uint64_t open = fence_open();
        run.checksum ^= fn(entry, seed);
        uint64_t close;
        uint32_t cpu_after = fence_close_cpu(&close);

        if (cpu_before != cpu_after || close <= open) {
            run.rejected_migration++;
            continue;
        }
        run.cycles[run.kept++] = close - open;
    }

    qsort(run.cycles, (size_t)run.kept, sizeof(uint64_t), compare_u64);
    return run;
}

/* The predeclared robust statistic: the median of the kept samples. Not the
 * minimum (which rewards a lucky cache hit), not the maximum (which is whatever
 * interrupt happened to land), and not a mean (which one outlier moves). */
static uint64_t robust(const run_t *run) {
    if (run->kept <= 0) return 0;
    return run->cycles[run->kept / 2];
}

int main(int argc, char **argv) {
    uint64_t seed = 0;
    if (argc > 1) seed = strtoull(argv[1], NULL, 10);

    /* Pin to one CPU so migrations are rare rather than routine. The rejection
     * above is what makes the result honest; this only keeps the yield high. */
    cpu_set_t set;
    CPU_ZERO(&set);
    CPU_SET(0, &set);
    (void)sched_setaffinity(0, sizeof(set), &set);

    void *arena = tc_arena_create(seed);
    if (arena == NULL) {
        fprintf(stderr, "arena allocation failed\n");
        return 2;
    }

    run_t base = measure(tc_baseline, arena, seed);
    run_t cand = measure(tc_candidate, arena, seed);

    uint64_t base_cycles = robust(&base);
    uint64_t cand_cycles = robust(&cand);

    printf("{\n");
    printf("  \"seed\": %llu,\n", (unsigned long long)seed);
    printf("  \"spins\": %d,\n", TC_SPIN_COUNT);
    printf("  \"samples\": %d,\n", SAMPLES);
    printf("  \"baseline\": {\"robustCycles\": %llu, \"kept\": %d, \"rejected\": %d},\n",
           (unsigned long long)base_cycles, base.kept, base.rejected_migration);
    printf("  \"candidate\": {\"robustCycles\": %llu, \"kept\": %d, \"rejected\": %d},\n",
           (unsigned long long)cand_cycles, cand.kept, cand.rejected_migration);
    if (base_cycles > 0) {
        printf("  \"normalizedScore\": %.4f,\n", (double)cand_cycles / (double)base_cycles);
    } else {
        printf("  \"normalizedScore\": 0.0,\n");
    }
    printf("  \"checksum\": \"%llx\"\n", (unsigned long long)(base.checksum ^ cand.checksum));
    printf("}\n");

    tc_arena_destroy(arena);
    return 0;
}
