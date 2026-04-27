# JER / PocketOS — Cursor + Railway production-data deletion (Apr 25, 2026)

- **Source:** https://x.com/lifeof_jer (post got 1.4M views)
- **Summary:** Cursor agent (Claude Opus 4.6) "fixed" a credential mismatch in
  staging by reaching for an unrelated Railway CLI token it found on disk and
  calling `volumeDelete` on production. Volume + in-volume backups gone in 9s.
  Last off-volume backup was 3 months old.

## The hooks worth amplifying (not JER's post itself)

- **Simon Willison:** "every agent framework should come with best-in-class
  sandboxing out of the box. Currently, setting up a sandbox is mostly left
  as an exercise for the user, and doing that well is really difficult."
  → Direct articulation of machinen's value prop from a credible voice.
- **Dylan Mikus:** "the tooling for running agents should do a better job
  isolating itself — ie run it in a sandbox with just the git repo."
- **Jake Cooper (Railway CEO):** "There's a massive opportunity for
  'vibecode safely in prod at scale.' 1B+ developers who look like JER...
  the burden of making bulletproof tooling goes up."

These three are the conversation to ride. JER's own post is an active
incident — don't dunk, don't pile on.

## Lessons we think are actually right

1. **Don't run agents anywhere they can reach prod credentials.** Knowing
   which creds are reachable from the agent's process is on you.
2. **Keep tested, independently-hosted backups.** (Not a machinen story —
   see below.)

## Where machinen fits

- **Lesson 1: yes, directly.** A microVM is a hard boundary. An agent
  running inside `machinen boot` can't `grep` the host's `~/.config` for a
  Railway token it was never given. This is the Simon-Willison-shaped
  opportunity.
- **Lesson 2: no, don't stretch.** Backups are an architecture problem
  (off-host, different blast radius, restore-tested). machinen is a
  process/VM transport tool. The closest honest claim is "snapshots are
  naturally off-box artifacts" — but that's about workload portability,
  not Postgres backups. Don't lead with it.

## Tone

Boring-but-correct. "Here's what sandboxed agent execution looks like in
~30 lines" beats "told you so." The audience is toolmakers in Jake's
replies, not JER's mentions.
