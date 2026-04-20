// Installs an IPv4 default route via the given gateway.
// Usage: gw-set <gateway-ip>   (e.g. `gw-set 10.0.2.2`)
//
// Same reason lo-up.c / if-up.c exist: we don't want iproute2 in
// this initramfs, and this is one ioctl call.
// Build: zig cc -target aarch64-linux-musl -static -Os -o gw-set gw-set.c
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <net/route.h>
#include <unistd.h>

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <gateway>\n", argv[0]); return 2; }
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) { perror("socket"); return 1; }

    struct rtentry rt;
    memset(&rt, 0, sizeof(rt));

    struct sockaddr_in *dst  = (struct sockaddr_in *)&rt.rt_dst;
    struct sockaddr_in *gw   = (struct sockaddr_in *)&rt.rt_gateway;
    struct sockaddr_in *mask = (struct sockaddr_in *)&rt.rt_genmask;

    dst->sin_family  = AF_INET;
    dst->sin_addr.s_addr = 0;       // default
    mask->sin_family = AF_INET;
    mask->sin_addr.s_addr = 0;
    gw->sin_family   = AF_INET;
    if (inet_pton(AF_INET, argv[1], &gw->sin_addr) != 1) {
        fprintf(stderr, "bad gateway '%s'\n", argv[1]);
        return 3;
    }

    rt.rt_flags = RTF_UP | RTF_GATEWAY;
    if (ioctl(fd, SIOCADDRT, &rt) < 0) {
        perror("SIOCADDRT");
        return 4;
    }
    close(fd);
    return 0;
}
