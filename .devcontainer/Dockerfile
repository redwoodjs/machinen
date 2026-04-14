FROM mcr.microsoft.com/devcontainers/javascript-node:1-22

# CRIU-friendly pid 1.  The stock devcontainer wrapper leaves pid 1 holding
# dockerd's stdout/stderr pipes, which CRIU records in descriptors.json as
# anonymous `pipe:[NNNN]` inodes.  On restore those inodes don't exist, the
# new shim's fresh fifos aren't remapped to them, and restore collapses with
# "copy stream failed: reading from a closed fifo" — surfaced to the user as
# a useless generic "criu failed: type RESTORE errno 0".
#
# Redirecting stdio to /dev/null before the infinite-sleep loop makes pid 1's
# fd 0/1/2 all point at a durable path; the checkpoint captures /dev/null
# instead of phantom pipe inodes and restore works across machines.
CMD ["/bin/sh", "-c", "exec </dev/null >/dev/null 2>&1; while sleep 1 & wait $!; do :; done"]
