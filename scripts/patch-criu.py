import sys

path = sys.argv[1]
src = open(path).read()

old = (
    "\t\t} else if (n->pid_real != d->pid_real) {\n"
    "\t\t\tpr_err(\"ctty inheritance detected sid/pgrp %d \"\n"
    "\t\t\t       \"(ctty pid_real %d pty pid_real %d)\\n\",\n"
    "\t\t\t       d->sid, d->pid_real, n->pid_real);\n"
    "\t\t\treturn -ENOENT;\n"
    "\t\t}"
)
new = "\t\t}"

if old not in src:
    print("ERROR: patch target not found in", path, file=sys.stderr)
    sys.exit(1)

open(path, "w").write(src.replace(old, new, 1))
print("CRIU tty.c patched: removed pid_real ctty inheritance check")
