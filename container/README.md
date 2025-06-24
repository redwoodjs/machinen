# Machinen Host!

## How to run multiple processes
### Using npm/pnpm (Recommended)



```bash\n# Run both the file server and development server\npnpm run dev:all\n\n# Or run individually:\npnpm run dev:server  # File server on port 8910\npnpm run dev         # Vite dev server on port 8911\n```\n\n### Using Docker\n\n```bash\n# Build and run the container\ndocker build -t machinen-host .\ndocker run -p 8910:8910 -p 8911:8911 machinen-host\n```\n\nThe application will be available at:\n\n- File server: http://localhost:8910\n- Development server: http://localhost:8911