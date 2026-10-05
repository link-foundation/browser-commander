/* A process-local clock shim for reproducing fixture-name collisions.
 * CLOCK_MONOTONIC and the host clock remain unchanged.
 */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <time.h>

int clock_gettime(clockid_t clock, struct timespec *value) {
    int (*real_clock_gettime)(clockid_t, struct timespec *) =
        dlsym(RTLD_NEXT, "clock_gettime");
    int result = real_clock_gettime(clock, value);
    if (result == 0 && clock == CLOCK_REALTIME) {
        value->tv_nsec = 0;
    }
    return result;
}
