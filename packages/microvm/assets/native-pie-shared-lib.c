// Shared library target for PIE/shared-library native code-map capture.
//
// The unmodified executable calls this exported function and then spins here.
// External ptrace/procfs capture should therefore observe an instruction pointer
// inside a shared-object mapping whose runtime address is ASLR-dependent.

#define _GNU_SOURCE

#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <unistd.h>

__attribute__((visibility("default"))) void machinen_native_pie_shared_spin(void) {
  static volatile uint64_t counter = 0;

  printf("MACHINEN_NATIVE_PIE_SHARED_LIB pid=%ld function=0x%" PRIxPTR "\n",
      (long)getpid(),
      (uintptr_t)&machinen_native_pie_shared_spin);
  fflush(stdout);

  for (;;) {
    counter++;
    if ((counter & 0xffffu) == 0) {
      __asm__ __volatile__("" : : "r"(counter) : "memory");
    }
  }
}
