import { monitorEventLoopDelay, performance, type EventLoopUtilization, type IntervalHistogram } from "node:perf_hooks";

export type RuntimeSample = {
  eventLoopDelayP99Ms: number;
  eventLoopDelayMaxMs: number;
  eventLoopUtilization: number;
  rssBytes: number;
  heapUsedBytes: number;
  uptimeSeconds: number;
};

function sample(histogram: IntervalHistogram, previous: EventLoopUtilization): { sample: RuntimeSample; previous: EventLoopUtilization } {
  const delta = performance.eventLoopUtilization(previous);
  const next = performance.eventLoopUtilization();
  const memory = process.memoryUsage();
  const current = {
    eventLoopDelayP99Ms: Math.round(histogram.percentile(99) / 1e6),
    eventLoopDelayMaxMs: Math.round(histogram.max / 1e6),
    eventLoopUtilization: Math.round(delta.utilization * 1000) / 1000,
    rssBytes: memory.rss,
    heapUsedBytes: memory.heapUsed,
    uptimeSeconds: Math.round(process.uptime()),
  };
  histogram.reset();
  return { sample: current, previous: next };
}

/** Periodic process sample. The timer does not keep the process alive. */
export function startRuntimeDiagnostics(
  emit: (sample: RuntimeSample) => void,
  intervalMs = 60_000
): () => void {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  let previous = performance.eventLoopUtilization();
  const timer = setInterval(() => {
    const next = sample(histogram, previous);
    previous = next.previous;
    emit(next.sample);
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
    histogram.disable();
  };
}
