const CLIENT_MODULE_PATH = "/src/client.tsx";
const STYLESHEET_PATH = "/src/styles.css?direct";

export const Document: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <html lang="en">
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>Machinen — Your computer is already a cloud</title>
      <meta
        name="description"
        content="Run small, long-lived Linux VMs on hardware you control. Detach, reconnect, snapshot, fork, and hand them off when you need to."
      />
      <meta name="theme-color" content="#09090b" />
      <link rel="icon" href="/favicon-light.svg" media="(prefers-color-scheme: light)" />
      <link rel="icon" href="/favicon-dark.svg" media="(prefers-color-scheme: dark)" />
      <link rel="alternate" type="text/markdown" href="/index.md" />
      <link rel="stylesheet" href={STYLESHEET_PATH} />
      <link rel="modulepreload" href={CLIENT_MODULE_PATH} />
    </head>
    <body>
      {children}
      <script
        dangerouslySetInnerHTML={{ __html: `import(${JSON.stringify(CLIENT_MODULE_PATH)})` }}
      />
    </body>
  </html>
);
