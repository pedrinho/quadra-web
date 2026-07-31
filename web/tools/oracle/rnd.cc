#include <stdint.h>
#include <time.h>
#include <stdio.h>
class Random {
  time_t seed;
public:
  Random(time_t p) { seed = p; }
  uint16_t rnd(int _and=0xFFFF) {
    int tmp;
    seed = seed * 0x41c64e6d + 0x00003039;
    tmp = int(seed >> 10);
    return static_cast<uint16_t>(tmp & _and);
  }
  uint16_t crap_rnd(int _and=0xFFFF) {
    int tmp;
    tmp = int(seed * 0x41c64e6d + 0x00003039);
    seed = tmp >> 10;
    return static_cast<uint16_t>(tmp & _and);
  }
};
int main() {
  printf("sizeof(time_t)=%zu\n", sizeof(time_t));
  long seeds[] = {0, 1, 12345, 987654321L, -42};
  for (int s = 0; s < 5; s++) {
    Random r(seeds[s]);
    printf("rnd seed=%ld:", seeds[s]);
    for (int i = 0; i < 12; i++) printf(" %u", r.rnd());
    printf("\n");
    Random r2(seeds[s]);
    printf("pieces seed=%ld:", seeds[s]);
    for (int i = 0; i < 20; i++) printf(" %u", r2.rnd() % 7);
    printf("\n");
    Random r3(seeds[s]);
    printf("crap seed=%ld:", seeds[s]);
    for (int i = 0; i < 12; i++) printf(" %u", r3.crap_rnd());
    printf("\n");
  }
  return 0;
}
