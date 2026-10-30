#include "lab.h"

/*
 * Fixed worker stand-in: clearing the retained pointer (and generation) when the
 * request ends restores the ownership invariant. Legitimate work still runs.
 * Teaching check only — not the PHP upstream patch.
 */

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

static void request_end_fixed(RequestNote *req) {
	printf("OBS phase=free gen=%u heap=%p\n", req->generation, (void *)req->heap_note);
	free(req->heap_note);
	req->heap_note = NULL;
	worker_retained_note = NULL;
	worker_retained_generation = 0;
	printf("OBS phase=after_free retained_cleared=1 stale=0\n");
}

static void next_request_consume_safe(void) {
	printf("OBS phase=consume retained=%p gen=%u\n",
		(void *)worker_retained_note, worker_retained_generation);
	if (worker_retained_note == NULL || worker_retained_generation == 0) {
		printf("OBS phase=consume_rejected reason=null_or_cleared\n");
		return;
	}
	volatile char c = worker_retained_note[0];
	printf("OBS phase=stale_read first_char=%c\n", c);
	(void)c;
}

int main(int argc, char **argv) {
	setvbuf(stdout, NULL, _IONBF, 0);
	setvbuf(stderr, NULL, _IONBF, 0);
	const char *mode = argc > 1 ? argv[1] : "uaf";
	RequestNote req;

	if (strcmp(mode, "normal") == 0) {
		request_begin(&req, 1, "progress-ok");
		printf("OBS phase=use note=%s\n", req.heap_note);
		request_end_fixed(&req);
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
	request_end_fixed(&req);
	next_request_consume_safe();
	printf("OBS phase=done result=fixed\n");
	return 0;
}
