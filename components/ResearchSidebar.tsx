import type { AgentResult, EvidenceItem } from '@/types'

interface Props {
  result: AgentResult
  showEvidence?: boolean
}

export default function ResearchSidebar({ result, showEvidence = false }: Props) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
          What the agent found
        </h3>
        <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-4 space-y-3">
          <InfoRow label="PI" value={result.piName || 'Not found'} />
          <InfoRow label="Lab" value={result.labName || 'Not found'} />
          <div>
            <span className="block text-xs text-slate-500 mb-0.5">Email</span>
            {result.piEmail ? (
              <span className="text-sm text-teal-400 font-mono break-all">{result.piEmail}</span>
            ) : (
              <span className="text-sm text-amber-400">
                Not found — look up {result.piName ? `${result.piName}'s` : 'their'} university profile or directory
              </span>
            )}
          </div>
        </div>
      </div>

      {result.specificHook && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Key research finding
          </h3>
          <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-4">
            <p className="text-sm text-slate-300 leading-relaxed">{result.specificHook}</p>
          </div>
        </div>
      )}

      {result.bridgeSentence && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Your connection to this lab
          </h3>
          <div className="bg-teal-900/20 rounded-xl border border-teal-800/50 p-4">
            <p className="text-sm text-teal-200 leading-relaxed italic">{result.bridgeSentence}</p>
          </div>
        </div>
      )}

      {showEvidence && (
        <div>
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
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
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Publications used
          </h3>
          <ul className="space-y-2">
            {result.publicationsUsed.map((pub, i) => (
              <li key={i} className="bg-slate-800/60 rounded-lg border border-slate-700 p-3">
                <p className="text-xs text-white leading-snug">{pub.title}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {pub.year && (
                    <span className="text-xs text-slate-500">{pub.year}</span>
                  )}
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                      pub.source === 'pubmed'
                        ? 'bg-blue-900/40 text-blue-300'
                        : 'bg-teal-900/40 text-teal-300'
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
          <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">
            Why the agent wrote it this way
          </h3>
          <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-4">
            <p className="text-sm text-slate-300 leading-relaxed">{result.agentNote}</p>
          </div>
        </div>
      )}
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="block text-xs text-slate-500 mb-0.5">{label}</span>
      <span className="text-sm text-white">{value}</span>
    </div>
  )
}

function EvidenceList({ title, items }: { title: string; items: EvidenceItem[] }) {
  if (items.length === 0) return null
  return (
    <div className="bg-slate-800/60 rounded-xl border border-slate-700 p-3">
      <p className="text-xs text-slate-500 mb-2">{title}</p>
      <ul className="space-y-2">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-slate-300 leading-relaxed">
            <span className="italic">&quot;{item.quote}&quot;</span>
            <span className="block text-slate-500 mt-0.5">
              {item.source}
              {item.note ? ` — ${item.note}` : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
