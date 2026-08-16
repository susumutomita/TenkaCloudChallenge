/* The memory the instruction under test is allowed to touch.
 *
 * The arena is a seed-derived pointer-chase ring: every 64-byte cache line holds
 * the address of another line, in an order that no hardware prefetcher can walk
 * ahead of. Its size is chosen to exceed any last-level cache this problem
 * supports, so a load that follows the ring misses all the way to DRAM.
 *
 * The measured instruction is handed the ring head in %r8. What it does with it
 * is the problem: an instruction that ignores memory runs at its own latency,
 * and one that follows the ring pays for the miss.
 *
 * The arena is mapped read-only once the ring is built. It is the only mapped
 * memory the frame leaves the measured instruction a pointer to, so making it
 * unwritable is what stops a store from changing what the next sample measures.
 */

#ifndef TC_ARENA_H
#define TC_ARENA_H

#include <stdint.h>
#include <stddef.h>

/* How many times one measured region repeats the instruction under test. Large
 * enough that the rdtsc pair's own cost is noise; small enough that a single
 * sample is far shorter than a scheduler tick. */
#define TC_SPIN_COUNT 64

void *tc_arena_create(uint64_t seed);
void tc_arena_destroy(void *arena);

/* Where sample `index` starts walking.
 *
 * Every sample gets an entry point far from the ones before it, so the 64 lines
 * a sample touches are lines this run has not touched yet. Without this the
 * measurement lies: 101 samples starting from the same head would walk the same
 * 64 lines every time, those lines would sit in L1 after the first sample, and
 * a DRAM-latency instruction would be measured at cache speed.
 */
void *tc_arena_entry(void *arena, int index);

#endif
