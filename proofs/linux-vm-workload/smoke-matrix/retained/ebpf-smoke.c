#include <errno.h>
#include <linux/bpf.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <unistd.h>
int main(void) {
  union bpf_attr attr;
  memset(&attr, 0, sizeof(attr));
  attr.map_type = BPF_MAP_TYPE_ARRAY;
  attr.key_size = 4;
  attr.value_size = 4;
  attr.max_entries = 1;
  errno = 0;
  long fd = syscall(__NR_bpf, BPF_MAP_CREATE, &attr, sizeof(attr));
  printf("EBPF_SMOKE fd=%ld errno=%d\n", fd, errno);
  if (fd >= 0) { close((int)fd); return 0; }
  return errno == EPERM ? 77 : 1;
}
