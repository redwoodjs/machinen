// Disable gvproxy auto-install/spawn for the whole test suite.
//
// Most tests boot stub binaries (`/bin/cat`, `/usr/bin/true`, fixture
// VMMs) and don't need a real user-mode network stack. Auto-spawning
// gvproxy — and more importantly auto-downloading it on a fresh host —
// costs seconds of test wall-clock and is just noise. Any test that
// actually wants gvproxy can `delete process.env.MACHINEN_GVPROXY` at
// the top of its case.
process.env.MACHINEN_GVPROXY = "disabled";
