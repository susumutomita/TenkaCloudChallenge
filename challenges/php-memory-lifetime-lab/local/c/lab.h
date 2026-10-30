/* Teaching lab only. Not PHP, not a CVE reproduction, not an exploit trainer. */
#ifndef PHP_MEMORY_LIFETIME_LAB_H
#define PHP_MEMORY_LIFETIME_LAB_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

/* Harmless predeclared checkpoint. Writes one line to fd 3 when the harness
 * attaches a pipe there; otherwise prints to stdout so observers still see it.
 * No OS commands, network, secrets, or arbitrary code. */
static inline void record_lab_event(const char *tag) {
	char buf[160];
	int n = snprintf(buf, sizeof buf, "LAB_EVENT tag=%s\n", tag ? tag : "");
	if (n <= 0) {
		return;
	}
	if ((size_t)n >= sizeof buf) {
		n = (int)sizeof buf - 1;
	}
	if (write(3, buf, (size_t)n) < 0) {
		fwrite(buf, 1, (size_t)n, stdout);
		fflush(stdout);
	}
}

typedef struct {
	unsigned generation;
	char *heap_note; /* request-owned heap allocation */
} RequestNote;

#endif
