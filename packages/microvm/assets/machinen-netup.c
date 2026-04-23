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
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <arpa/inet.h>
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/wait.h>
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

// The Debian cloud-arm64 kernel ships virtio_mmio (the bus transport
// that drives the virtio_mmio@... DTB entries) and virtio_net (the
// net-device driver) as separate modules on orthogonal axes.
// virtio_net depends on virtio + virtio_ring but NOT on virtio_mmio,
// so we have to modprobe both: virtio_mmio to bind the DTB entries,
// virtio_net to claim the resulting virtio devices.
static int modprobe_virtio_net(void) {
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        execl("/sbin/modprobe", "modprobe", "-a", "virtio_mmio", "virtio_net", (char *)NULL);
        _exit(127);
    }
    int st = 0;
    if (waitpid(pid, &st, 0) < 0) return -1;
    return (WIFEXITED(st) && WEXITSTATUS(st) == 0) ? 0 : -1;
}

// Poll /sys/class/net/eth0 for up to ~1s — virtio probe is async
// after modprobe returns.
static int wait_for_eth0(void) {
    struct stat st;
    for (int i = 0; i < 20; i++) {
        if (stat("/sys/class/net/eth0", &st) == 0) return 0;
        usleep(50 * 1000);
    }
    return -1;
}

int main(void) {
    if (modprobe_virtio_net() < 0) {
        fprintf(stderr, "machinen-netup: modprobe virtio_net failed\n");
        return 5;
    }
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
