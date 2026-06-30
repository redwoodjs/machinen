import type { ReactNode } from "react";

import { CopyPromptButton } from "./CopyPromptButton";

const LOOP_CLI = `npx machinen bake claude
npx machinen boot --name agent --detach \\
  --mount-live "$PWD:/mnt/workspace:rw" \\
  ~/.machinen/recipes/claude.tar.gz
npx machinen attach agent

# from another terminal, another SSH session, or after your client drops:
npx machinen attach agent`;

const SESSION_CLI = `npx machinen attach --session editor agent   # another persistent terminal
npx machinen sessions agent                  # list live sessions
npx machinen session-kill agent editor       # reset one session
npx machinen stop agent                      # shut down the VM`;

const AGENT_CLI = `npx machinen bake pi
npx machinen boot --name pi-agent --detach \\
  --mount-live "$PWD:/mnt/workspace:rw" \\
  ~/.machinen/recipes/pi.tar.gz

npx machinen attach pi-agent
pi -p "inspect this repository"`;

const POWER_CLI = `npx machinen snapshot agent ./agent.snap
npx machinen restore ./agent.snap --name agent-restored \\
  --mount-live "$PWD:/mnt/workspace:rw"

npx machinen fork agent --new-name agent-b --detach \\
  --mount-live "$PWD:/mnt/workspace:rw"`;

const INSTALL_CLI = `npm i @machinen/cli @machinen/runtime
npx machinen --help`;

const ASCII_HEADING = String.raw` __  __    _    ____ _   _ ___ _   _ _____ _   _
|  \/  |  / \  / ___| | | |_ _| \ | | ____| \ | |
| |\/| | / _ \| |   | |_| || ||  \| |  _| |  \| |
| |  | |/ ___ \ |___|  _  || || |\  | |___| |\  |
|_|  |_/_/   \_\____|_| |_|___|_| \_|_____|_| \_|`;

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="mb-6 select-none overflow-hidden font-bold whitespace-pre text-brand">
      {`=== ${children} ${"=".repeat(76)}`}
    </div>
  );
}

function CodeBlock({ title, code }: { title: string; code: string }) {
  return (
    <div className="my-4 max-w-full">
      <div className="flex border border-[#333] border-b-0 bg-[#111] px-4 py-2 text-[#888] uppercase tracking-widest select-none">
        <span>{`> ${title}`}</span>
      </div>
      <div className="terminal-scroll overflow-x-auto border border-[#333] p-4">
        <pre className="text-[#88d088] leading-relaxed">
          <code className="block min-w-max">{code}</code>
        </pre>
      </div>
    </div>
  );
}

function PromptLine({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="font-bold text-brand">$</span>
      <span>{children}</span>
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border border-[#333] bg-[#0a0a0a] p-4">
      <div className="mb-2 font-bold text-white">&gt; {title}</div>
      <p className="text-[#aaa]">{children}</p>
    </div>
  );
}

function Capability({ children }: { children: ReactNode }) {
  return <div>[x] {children}</div>;
}

export const Landing = () => (
  <div className="min-h-screen bg-[#050505] font-mono text-[#ccc]">
    <div className="mx-auto w-full max-w-[100ch] px-4 py-8 leading-relaxed md:py-12">
      <nav className="mb-8 flex flex-col gap-4 border-b border-[#333] pb-4 text-[#888] sm:flex-row sm:justify-between">
        <div>
          <span className="text-brand">root@machinen</span>
          <span className="text-white">:~</span>$ cat cloud-you-own.md
        </div>
        <div className="flex gap-6 uppercase tracking-widest">
          <a
            href="https://github.com/redwoodjs/machinen"
            className="transition-all hover:text-white hover:underline"
          >
            [Github]
          </a>
          <a href="/index.md" className="transition-all hover:text-white hover:underline">
            [Markdown]
          </a>
        </div>
      </nav>

      <main>
        <a href="/" aria-label="Machinen">
          <img src="/logo.svg" alt="Machinen" className="my-8 h-10 w-auto" />
        </a>

        <pre className="ascii-heading my-8 max-w-full overflow-hidden whitespace-pre text-[clamp(7px,1.2vw,14px)] font-bold leading-[1.1] text-white select-none">
          {ASCII_HEADING}
        </pre>

        <h1 className="sr-only">Your computer is already a cloud.</h1>
        <p className="mb-6 max-w-[68ch] text-xl text-white md:text-2xl">
          Your computer is already a cloud. Machinen makes it feel like one.
        </p>
        <p className="mb-8 max-w-[72ch] text-[#aaa]">
          You already have machines: one on your lap, one on your desk, maybe one humming in a
          closet. Machinen gives you small, named Linux VMs on the hardware you control. They run in
          the background, keep terminal sessions alive, and let you reconnect from another shell
          later.
        </p>
        <p className="mb-8 max-w-[72ch] text-[#aaa]">
          No tiny rented slice. No hyperscaler-shaped workflow. Just cloud-shaped computers that
          belong to you.
        </p>

        <div className="mb-10 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <CopyPromptButton className="cursor-pointer border border-[#333] bg-[#0a0a0a] px-4 py-2 font-mono text-white transition-colors hover:border-brand hover:text-brand" />
          <a
            href="https://github.com/redwoodjs/machinen/blob/main/README.md"
            className="border border-[#333] bg-[#0a0a0a] px-4 py-2 text-white transition-colors hover:border-brand hover:text-brand"
          >
            View README.md
          </a>
          <a
            href="https://github.com/redwoodjs/machinen/tree/main/docs"
            className="border border-[#333] bg-[#0a0a0a] px-4 py-2 text-white transition-colors hover:border-brand hover:text-brand"
          >
            Read docs
          </a>
        </div>

        <section className="mb-16">
          <SectionTitle>THE LOOP</SectionTitle>
          <p className="mb-6 max-w-[72ch] text-[#aaa]">
            Start a little Linux machine, detach from it, and come back later.
            <code> attach </code> opens a real PTY with job control, tab completion, full-screen
            TUIs, and Ctrl-C going to the guest.
          </p>
          <CodeBlock title="terminal.sh" code={LOOP_CLI} />
          <p className="mt-6 max-w-[72ch] text-[#aaa]">
            By default, <code>attach</code> creates or reconnects a persistent session named{" "}
            <code>default</code>. If your host terminal or SSH connection disappears, the shell
            keeps running inside the VM.
          </p>
          <CodeBlock title="sessions.sh" code={SESSION_CLI} />
        </section>

        <section className="mb-16">
          <SectionTitle>AN AGENT VM YOU OWN</SectionTitle>
          <p className="mb-6 max-w-[72ch] text-[#aaa]">
            Bake a Claude or Pi image, mount the current project at <code>/mnt/workspace</code>, and
            run the agent in a reconnectable terminal. The VM and guest exec agent stay alive after
            the boot command returns.
          </p>
          <CodeBlock title="agent.sh" code={AGENT_CLI} />
        </section>

        <section className="mb-16">
          <SectionTitle>POWER TOOLS</SectionTitle>
          <div className="mb-8 grid gap-4 md:grid-cols-3">
            <Card title="SNAPSHOT">
              Freeze the VM exactly as it is: CPU state, memory, devices, and disk.
            </Card>
            <Card title="RESTORE">
              Thaw the snapshot on another same-architecture host and continue.
            </Card>
            <Card title="FORK">
              Branch a warm VM into siblings that diverge from the same moment.
            </Card>
          </div>
          <CodeBlock title="power-tools.sh" code={POWER_CLI} />
        </section>

        <section className="mb-16">
          <SectionTitle>WHAT YOU GET</SectionTitle>
          <div className="mb-8 space-y-2 text-[#888] select-none">
            <Capability>Small, named Linux VMs on hardware you control</Capability>
            <Capability>Persistent terminal sessions, no tmux required</Capability>
            <Capability>Baked Claude/Pi agent VM recipes</Capability>
            <Capability>One-off exec for scripts and agent tools</Capability>
            <Capability>Port forwards and live host-directory mounts</Capability>
            <Capability>Snapshot, restore, fork, and handoff</Capability>
            <Capability>Apple Silicon, arm64 Linux, and amd64 Linux/KVM</Capability>
          </div>
          <div className="border border-[#333] bg-[#0a0a0a] p-4 text-[#888]">
            <PromptLine>npm i @machinen/cli @machinen/runtime</PromptLine>
            <PromptLine>npx machinen bake claude</PromptLine>
            <PromptLine>
              npx machinen boot --name agent --detach --mount-live "$PWD:/mnt/workspace:rw"
              ~/.machinen/recipes/claude.tar.gz
            </PromptLine>
            <PromptLine>npx machinen attach agent</PromptLine>
          </div>
        </section>

        <section className="mb-16">
          <SectionTitle>INSTALL</SectionTitle>
          <CodeBlock title="install.sh" code={INSTALL_CLI} />
        </section>
      </main>

      <footer className="border-t border-[#333] pt-8 select-none">
        <div className="mb-4">
          <span className="animate-pulse text-brand">█</span>
        </div>
        <p className="text-[#666]">
          Machinen is open source under the Functional Source License.
          <br />
          <a
            href="https://github.com/redwoodjs/machinen"
            className="text-[#888] underline hover:text-white"
          >
            github.com/redwoodjs/machinen
          </a>
        </p>
      </footer>
    </div>
  </div>
);
