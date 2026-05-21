// Non-cooperative target for native mapping policy capture.
//
// The process creates an unreadable anonymous guard mapping and then spins.
// The external capturer should recreate that mapping as target PROT_NONE while
// treating kernel supplied vdso/vvar/special mappings as target-recreated rather
// than copied source bytes.

#define _GNU_SOURCE

#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

static volatile uint64_t native_mapping_policy_counter = 0;

static void die(const char *message) {
  fprintf(stderr, "machinen-native-mapping-policy-target: %s: %s\n", message, strerror(errno));
  exit(1);
}

int main(void) {
  long page_size = sysconf(_SC_PAGESIZE);
  if (page_size <= 0) {
    die("sysconf page size");
  }
  void *noaccess = mmap(NULL,
      (size_t)page_size,
      PROT_NONE,
      MAP_PRIVATE | MAP_ANONYMOUS,
      -1,
      0);
  if (noaccess == MAP_FAILED) {
    die("mmap noaccess page");
  }

  printf("MACHINEN_NATIVE_MAPPING_POLICY_TARGET pid=%ld noaccess=0x%" PRIxPTR "\n",
      (long)getpid(),
      (uintptr_t)noaccess);
  fflush(stdout);

  for (;;) {
    native_mapping_policy_counter++;
    if ((native_mapping_policy_counter & 0xfffffu) == 0) {
      __asm__ __volatile__("" ::: "memory");
    }
  }
}
