# Why Restore Was Broken — Explained Simply

## The problem

We froze a container and tried to restore it on another computer. It didn't work. The error message said "criu failed" but that wasn't the real reason.

## What was really happening

Imagine the container is a little house, and the house has a phone. When the house was built, Docker installed a phone line and gave it a number — let's say `pipe:[62531]`. The person inside the house (pid 1) picked up the phone and held it.

When we froze the house, we wrote down the phone number the person was holding: `pipe:[62531]`. We packed this note into our moving box along with everything else.

Then we moved the house to a new computer.

At the new computer, Docker built a new phone line with a different number, like `pipe:[99999]`. But the person we restored was still holding a note that said "my phone is 62531." They tried to use their phone — but 62531 doesn't exist on this new computer. So they couldn't hear anything, couldn't say anything, and everything fell apart.

Docker then shrugged and said "criu failed" — which was wrong. CRIU did its job fine. The problem was the phone number we wrote down wasn't portable.

## The fix

Before freezing, tell the person inside the house to hang up the phone and throw it away. Now instead of holding a phone, they're just sitting in silence, looking at a hole in the wall called `/dev/null`. That "hole in the wall" exists on every computer. So when we restore on a new computer, the person picks up their note, sees `/dev/null`, looks around the new house, finds the same hole in the wall, and everything works.

In code, "throw the phone away" looks like:

```
exec </dev/null >/dev/null 2>&1
```

We put this at the very beginning of what pid 1 does, before anything else.

## Where the fix lives

Two files:

**`.devcontainer/Dockerfile`** — tells Docker to build the container with pid 1 running a command that throws the phone away first, then sleeps forever.

**`.devcontainer/devcontainer.json`** — has `"overrideCommand": false` so the devcontainer tool doesn't secretly re-install the phone.

## How to check it's working

After `machinen up`, look inside the container at what pid 1 is holding:

```
docker exec <container> ls -la /proc/1/fd/
```

You should see three arrows, all pointing to `/dev/null`:

```
0 -> /dev/null
1 -> /dev/null
2 -> /dev/null
```

If any of them say `pipe:[somenumber]` instead — the fix isn't active, and restore will break on another computer.

After `machinen restore --local`, check that the restored container still has the original processes from the frozen one. Look at `ps -ef`:

```
node  1567  ... tmux ...
node  1568  1567 ... bash ...
```

If `tmux` and `bash` have the same pid numbers they had before the freeze, CRIU really did restore the old state. If they have different pids, you got a fresh container instead of a restored one.

## Things that looked like they might help but didn't

- **Pinning the CRIU version.** The problem wasn't CRIU — CRIU was doing its job.
- **Pinning the Docker-in-Docker version.** Same — not the broken piece.
- **Deleting mount entries from the checkpoint.** Fixes a different problem (mount namespaces), not this one.
- **Using `--tty`.** Trades the phone for a walkie-talkie. Still not portable.

## How to peek at the phone number the checkpoint is holding

The checkpoint image has a file called `descriptors.json` that lists what pid 1 is holding onto. You can look at it:

```
docker create --name peek <checkpoint-image> /nonexistent
docker cp peek:/checkpoint/descriptors.json -
docker rm peek
```

It'll say something like `["/dev/null", "/dev/null", "/dev/null"]` (good — portable) or `["/dev/null", "pipe:[62531]", "pipe:[62532]"]` (bad — will break on another computer).
