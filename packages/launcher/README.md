# machinen

The unscoped npm launcher for [`@machinen/cli`](https://www.npmjs.com/package/@machinen/cli).
It exists so the CLI can be run without installing a project dependency first:

```bash
npx machinen --help
npx machinen run machinen.dev/run/claude-code
```

The launcher contains no runtime implementation. It delegates every command to
the same-version `@machinen/cli` package, which installs the native package for
the current host automatically.

For a project dependency, install the canonical scoped package directly:

```bash
npm install @machinen/cli
```

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
