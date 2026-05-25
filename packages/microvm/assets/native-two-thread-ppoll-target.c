#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

static _Atomic int worker_ready = 0;
static volatile uint64_t main_spin_counter = 0;

static void clear_simd_fpu_state(void) {
#if defined(__aarch64__)
  __asm__ __volatile__(
      "movi v0.16b, #0\n"
      "movi v1.16b, #0\n"
      "movi v2.16b, #0\n"
      "movi v3.16b, #0\n"
      "movi v4.16b, #0\n"
      "movi v5.16b, #0\n"
      "movi v6.16b, #0\n"
      "movi v7.16b, #0\n"
      "movi v8.16b, #0\n"
      "movi v9.16b, #0\n"
      "movi v10.16b, #0\n"
      "movi v11.16b, #0\n"
      "movi v12.16b, #0\n"
      "movi v13.16b, #0\n"
      "movi v14.16b, #0\n"
      "movi v15.16b, #0\n"
      "movi v16.16b, #0\n"
      "movi v17.16b, #0\n"
      "movi v18.16b, #0\n"
      "movi v19.16b, #0\n"
      "movi v20.16b, #0\n"
      "movi v21.16b, #0\n"
      "movi v22.16b, #0\n"
      "movi v23.16b, #0\n"
      "movi v24.16b, #0\n"
      "movi v25.16b, #0\n"
      "movi v26.16b, #0\n"
      "movi v27.16b, #0\n"
      "movi v28.16b, #0\n"
      "movi v29.16b, #0\n"
      "movi v30.16b, #0\n"
      "movi v31.16b, #0\n"
      "msr fpsr, xzr\n"
      "msr fpcr, xzr\n"
      ::: "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10",
      "v11", "v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19", "v20",
      "v21", "v22", "v23", "v24", "v25", "v26", "v27", "v28", "v29", "v30",
      "v31", "memory");
#endif
}

static void *worker_main(void *opaque) {
  (void)opaque;
  clear_simd_fpu_state();
  atomic_store_explicit(&worker_ready, 1, memory_order_release);

  struct timespec timeout = {.tv_sec = 30, .tv_nsec = 0};
  long rc = syscall(SYS_ppoll, NULL, 0, &timeout, NULL, 0);
  if (rc < 0) {
    fprintf(stderr, "machinen-two-thread-ppoll-target: ppoll: %s\n", strerror(errno));
  }
  return NULL;
}

int main(void) {
  pthread_t worker;
  int err = pthread_create(&worker, NULL, worker_main, NULL);
  if (err != 0) {
    fprintf(stderr, "machinen-two-thread-ppoll-target: pthread_create: %s\n", strerror(err));
    return 1;
  }

  while (atomic_load_explicit(&worker_ready, memory_order_acquire) == 0) {
    __asm__ __volatile__("" ::: "memory");
  }
  clear_simd_fpu_state();

  for (;;) {
    main_spin_counter++;
    if ((main_spin_counter & 0xfffffu) == 0) {
      __asm__ __volatile__("" ::: "memory");
    }
  }
}
