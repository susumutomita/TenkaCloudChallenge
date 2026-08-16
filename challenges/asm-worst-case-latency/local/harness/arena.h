/* The memory the instruction under test is allowed to touch.
 *
 * The arena is a seed-derived pointer-chase ring: every 64-byte cache line holds
 * the address of another line, in an order that no hardware prefetcher can walk
 * ahead of. Before each timed sample the fixed harness discovers and flushes
 * the exact 64-line path, so a load that follows the ring starts cold even on a
 * host whose last-level cache is larger than the arena.
 *
 * The C caller hands the ring head to the author wrapper in %rdi; the wrapper
 * exposes it to the submitted instruction as %r8. An instruction that ignores
 * memory runs at its own latency, and one that follows the ring pays for the miss.
 * After construction the mapping is read-only. Static validation rejects stores
 * before link, and the mapping is a second boundary against implicit writes.
 */

#ifndef TC_ARENA_H
#define TC_ARENA_H

/* How many times one measured region repeats the instruction under test. Large
 * enough that the rdtsc pair's own cost is noise; small enough that a single
 * sample is far shorter than a scheduler tick. */
#define TC_SPIN_COUNT 64

#ifndef __ASSEMBLER__

#include <stdint.h>
#include <stddef.h>

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

/* Discover and evict the exact fixed-length path before the timing fence. The
 * host contract requires CLFLUSH; participant instructions may not invoke it. */
void tc_arena_prepare(void *entry);

#endif /* __ASSEMBLER__ */

#endif
