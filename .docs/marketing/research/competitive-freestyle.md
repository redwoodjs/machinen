# Competitive Analysis: Freestyle Runs

**Date:** 2026-04-07
**Source:** [freestyle.sh/products/runs](https://www.freestyle.sh/products/runs), [HN thread](https://news.ycombinator.com/item?id=47663147)

## What Freestyle Is

Freestyle Runs is a serverless code execution platform targeting AI agents. You send code via API, it runs in a V8 isolate, you get results back. Sub-10ms cold starts, pay-per-millisecond billing, TypeScript/JSX out of the box. They also offer a broader sandbox product with full Debian VMs, systemd, eBPF, nested virtualization, and a novel copy-on-write VM forking mechanism (~320ms fork time independent of VM size).

**Positioning:** "Sandboxes for AI agents" — infrastructure for platforms that run untrusted agent-generated code.

**Target customer:** Platform builders (not individual developers or hobbyists). Founders explicitly said they're "probably not going after hobbyists."

## HN Sentiment Summary

### What resonated

- **VM forking** was the standout feature. "O(1) fork time completely decoupled from machine size" genuinely impressed technical readers. Multiple people said they hadn't seen this from competitors.
- **Full Linux support** (systemd, eBPF, nested virt) — people appreciated not getting a crippled container pretending to be a VM.
- **Bare metal infrastructure** — respect for running their own hardware rather than reselling cloud compute.

### What fell flat

- **No one could explain what to use it for.** Repeated requests for concrete use cases. Multiple commenters: "I'm missing a use case example that's not abstract." Founders admitted: "We've never been great at explaining what we're doing."
- **Pricing opacity.** No clear monthly cost estimates for persistent VMs. Unfavorable comparison to exe.dev's transparent $20/month plan.
- **Market saturation fatigue.** "I see multiple sandbox-for-agents products a week. Way too saturated of a market." This was a recurring sentiment.
- **Slow demo site.** "It takes up to 30+ seconds to move from one tab to the next... not exactly selling your point of being a super fast provisioning service."

### Concerns raised

- Postgres and complex protocols break across forks (acknowledged by founders)
- Can't hot-add RAM without VM restart
- Cross-node forking impossible at advertised speeds — requires massive single nodes (2TB storage, 500GB RAM)
- Secrets/credential injection still work-in-progress
- Container isolation questions (not VM-level security)

## How Machinen Compares

| Dimension         | Freestyle                                      | Machinen                                                   |
| ----------------- | ---------------------------------------------- | ---------------------------------------------------------- |
| **Core model**    | Stateless code execution / ephemeral sandboxes | Stateful container migration (local <-> cloud)             |
| **Target user**   | Platform builders embedding sandboxes          | Individual developers / small teams                        |
| **Isolation**     | V8 isolates (Runs) / VMs (Sandboxes)           | Full Docker containers via CRIU                            |
| **State**         | Ephemeral by default; fork for branching       | Persistent by design — freeze/restore preserves everything |
| **Cold start**    | ~10ms (V8), ~320ms (VM fork)                   | N/A — container is already running, it migrates            |
| **Where it runs** | Freestyle's bare metal                         | Your laptop + your cloud (Hetzner, etc.)                   |
| **Pricing**       | Pay-per-ms to Freestyle                        | Pay your own cloud provider (pennies/hour on Hetzner)      |
| **Network**       | Domain allow/deny, proxy routing               | Full network stack, Tailscale-compatible                   |
| **Use case**      | Run untrusted code snippets from AI agents     | Keep your full dev environment alive across sleep/wake     |

## Strong Signals for Machinen

### 1. "Sandbox fatigue" is an opportunity

The HN crowd is tired of sandbox-for-agents pitches. Machinen isn't a sandbox — it's a devtool for humans who happen to work with containers. This is a differentiation advantage. Lean into the personal developer workflow angle; don't get lumped into the sandbox category.

### 2. Forking vs. migrating — different problems

Freestyle's forking is about branching execution (explore multiple paths). Machinen's migration is about continuity (your work follows you). These serve fundamentally different needs. Freestyle answers "how do I run 1000 copies of this?" Machinen answers "how do I never lose my working state?"

### 3. The "who owns the infrastructure" question matters

Freestyle runs on their bare metal. Your code runs on their machines. Machinen runs on your laptop and your cloud account. For developers who care about data sovereignty, cost transparency, or just not depending on a startup's uptime, this is a real differentiator.

### 4. Use case clarity is Freestyle's biggest weakness — and a lesson

The #1 criticism was "I don't understand what to build with this." Machinen's use case is immediately intuitive: close your laptop, your container keeps running in the cloud, open it again, it comes back. Make sure every piece of marketing leads with this concrete scenario.

### 5. Pricing transparency wins trust

Freestyle got dinged for opaque pricing. Machinen's model (you pay Hetzner directly, ~EUR 0.007/hour for a CX22) is radically transparent. Highlight this.

### 6. Full Linux > V8 isolates for real work

Freestyle Runs (the V8 product) is limited to JavaScript/TypeScript. Their VM product supports full Linux but is more expensive and complex. Machinen gives you a full Linux container by default — any language, any tool, any daemon. No restrictions.

## Positioning Recommendations

- **Don't compete in the "sandbox for agents" lane.** That market is crowded and commoditizing. Machinen is a developer productivity tool that uses CRIU, not a sandbox platform.
- **Lead with the laptop story.** "Close your laptop, your work keeps running" is more memorable than any API benchmark.
- **Emphasize ownership.** Your containers, your cloud account, your data. No vendor lock-in to a sandbox provider.
- **Show, don't tell.** Freestyle's demo was slow and hurt their credibility. A 30-second video of close-lid -> open-lid -> everything's back would be worth 1000 words of copy.
- **Price comparison is a weapon.** A Hetzner CX22 costs ~$5/month. Show what the equivalent would cost on Freestyle or AWS Lambda at scale.
