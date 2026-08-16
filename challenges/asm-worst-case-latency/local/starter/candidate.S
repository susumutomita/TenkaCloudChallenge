# The only participant-owned line is the instruction below. The harness supplies
# the arena pointer/state in %r8, a seed in %rax, and repeats this line 64 times.
# It also owns setup, timing, labels, and return; adding any of those is rejected.
# Only the reviewed scalar-integer set and general-purpose registers are allowed.
# Memory may only read the author-owned arena at (%r8), into an explicit GPR.
# SIMD/x87, random, system-state, and unknown instructions are rejected before link.
# %r15 is reserved for the wrapper's call-frame guard.
addq $1, %rax
