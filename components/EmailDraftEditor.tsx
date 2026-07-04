'use client'

interface Props {
  subject: string
  body: string
  regenerateCount: number
  onSubjectChange: (v: string) => void
  onBodyChange: (v: string) => void
  onRegenerate: () => void
  isRegenerating: boolean
}

export default function EmailDraftEditor({
  subject,
  body,
  regenerateCount,
  onSubjectChange,
  onBodyChange,
  onRegenerate,
  isRegenerating,
}: Props) {
  const wordCount = body.trim() ? body.trim().split(/\s+/).length : 0

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
          Subject
        </label>
        <input
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
          Body
        </label>
        <textarea
          value={body}
          onChange={(e) => onBodyChange(e.target.value)}
          rows={14}
          className="w-full px-3 py-2.5 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 resize-y leading-relaxed"
        />
        <div className="flex justify-between items-center mt-1">
          <span
            className={`text-xs ${
              wordCount < 150 || wordCount > 300
                ? 'text-amber-400'
                : 'text-slate-500'
            }`}
          >
            {wordCount} words {wordCount < 150 ? '(a bit short)' : wordCount > 300 ? '(a bit long)' : ''}
          </span>
          <button
            type="button"
            onClick={onRegenerate}
            disabled={regenerateCount === 0 || isRegenerating}
            className="text-xs text-slate-400 hover:text-teal-400 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors flex items-center gap-1"
          >
            <svg className="w-3 h-3" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.5 8A6.5 6.5 0 0 1 13.49 5H11a.5.5 0 0 0 0 1h4a.5.5 0 0 0 .5-.5V1.5a.5.5 0 0 0-1 0v2.5A7.5 7.5 0 1 0 8 15.5a.5.5 0 0 0 0-1A6.5 6.5 0 0 1 1.5 8z" />
            </svg>
            {isRegenerating
              ? 'Regenerating...'
              : regenerateCount > 0
              ? `Regenerate (${regenerateCount} left)`
              : 'No regenerations left'}
          </button>
        </div>
      </div>
    </div>
  )
}
