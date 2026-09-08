This partial attempt is excluded in full. It used temporary harness commit
`0fee60b84692c150b185f55944f87c7e65a9e7b2`; the final harness
corrects its concurrent HTTP checksum accumulation. `checksum += await ...`
captured stale totals across workers even though each response was fully consumed
and validated. The replacement awaits first, then adds synchronously, and a
focused concurrent-body-accounting regression test covers the failure.

The owned recorder was sent SIGTERM at 2026-09-08 05:47 UTC to stop collection,
retaining stdout/stderr/load/status. The wrapper returned 254 after the recorder's
KeyboardInterrupt; `status.json` records interruption, not successful completion.
No row from this attempt contributes to the A/A envelope. Its measurement window
also recorded unrelated `npm install vsc` and `MainThread` CPU interference in
two samples; those processes were not stopped. Quiet-window rules and workload
settings were not changed when fixing the harness.
