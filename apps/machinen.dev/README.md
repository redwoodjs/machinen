# machinen.dev

The Cloudflare Worker + RedwoodSDK marketing site for [machinen.dev](https://machinen.dev).

This app used to live in `redwoodjs/machinen.dev`. It now lives inside the main Machinen monorepo so product copy, docs, examples, and the website can move together.

## Development

From the repository root:

```bash
pnpm install
pnpm site:dev
pnpm site:build
```

Deploy with:

```bash
pnpm site:release
```
