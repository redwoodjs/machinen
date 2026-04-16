# Reference: @dexhorthy on remote coding agents

**Source:** https://xcancel.com/dexhorthy/status/2037973730069254516

## Key quote

> I still find it hard to shift from "agents running in remote compute" to "agents running on my laptop" - not because of the agent or the inference
> The first step to remote coding agents should feel at least somewhat continuous in this regard

## Why this is relevant to machinen

This tweet captures exactly the problem machinen solves. The friction isn't the agent or the model — it's the **environment discontinuity**. Developers have local state: running dev servers, file watchers, browser sessions, partially-applied changes. Remote compute starts cold and knows none of this.

Machinen's freeze/restore workflow makes the transition continuous: snapshot your local environment mid-task and restore it in remote compute (or vice versa), so agents can pick up exactly where you left off without losing context.

**Positioning angle:** "The first step to remote coding agents should feel continuous" — machinen makes it so.
