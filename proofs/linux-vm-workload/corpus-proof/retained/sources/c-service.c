#include <stdio.h>
#include <string.h>
int main(void) {
  const char *request = "GET /health";
  const char *response = strcmp(request, "GET /health") == 0 ? "200 OK c-service" : "500";
  printf("C_SERVICE_WORKLOAD_OK request='%s' response='%s'\n", request, response);
  return strcmp(response, "200 OK c-service") == 0 ? 0 : 1;
}
