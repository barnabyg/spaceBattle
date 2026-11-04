/** Safety limits, not expected runtimes. Keep enclosing tests longer than their waits. */
export const UI_TEST_TIMEOUT = 60_000;
export const UI_EXPECT_TIMEOUT = 15_000;
export const SIMULATION_EXPECT_TIMEOUT = 60_000;
export const SIMULATION_TEST_TIMEOUT = 120_000;
// A full-suite campaign run can exceed 150 s even when an isolated run takes about 20 s.
// Leave ample room for random scenarios and software-rendered, concurrent browser tests.
export const CAMPAIGN_BATTLE_TIMEOUT = 600_000;
export const CAMPAIGN_TEST_TIMEOUT = 720_000;
