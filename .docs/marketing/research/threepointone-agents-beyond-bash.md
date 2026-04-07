# @threepointone — Agents beyond bash, computing beyond Unix

- **Date:** 2026-04-07
- **URL:** https://x.com/threepointone/status/2041457759284072954
- **Quoting:** https://x.com/theo/status/2041441945290162178
- **Context:** Sunil Pai (Cloudflare) quote-tweeting Theo Browne (t3.gg)

## The tweets

**Theo:**
> Agents are good at bash. Bash is not good for agents. We should cut our losses and restart now before it is too late.

**Sunil:**
> yes yes a 1000 times yes. after the, er, recent drama, I went into a rabbit hole exploring the space, and it's like my brain's been reprogrammed. lemme put it this way: there's nothing _fundamental_ about filesystems. or terminal commands. or _even your favourite programming language_. but there _is_ something fundamental about storage. or lambda calculus. the future of computing looks more like math+symbolic execution than unix+whatever's in the training set. (and it would be very bad for humanity if this wasn't true!)

---

## Background: the "recent drama"

In March 2026, Malte Ubl (Vercel CTO) publicly called out Sunil for Cloudflare forking Vercel's [just-bash](https://github.com/vercel-labs/just-bash) — a TypeScript reimplementation of bash for agents.

Malte's tweet: ["Cloudflare forked just-bash and they really, really should not have"](https://x.com/cramforce/status/2033285112478171373). His argument was open-source etiquette — Cloudflare forked without contributing upstream first. Community largely defended Sunil. [Paul Butler](https://x.com/paulgb/status/2033573814420804069): "Insane that Vercel picked one of the kindest, most well-meaning people in tech to go after." They eventually spoke on the phone and both apologized.

The drama was literally about **bash for agents** — and it sent Sunil down a rabbit hole.

## Theo's position

Theo has been building toward this for a while. He identified what he calls "The Agentic Code Problem" — managing multiple AI agents across terminal windows, browser tabs, and IDEs is a cognitive nightmare. His answer was [T3 Code](https://github.com/pingdotgg/t3code), an open-source GUI wrapping agents like Claude Code and Codex with git worktree isolation, visual diffs, and multi-agent orchestration.

His tweet distills it: agents are fluent in bash because that's in the training data, but bash is a terrible substrate for agent workflows. Rethink the interface now before the ecosystem calcifies.

## Sunil's argument (the interesting part)

Sunil agrees with Theo but goes much further — from a UX argument to a philosophical one about computing itself.

**The accidental vs. the essential:**
- Filesystems, terminal commands, Python/JS/Rust — these are *accidental* artifacts of computing history. Conventions, not laws.
- Storage (the abstract concept), lambda calculus (the formal foundation of computation) — these are *essential*. Mathematical truths that exist independent of Unix.

**The implication for agents:**
Current coding agents are sophisticated bash scripters. They read files, run commands, edit text — all Unix primitives. But this is because that's what's in the training data. The future should look more like **math + symbolic execution** (formal reasoning about programs, proving properties, manipulating abstract representations) rather than **Unix + whatever's popular on GitHub**.

**The humanity parenthetical:**
"(and it would be very bad for humanity if this wasn't true!)" — if agents are permanently locked to accidental conventions from training data rather than discovering fundamental computational principles, AI would just be a parrot of human convention rather than a tool that can reason from first principles. That caps its usefulness and makes it fragile.

**The subtext:**
Sunil got publicly dragged over a bash fork and responded not with defensiveness but with "actually, bash itself is the wrong abstraction for this entire era of computing."

## Related research

- [The LLMbda Calculus](https://arxiv.org/abs/2602.20064) (Feb 2026) — a formal lambda calculus for AI agent conversations with information-flow control and safety proofs. Exactly the kind of foundation Sunil is gesturing at.
- [Filesystems Are Having a Moment](https://madalitso.me/notes/why-everyone-is-talking-about-filesystems/) — the counter-argument: filesystems are the *right* primitive because they align with how both humans and models work.
- [Why Do Agents Love Filesystems](https://prateekjoshi.substack.com/p/why-do-agents-love-filesystems) — argues the filesystem is "the most durable abstraction in computing" and agents naturally gravitate to it.

## How this relates to machinen

This debate maps directly onto machinen's design space. Machinen checkpoint/restores full development containers — processes, memory, filesystem state — using CRIU. It operates at the Unix level by design: containers, filesystems, process trees.

Sunil's argument would say machinen is building on the *accidental* layer. But the counter is that developers live in the accidental layer right now, and machinen's value is making that layer seamlessly portable. The abstract mathematical future may be coming, but today's agents still need real bash, real filesystems, and real containers. Machinen makes those movable.

If Sunil is right about the long-term direction, machinen's bet is that the transition takes long enough that containerized dev environments remain the dominant substrate for years to come.
