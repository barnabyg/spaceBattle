import { describeRangeBalanceEvaluation } from './rangeBalanceEvaluation';

// Part 4 of 4 of the range balance evaluation, split so the runner fights them in parallel.
// RANGE_REPORT=1 prints one JSON record per battle for the balance report.
describeRangeBalanceEvaluation(3, 4, (record) => {
  if (process.env.RANGE_REPORT) console.log(JSON.stringify(record));
});
