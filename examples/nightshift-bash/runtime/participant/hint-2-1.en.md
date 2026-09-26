# 2 / Hint 1 — A name is not the actual program

When a script uses a short command name, Bash searches PATH in order. It does not check who placed the first matching executable.

If batch calls it, that executable runs as batch. Look for a way auditor can place a program that batch will call, without auditor directly gaining batch's permissions.
