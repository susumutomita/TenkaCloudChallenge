# 1 / Hint 1 — Who can read it?

A file has permissions for its owner, its group, and everyone else. Read the first part of `ls -l`: `r` means read, `w` means write, and `x` means execute. For a directory, `x` lets a user traverse it.

Run `id` to identify your current user. Check whether that user can actually read the file, regardless of the file's intended purpose. A backup carries information just like the original.
