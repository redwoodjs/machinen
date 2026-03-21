#!/bin/bash

# --- Configuration ---
CONTAINER_NAME="session-poc"
CHECKPOINT_ID="sync_$(date +%s)"
SYNC_DIR="$HOME/sync-dir"
REMOTE_USER="your-user"
REMOTE_HOST="your-tailscale-ip" # Use your Tailscale IP here
REMOTE_PATH="~/sync-dir"

echo "🚀 Starting Live-Migration for: $CONTAINER_NAME"

# 1. Ensure local checkpoint directory exists
mkdir -p "$SYNC_DIR"

# 2. Checkpoint the container (Freeze RAM to disk)
echo "📦 Creating checkpoint: $CHECKPOINT_ID..."
docker checkpoint create --checkpoint-dir "$SYNC_DIR" "$CONTAINER_NAME" "$CHECKPOINT_ID"

if [ $? -ne 0 ]; then
    echo "❌ Checkpoint failed. Check if experimental mode is enabled."
    exit 1
fi

# 3. Progressive Sync via rsync (The "Move")
echo "🌐 Syncing delta to remote host over Tailscale..."
rsync -azP --delete "$SYNC_DIR/" "$REMOTE_USER@$REMOTE_HOST:$REMOTE_PATH/"

# 4. Remote Restore (The "Thaw")
echo "📥 Restoring session on remote host..."
ssh "$REMOTE_USER@$REMOTE_HOST" << EOF
    # Ensure the container shell exists (non-destructive if already there)
    if ! docker ps -a --format '{{.Names}}' | grep -q "^$CONTAINER_NAME$"; then
        echo "🔨 Creating remote container shell..."
        docker create --name "$CONTAINER_NAME" alpine \
          sh -c 'i=0; while true; do echo "Counter: \$i"; i=\$((i+1)); sleep 2; done'
    fi

    # Restore the memory state
    echo "🔥 Thawing process..."
    docker start --checkpoint-dir "$REMOTE_PATH" --checkpoint "$CHECKPOINT_ID" "$CONTAINER_NAME"
EOF

echo "✅ Migration Complete. Check remote logs with: ssh $REMOTE_USER@$REMOTE_HOST 'docker logs -f $CONTAINER_NAME'"
