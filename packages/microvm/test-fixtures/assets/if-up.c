// Brings a named network interface UP via SIOCSIFFLAGS.
// Usage: if-up <iface>    (e.g. `if-up lo` or `if-up eth0`)
//
// Why a custom helper: we don't want iproute2 in this initramfs.
// Same reason lo-up.c exists — this is the generalised version.
// Build: zig cc -target aarch64-linux-musl -static -Os -o if-up if-up.c
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <iface>\n", argv[0]); return 2; }
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 1; }
    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, argv[1], IFNAMSIZ - 1);
    if (ioctl(fd, SIOCGIFFLAGS, &ifr) < 0) { perror("SIOCGIFFLAGS"); return 3; }
    ifr.ifr_flags |= IFF_UP | IFF_RUNNING;
    if (ioctl(fd, SIOCSIFFLAGS, &ifr) < 0) { perror("SIOCSIFFLAGS"); return 4; }
    close(fd);
    return 0;
}
