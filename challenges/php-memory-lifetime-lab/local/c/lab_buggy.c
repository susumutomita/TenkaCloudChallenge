#include "lab.h"

/*
 * Buggy worker stand-in: a process-global pointer keeps referring to heap memory
 * that belonged to a finished "request". The next request then reads it.
 *
 * This mirrors the *lifetime* idea from CVE-2026-109619 (worker state retaining
 * request-owned memory). It is a tiny independent C program, not PHP, and it
 * does not reproduce the CVE, multipart parsing, or RCE.
 */

/* Survives across teaching "requests" inside this one process. */
char *worker_retained_note = NULL;
unsigned worker_retained_generation = 0;

static void request_begin(RequestNote *req, unsigned gen, const char *text) {
	req->generation = gen;
	req->heap_note = strdup(text);
	if (!req->heap_note) {
		perror("strdup");
		exit(1);
	}
	printf("OBS phase=alloc gen=%u heap=%p stack_local=%p\n",
		gen, (void *)req->heap_note, (void *)req);
}

static void publish_to_worker(RequestNote *req) {
	worker_retained_note = req->heap_note;
	worker_retained_generation = req->generation;
	printf("OBS phase=publish gen=%u retained=%p\n",
		req->generation, (void *)worker_retained_note);
}

static void request_end_buggy(RequestNote *req) {
	printf("OBS phase=free gen=%u heap=%p\n", req->generation, (void *)req->heap_note);
	free(req->heap_note);
	req->heap_note = NULL;
	/* BUG: worker_retained_note still holds the freed address. */
	printf("OBS phase=after_free retained_still=%p stale=1\n", (void *)worker_retained_note);
}

static void next_request_consume_stale(void) {
	printf("OBS phase=consume retained=%p gen=%u\n",
		(void *)worker_retained_note, worker_retained_generation);
	if (worker_retained_note) {
		/* Use-after-free read. AddressSanitizer reports this. */
		volatile char c = worker_retained_note[0];
		printf("OBS phase=stale_read first_char=%c\n", c);
		(void)c;
	}
}

int main(int argc, char **argv) {
	setvbuf(stdout, NULL, _IONBF, 0);
	setvbuf(stderr, NULL, _IONBF, 0);
	const char *mode = argc > 1 ? argv[1] : "uaf";
	RequestNote req;

	if (strcmp(mode, "normal") == 0) {
		request_begin(&req, 1, "progress-ok");
		printf("OBS phase=use note=%s\n", req.heap_note);
		free(req.heap_note);
		req.heap_note = NULL;
		worker_retained_note = NULL;
		worker_retained_generation = 0;
		record_lab_event("normal-complete");
		printf("OBS phase=done result=ok\n");
		return 0;
	}

	if (strcmp(mode, "lab-event") == 0) {
		record_lab_event("checkpoint");
		printf("OBS phase=done result=lab-event\n");
		return 0;
	}


	request_begin(&req, 1, "progress-A");
	publish_to_worker(&req);
	request_end_buggy(&req);
	next_request_consume_stale();
	printf("OBS phase=done result=uaf\n");
	return 0;
}
