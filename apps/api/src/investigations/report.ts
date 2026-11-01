import { z } from 'zod';

const MAX_TEXT = 1200;
const MAX_FINDINGS = 25;
const MAX_TIMELINE = 60;
const MAX_STEPS = 12;

export const findingSchema = z.object({
  kind: z.enum(['observed_fact', 'model_interpretation', 'hypothesis']),
  text: z.string().min(3).max(MAX_TEXT),
  evidenceRefs: z.array(z.string().max(100)).max(20).default([]),
});

export const agentReportSchema = z.object({
  mainSuspiciousActivity: z.string().min(3).max(MAX_TEXT),
  findings: z.array(findingSchema).max(MAX_FINDINGS),
  timeline: z.array(z.object({ at: z.string(), event: z.string().max(300), ref: z.string().max(100) })).max(MAX_TIMELINE),
  potentialExplanation: z.string().min(3).max(MAX_TEXT),
  recommendedSteps: z.array(z.string().min(3).max(400)).min(1).max(MAX_STEPS),
  confidenceAndLimitations: z.string().min(3).max(MAX_TEXT),
});

export type AgentReport = z.infer<typeof agentReportSchema>;
export type Finding = z.infer<typeof findingSchema>;

export interface FinalReport extends AgentReport {
  investigationId: string;
  batchId: string;
  riskScore: number;
  riskCategory: string;
  /** Number of findings removed because they cited records that were never retrieved. */
  droppedFindings: number;
}

/**
 * Enforces "never invent evidence": an observed fact must cite at least one record id that was
 * actually retrieved, and every cited id must be known. Model interpretations may cite records
 * but unknown refs are stripped; hypotheses are kept as hypotheses. Timeline rows with unknown
 * refs are dropped.
 */
export function sanitizeReport(report: AgentReport, knownRefs: ReadonlySet<string>): { report: AgentReport; dropped: number } {
  let dropped = 0;
  const findings: Finding[] = [];
  for (const f of report.findings) {
    const refs = f.evidenceRefs.filter((r) => knownRefs.has(r));
    if (f.kind === 'observed_fact' && (refs.length === 0 || refs.length !== f.evidenceRefs.length)) {
      dropped += 1;
      continue;
    }
    findings.push({ ...f, evidenceRefs: refs });
  }
  const timeline = report.timeline.filter((t) => knownRefs.has(t.ref));
  return { report: { ...report, findings, timeline }, dropped };
}
