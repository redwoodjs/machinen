// Bring up lo + eth0, assign 192.168.127.2/24 to eth0, install a
// default route via 192.168.127.1. Matches gvproxy's defaults
// (containers/gvisor-tap-vsock — guest net 192.168.127.0/24, gateway
// 192.168.127.1, built-in DNS on the same IP). Static musl binary
// invoked once by /init before it execve's the user cmd, so every
// machinen microVM boots with working network with no bundle-level
// boilerplate.
//
// We skip DHCP (no client in the minbase rootfs) and pick the first
// address in gvproxy's DHCP pool so there's no collision.
//
// Build: zig cc -target aarch64-linux-musl -static -Os -o machinen-netup machinen-netup.c
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
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

// Open the unprivileged ICMP datagram socket gid range to every gid so
// `ping` works for non-root users (#203). Upstream default is `1 0`
// (an empty range) which makes `socket(AF_INET, SOCK_DGRAM,
// IPPROTO_ICMP)` return EAFNOSUPPORT for any gid. Best-effort: if the
// sysctl is missing (older kernel, hardened sysctl namespace) just
// continue — root still has raw sockets.
static void enable_unpriv_ping(void) {
    int fd = open("/proc/sys/net/ipv4/ping_group_range", O_WRONLY);
    if (fd < 0) return;
    static const char range[] = "0\t2147483647\n";
    (void)write(fd, range, sizeof(range) - 1);
    close(fd);
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

// Poll /sys/class/net/eth0 for up to ~1s — virtio probe is async
// after the kernel binds virtio_net to the DTB device. The drivers
// themselves are built into the kernel (#119: CONFIG_VIRTIO_NET=y);
// we just need to wait for the bind to complete before configuring
// the interface.
static int wait_for_eth0(void) {
    struct stat st;
    for (int i = 0; i < 20; i++) {
        if (stat("/sys/class/net/eth0", &st) == 0) return 0;
        usleep(50 * 1000);
    }
    return -1;
}

int main(void) {
    // Independent of eth0 — runs first so even a partial network
    // bring-up (or a re-invocation that hits EEXIST on the route) still
    // leaves unprivileged ping working for non-root users (#203).
    enable_unpriv_ping();

    if (wait_for_eth0() < 0) {
        fprintf(stderr, "machinen-netup: eth0 did not appear\n");
        return 6;
    }

    int s = socket(AF_INET, SOCK_DGRAM, 0);
    if (s < 0) { perror("socket"); return 1; }
    if (if_up(s, "lo") < 0) perror("lo up");                  // non-fatal
    if (if_up(s, "eth0") < 0) { perror("eth0 up"); return 2; }
    if (if_addr(s, "eth0", "192.168.127.2", "255.255.255.0") < 0) {
        perror("eth0 addr"); return 3;
    }
    if (gw_set(s, "192.168.127.1") < 0) { perror("gw set"); return 4; }
    close(s);
    return 0;
}
