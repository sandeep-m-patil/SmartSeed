import type { AgentReport, Finding } from './report';
import type { Evidence } from './evidence';

const SAMPLE_REFS = 5;
const TIMELINE_MAX = 40;

const asDate = (v: unknown): number => new Date(String(v)).getTime();
const sample = (kind: string, rows: Record<string, unknown>[]): string[] => rows.slice(0, SAMPLE_REFS).map((r) => `${kind}:${r.id}`);

function scanFindings(e: Evidence): Finding[] {
  if (e.scans.length === 0) return [];
  const devices = new Set(e.scans.filter((s) => s.hasDevice).map((s) => s.deviceTag)).size;
  const places = new Set(e.scans.filter((s) => s.lat != null).map((s) => `${s.lat},${s.lon}`)).size;
  const times = e.scans.map((s) => asDate(s.scannedAt));
  const spanMin = Math.round((Math.max(...times) - Math.min(...times)) / 60_000);
  return [{
    kind: 'observed_fact',
    text: `${e.scans.length} QR scans were recorded for this batch within ${spanMin} minute(s), from ${devices} distinct device(s) and ${places} distinct rounded location(s).`,
    evidenceRefs: sample('scan', e.scans),
  }];
}

function chainFindings(e: Evidence): Finding[] {
  const total = e.events.filter((ev) => ev.chainStatus != null).length;
  const committed = e.events.filter((ev) => ev.chainStatus === 'committed').length;
  const out: Finding[] = [];
  if (total > 0) {
    out.push({
      kind: 'observed_fact',
      text: `${committed} of ${total} ledger-bound supply-chain events are committed on the blockchain; ledger verification state is "${String(e.batch.ledgerStatus)}".`,
      evidenceRefs: [`batch:${e.batch.id}`, ...sample('event', e.events)],
    });
  }
  return out;
}

function attemptFindings(e: Evidence): Finding[] {
  if (e.attempts.length === 0) return [];
  const reasons = [...new Set(e.attempts.map((a) => String(a.reason)))].join(', ');
  return [{ kind: 'observed_fact', text: `${e.attempts.length} rejected operation(s) were logged for this batch (reasons: ${reasons}).`, evidenceRefs: sample('attempt', e.attempts) }];
}

function reportFindings(e: Evidence): Finding[] {
  if (e.reports.length === 0) return [];
  return [{ kind: 'observed_fact', text: `${e.reports.length} farmer report(s) of a suspected counterfeit packet were received for this batch.`, evidenceRefs: sample('report', e.reports) }];
}

function modelFindings(e: Evidence): Finding[] {
  const p = e.prediction;
  if (!p) return [];
  const indicators = (p.indicators as { description: string }[]) ?? [];
  const list = indicators.slice(0, 4).map((i) => i.description).join(' ');
  return [{
    kind: 'model_interpretation',
    text: `The detection model (${String(p.mode)}, version ${String(p.modelVersion)}) scored this batch ${String(p.riskScore)}/100 (${String(p.level)}). ${list}`.trim(),
    evidenceRefs: [`prediction:${p.id}`],
  }];
}

function hypotheses(e: Evidence): Finding[] {
  const types = new Set(e.alerts.map((a) => String(a.alertType)));
  const out: Finding[] = [];
  if (types.has('SCAN_ANOMALY') || types.has('SCAN_GEO_ANOMALY')) {
    out.push({ kind: 'hypothesis', text: 'A legitimate QR label may have been copied onto other packets. This is unverified; physical inspection of the scanned packets is needed.', evidenceRefs: [] });
  }
  if (types.has('INVENTORY_MISMATCH')) {
    out.push({ kind: 'hypothesis', text: 'Stock may have left the recorded chain (diversion) or been recorded incorrectly. This is unverified.', evidenceRefs: [] });
  }
  return out;
}

function timeline(e: Evidence): AgentReport['timeline'] {
  const rows = [
    ...e.events.map((ev) => ({ at: String(ev.occurredAt), event: `Supply-chain event: ${String(ev.eventType)}`, ref: `event:${ev.id}` })),
    ...e.scans.slice(0, 20).map((s) => ({ at: String(s.scannedAt), event: 'QR scan recorded', ref: `scan:${s.id}` })),
    ...e.attempts.slice(0, 10).map((a) => ({ at: String(a.createdAt), event: `Rejected operation: ${String(a.kind)} (${String(a.reason)})`, ref: `attempt:${a.id}` })),
  ];
  return rows.sort((a, b) => asDate(a.at) - asDate(b.at)).slice(-TIMELINE_MAX);
}

const STEPS_BY_LEVEL: Record<string, string[]> = {
  CRITICAL: ['Place a temporary hold on further transfers and sales of this batch through the authorised workflow.', 'Contact the manufacturer and the receiving distributors to confirm the physical location of stock.', 'Inspect scanned packets against the manufacturer reference sample.'],
  HIGH: ['Review the cited scans and transactions manually.', 'Request additional verification from the holders of this batch.'],
};

/**
 * Deterministic report built only from retrieved records. Used when no LLM is configured or the
 * LLM path fails validation; it carries no narrative beyond what the records state.
 */
export function buildEvidenceReport(e: Evidence, alertType: string, level: string): AgentReport {
  const findings = [...scanFindings(e), ...chainFindings(e), ...attemptFindings(e), ...reportFindings(e), ...modelFindings(e), ...hypotheses(e)];
  return {
    mainSuspiciousActivity: `Alert ${alertType} on batch ${String(e.batch.batchCode)} (${level}).`,
    findings: findings.length ? findings : [{ kind: 'hypothesis', text: 'No supporting records were retrieved; the alert cannot be explained from available data.', evidenceRefs: [] }],
    timeline: timeline(e),
    potentialExplanation: 'The records show the pattern that triggered the alert. They do not by themselves establish counterfeiting; interpretations above are marked as model output or unverified hypotheses.',
    recommendedSteps: STEPS_BY_LEVEL[level] ?? ['Review the cited records and decide whether further verification is needed.'],
    confidenceAndLimitations:
      'Generated by rules from retrieved database and ledger records only. Detection thresholds are untuned defaults, geolocation is rounded to about 1 km, and blockchain commitments prove integrity of what was recorded, not that physical stock matches.',
  };
}
