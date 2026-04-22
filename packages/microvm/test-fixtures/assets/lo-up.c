// Brings up the loopback interface. CRIU's `kerndat_tcp_repair` probe
// creates a TCP socket and calls connect(), which fails with
// "Network is unreachable" when lo is still DOWN — and CRIU treats
// that as a fatal init error. This tiny helper does the same thing
// `ip link set lo up` would, without dragging iproute2 into the VM.
//
// Build: zig cc -target aarch64-linux-musl -static -Os -o lo-up lo-up.c
#include <sys/ioctl.h>
#include <sys/socket.h>
#include <net/if.h>
#include <string.h>
#include <unistd.h>

int main(void) {
    int fd = socket(AF_INET, SOCK_DGRAM, 0);
    if (fd < 0) return 1;
    struct ifreq ifr;
    memset(&ifr, 0, sizeof(ifr));
    strncpy(ifr.ifr_name, "lo", IFNAMSIZ - 1);
    if (ioctl(fd, SIOCGIFFLAGS, &ifr) < 0) return 2;
    ifr.ifr_flags |= IFF_UP | IFF_RUNNING;
    if (ioctl(fd, SIOCSIFFLAGS, &ifr) < 0) return 3;
    close(fd);
    return 0;
}
