# 1 / Hint 2 — Do not lock everyone out

For example, `-rw-r--r--` allows the owner to read/write and everyone else to read. `-rw-r-----` allows the owner to read/write, the group to read, and nobody else to access it.

The second example corresponds to `chmod 0640 FILE`: 0 means no permission, 4 means read, and 6 means read/write. The correct owner and group matter too. Check the file's ownership and the operations notes to determine the group used by batch.
