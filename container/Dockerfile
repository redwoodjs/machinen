FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

EXPOSE 8910 8911

RUN corepack enable 
WORKDIR /app
COPY . .

RUN wget -qO- https://get.pnpm.io/install.sh | ENV="$HOME/.bashrc" SHELL="$(which bash)" bash -
RUN pnpm install

CMD ["pnpm", "run", "dev:all"]