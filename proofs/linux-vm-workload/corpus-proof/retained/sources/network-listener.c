#include <arpa/inet.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
int main(void) {
  int server = socket(AF_INET, SOCK_STREAM, 0);
  if (server < 0) { perror("socket"); return 1; }
  int yes = 1;
  setsockopt(server, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes));
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = 0;
  if (bind(server, (struct sockaddr *)&addr, sizeof(addr)) != 0) { perror("bind"); return 1; }
  socklen_t len = sizeof(addr);
  if (getsockname(server, (struct sockaddr *)&addr, &len) != 0) { perror("getsockname"); return 1; }
  if (listen(server, 1) != 0) { perror("listen"); return 1; }
  pid_t child = fork();
  if (child < 0) { perror("fork"); return 1; }
  if (child == 0) {
    int client = socket(AF_INET, SOCK_STREAM, 0);
    if (client < 0) _exit(2);
    if (connect(client, (struct sockaddr *)&addr, sizeof(addr)) != 0) _exit(3);
    if (write(client, "PING", 4) != 4) _exit(4);
    char reply[4] = {0};
    if (read(client, reply, 4) != 4) _exit(5);
    _exit(memcmp(reply, "PONG", 4) == 0 ? 0 : 6);
  }
  int peer = accept(server, NULL, NULL);
  if (peer < 0) { perror("accept"); return 1; }
  char buf[4] = {0};
  if (read(peer, buf, 4) != 4) { perror("read"); return 1; }
  if (memcmp(buf, "PING", 4) != 0) return 1;
  if (write(peer, "PONG", 4) != 4) { perror("write"); return 1; }
  int status = 0;
  waitpid(child, &status, 0);
  printf("NETWORK_LISTENER_WORKLOAD_OK port=%u childStatus=%d\n", ntohs(addr.sin_port), status);
  return (WIFEXITED(status) && WEXITSTATUS(status) == 0) ? 0 : 1;
}
