// Bring up lo + eth0, assign 10.0.2.15/24 to eth0, install a default
// route via 10.0.2.2. Matches SLIRP's defaults (see
// packages/microvm/src/slirp.zig — guest net 10.0.2.0/24, gw 10.0.2.2,
// DNS 10.0.2.3). Static musl binary invoked once by /init before it
// execve's the user cmd, so every machinen microVM boots with working
// network with no bundle-level boilerplate.
//
// We skip DHCP (no client in the minbase rootfs) and use the same
// address libslirp's DHCP server would have handed out.
//
// Build: zig cc -target aarch64-linux-musl -static -Os -o machinen-netup machinen-netup.c
#include <stdio.h>
#include <string.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <net/route.h>
#include <unistd.h>

static int if_up(int s, const char *name) {
    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, name, IFNAMSIZ - 1);
    if (ioctl(s, SIOCGIFFLAGS, &ifr) < 0) return -1;
    ifr.ifr_flags |= IFF_UP | IFF_RUNNING;
    if (ioctl(s, SIOCSIFFLAGS, &ifr) < 0) return -1;
    return 0;
}

static int if_addr(int s, const char *name, const char *ip, const char *mask) {
    struct ifreq ifr;
    struct sockaddr_in *sin = (struct sockaddr_in *)&ifr.ifr_addr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, name, IFNAMSIZ - 1);
    sin->sin_family = AF_INET;

    if (inet_pton(AF_INET, ip, &sin->sin_addr) != 1) return -1;
    if (ioctl(s, SIOCSIFADDR, &ifr) < 0) return -1;

    if (inet_pton(AF_INET, mask, &sin->sin_addr) != 1) return -1;
    if (ioctl(s, SIOCSIFNETMASK, &ifr) < 0) return -1;
    return 0;
}

static int gw_set(int s, const char *gw) {
    struct rtentry rt;
    memset(&rt, 0, sizeof(rt));
    struct sockaddr_in *dst = (struct sockaddr_in *)&rt.rt_dst;
    struct sockaddr_in *g   = (struct sockaddr_in *)&rt.rt_gateway;
    struct sockaddr_in *msk = (struct sockaddr_in *)&rt.rt_genmask;
    dst->sin_family = AF_INET;
    msk->sin_family = AF_INET;
    g->sin_family   = AF_INET;
    if (inet_pton(AF_INET, gw, &g->sin_addr) != 1) return -1;
    rt.rt_flags = RTF_UP | RTF_GATEWAY;
    if (ioctl(s, SIOCADDRT, &rt) < 0) return -1;
    return 0;
}

int main(void) {
    int s = socket(AF_INET, SOCK_DGRAM, 0);
    if (s < 0) { perror("socket"); return 1; }
    if (if_up(s, "lo") < 0) perror("lo up");                  // non-fatal
    if (if_up(s, "eth0") < 0) { perror("eth0 up"); return 2; }
    if (if_addr(s, "eth0", "10.0.2.15", "255.255.255.0") < 0) {
        perror("eth0 addr"); return 3;
    }
    if (gw_set(s, "10.0.2.2") < 0) { perror("gw set"); return 4; }
    close(s);
    return 0;
}
