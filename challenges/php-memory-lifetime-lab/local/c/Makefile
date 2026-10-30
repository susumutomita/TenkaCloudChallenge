CC ?= gcc
CFLAGS ?= -O1 -g -fno-omit-frame-pointer -Wall -Wextra -Werror
BINDIR ?= .
.PHONY: all clean
all: $(BINDIR)/lab_buggy $(BINDIR)/lab_buggy_asan $(BINDIR)/lab_fixed $(BINDIR)/lab_fixed_asan
$(BINDIR)/lab_buggy: lab_buggy.c lab.h
	$(CC) $(CFLAGS) -o $@ lab_buggy.c
$(BINDIR)/lab_buggy_asan: lab_buggy.c lab.h
	$(CC) $(CFLAGS) -fsanitize=address -o $@ lab_buggy.c
$(BINDIR)/lab_fixed: lab_fixed.c lab.h
	$(CC) $(CFLAGS) -o $@ lab_fixed.c
$(BINDIR)/lab_fixed_asan: lab_fixed.c lab.h
	$(CC) $(CFLAGS) -fsanitize=address -o $@ lab_fixed.c
clean:
	rm -f $(BINDIR)/lab_buggy $(BINDIR)/lab_buggy_asan $(BINDIR)/lab_fixed $(BINDIR)/lab_fixed_asan
