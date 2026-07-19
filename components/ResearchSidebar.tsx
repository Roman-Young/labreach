import type { AgentResult, EvidenceItem } from '@/types'

interface Props {
  result: AgentResult
  showEvidence?: boolean
}

export default function ResearchSidebar({ result, showEvidence = false }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider mb-2">
          What the agent found
        </h3>
        <div className="bg-surface rounded-lg border border-line p-4 space-y-3">
          <InfoRow label="PI" value={result.piName || 'Not found'} />
          <InfoRow label="Lab" value={result.labName || 'Not found'} />
          <div>
            <span className="block text-xs text-ink-faint mb-0.5">Email</span>
            {result.piEmail ? (
              <span className="text-[13px] text-pine font-mono break-all">{result.piEmail}</span>
            ) : (
              <span className="text-sm text-warn">
                Not found — look up {result.piName ? `${result.piName}'s` : 'their'} university profile or directory
              </span>
            )}
          </div>
        </div>
      </div>

      {result.specificHook && (
        <div>
          <h3 className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider mb-2">
            Key research finding
          </h3>
          <div className="bg-surface rounded-lg border border-line p-4">
            <p className="text-sm text-ink-soft leading-relaxed">{result.specificHook}</p>
          </div>
        </div>
      )}

      {result.bridgeSentence && (
        <div>
          <h3 className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider mb-2">
            Your connection to this lab
          </h3>
          <div className="bg-pine-wash rounded-lg border border-pine/25 p-4">
            <p className="text-sm text-pine-deep leading-relaxed italic">{result.bridgeSentence}</p>
          </div>
        </div>
      )}

      {showEvidence && (
        <div>
          <h3 className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider mb-2">
            Raw research evidence (debug)
          </h3>
          <div className="space-y-3">
            <EvidenceList title="Candidate findings" items={result.evidence.candidateFindings} />
            <EvidenceList title="Open problems" items={result.evidence.openProblems} />
            <EvidenceList title="Other quotable specifics" items={result.evidence.otherQuotableSpecifics} />
          </div>
        </div>
      )}

      {result.publicationsUsed.length > 0 && (
        <div>
          <h3 className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider mb-2">
            Publications used
          </h3>
          <ul className="space-y-2">
            {result.publicationsUsed.map((pub, i) => (
              <li key={i} className="bg-surface rounded-lg border border-line p-3">
                <p className="text-[13px] text-ink leading-snug">{pub.title}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {pub.year && (
                    <span className="font-mono text-xs text-ink-faint">{pub.year}</span>
                  )}
                  <span
                    className={`text-[11px] px-1.5 py-0.5 rounded border font-mono ${
                      pub.source === 'pubmed'
                        ? 'bg-sea-wash border-sea/25 text-sea'
                        : 'bg-pine-wash border-pine/25 text-pine'
                    }`}
                  >
                    {pub.source === 'pubmed' ? 'PubMed' : 'Lab website'}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.agentNote && (
        <div>
          <h3 className="font-mono text-[11px] font-medium text-ink-faint uppercase tracking-wider mb-2">
            Why the agent wrote it this way
          </h3>
          <div className="bg-surface rounded-lg border border-line p-4">
            <p className="text-sm text-ink-soft leading-relaxed">{result.agentNote}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-ink-faint mb-0.5">{label}</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  )
}

function EvidenceList({ title, items }: { title: string; items: EvidenceItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="bg-surface rounded-lg border border-line p-3">
      <p className="text-xs text-ink-faint mb-2">{title}</p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-ink-soft leading-relaxed">
            <span className="italic">&quot;{item.quote}&quot;</span>
            <span className="block text-ink-faint mt-0.5">
              {item.source}
              {item.note ? ` — ${item.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
