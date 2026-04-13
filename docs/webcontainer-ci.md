# WebContainer CI — Zero-Infrastructure Agent CI

## Idea

Run agent-ci entirely in a WebContainer inside a headless browser. No Docker daemon, no container images, no privileged sockets. Playwright is both the host process and the test runner.

## Architecture

```
Host (Node.js)
├── Playwright (headless browser)
│   └── Page: Vite app (COOP/COEP headers for SharedArrayBuffer)
│       └── WebContainer
│           ├── TypeScript action runner (replaces official C# runner)
│           ├── npm install / build / dev server
│           └── user's project files
└── Playwright test runner
    └── tests against WebContainer's dev server URL
```

## How it works

1. `npx agent-ci run --workflow ci.yml` launches Playwright with a headless browser
2. Playwright opens a Vite-served page that boots a WebContainer
3. Project files are mounted into the WebContainer
4. A TypeScript action runner parses the workflow YAML and executes steps:
   - Shell commands (`npm install`, `npm run build`, etc.) → run inside the WebContainer via `spawn()`
   - JavaScript actions (`uses: actions/checkout@v4`, etc.) → downloaded and executed as Node.js in the WebContainer
   - Playwright tests → intercepted and run on the host Playwright instance, pointed at the WebContainer's dev server URL
5. Output streams back through Playwright to agent-ci's CLI

## TypeScript Action Runner

Reimplement the GitHub Actions runner in TypeScript. The official runner is C# and requires native Linux. A TS version runs anywhere Node.js runs, including WebContainers.

What to implement:
- Workflow YAML parsing (already have `@actions/workflow-parser`)
- Expression evaluation (`${{ github.sha }}`, `success()`, `hashFiles()`, etc.)
- Step execution (shell commands, JS actions)
- Context objects (`github`, `env`, `steps`, `inputs`, `secrets`)
- Outputs/state (`GITHUB_OUTPUT`, `GITHUB_ENV`, `GITHUB_PATH`)
- Conditionals (`if:` expressions)

What to skip:
- Runner registration / polling (no server)
- Docker container actions (`uses: docker://...`)
- Service containers
- Runner groups / labels

## Playwright Bridge

When the action runner encounters a step that needs a real browser (e.g., `npx playwright test`), it doesn't run it in the WebContainer. Instead:

1. WebContainer runs the dev server, fires `server-ready` with a URL
2. The action runner signals the host (via `page.evaluate` / message passing)
3. Host Playwright opens new pages against the WebContainer's dev server URL
4. Playwright tests execute on the host, results stream back to the action runner

## Pause-on-Failure

The WebContainer stays alive in the browser. When a step fails:
- The environment is warm (node_modules installed, dev server running)
- The agent fixes the code
- New files are mounted via `WebContainer.mount()`
- The failed step reruns without reinstalling or rebuilding

## What Works

- Node.js projects (install, lint, typecheck, test, build)
- JavaScript GitHub Actions
- Playwright E2E tests (via host bridge)
- Dev server previews

## What Doesn't Work

- Native binaries (gcc, python, go, etc.)
- Docker-based actions (`uses: docker://...`)
- Service containers
- Anything requiring real Linux syscalls

## Stack

- **Vite** — serves the WebContainer page with COOP/COEP headers
- **WebContainer** (`@webcontainer/api`) — browser-side Node.js runtime
- **ghostty-web** — terminal emulator for output display
- **Playwright** — headless browser host + E2E test runner
- **TypeScript action runner** — custom GitHub Actions runner for WebContainers
