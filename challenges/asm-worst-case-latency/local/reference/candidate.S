# Reference: one dependent load. Each result becomes the address of the next
# load, so the fixed 64-copy wrapper cannot overlap or prefetch the chain.
movq (%r8), %r8
