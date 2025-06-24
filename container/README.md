# Machinen Host

## How to run multiple processes

### Using npm/pnpm (Recommended)

```bash
# Run both the file server and development server
pnpm run dev:all

# Or run individually:
pnpm run dev:server  # File server on port 8910
pnpm run dev         # Vite dev server on port 8911
```

### Using Docker

```bash
# Build and run the container
docker build -t machinen-host .
docker run -p 8910:8910 -p 8911:8911 machinen-host
```

The application will be available at:

- File server: http://localhost:8910
- Development server: http://localhost:8911
