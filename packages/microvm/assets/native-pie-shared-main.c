// PIE executable target for native shared-library code-map capture.
//
// This binary has no Machinen hooks. It simply enters an exported function in a
// sibling shared object and stays there until the external capturer stops it.

#define _GNU_SOURCE

#include <stdio.h>
#include <unistd.h>

void machinen_native_pie_shared_spin(void);

int main(void) {
  printf("MACHINEN_NATIVE_PIE_SHARED_MAIN pid=%ld\n", (long)getpid());
  fflush(stdout);
  machinen_native_pie_shared_spin();
  return 0;
}
