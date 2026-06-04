#include <stdio.h>
#include <unistd.h>
int main(void) { printf("C_SMOKE_OK pid=%ld\n", (long)getpid()); return 0; }
