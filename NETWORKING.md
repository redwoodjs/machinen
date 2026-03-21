🌐 Network & Persistence (Tailscale)
To prevent broken terminal pipes and network timeouts during migration:

Static IP: Both the Source and Destination must be joined to the same Tailscale Tailnet.

Consistent Addressing: By using the Tailscale IP (e.g., 100.x.y.z) in the sync script, the SSH and rsync connections remain stable regardless of the physical network (Wi-Fi/LTE) the Mac is using.

Socket Handover: While TCP sockets are preserved in the memory dump, the "outside world" must point to the Tailscale IP to ensure the destination host can still be reached after the migration.
