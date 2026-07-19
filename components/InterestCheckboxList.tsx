'use client'

import { useState } from 'react'

const INTERESTS = [
  'Biochemistry',
  'Bioengineering / Synthetic Biology',
  'Bioinformatics / Computational Biology',
  'Biophysics',
  'Drug Development / Pharmacology',
  'Genetics & Genomics',
  'Gut Microbiome',
  'Immunology',
  'Microbiology / Virology',
  'Molecular & Cell Biology',
  'Neuroscience',
  'Oncology / Cancer Biology',
  'Public Health / Epidemiology',
  'Translational Medicine',
]

interface Props {
  value: string[]
  otherValue: string
  onChange: (interests: string[]) => void
  onOtherChange: (other: string) => void
}

export default function InterestCheckboxList({ value, otherValue, onChange, onOtherChange }: Props) {
  const [showOther, setShowOther] = useState(!!otherValue)

  function toggle(interest: string) {
    onChange(
      value.includes(interest) ? value.filter((i) => i !== interest) : [...value, interest],
    )
  }

  return (
    <div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {INTERESTS.map((interest) => {
          const checked = value.includes(interest)
          return (
            <label
              key={interest}
              className={`flex items-center gap-2.5 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
                checked
                  ? 'border-pine bg-pine-wash text-ink'
                  : 'border-line bg-surface text-ink-soft hover:border-ink-faint hover:text-ink'
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => toggle(interest)}
                className="w-4 h-4 rounded border-line accent-pine"
              />
              <span>{interest}</span>
            </label>
          )
        })}

        <label
          className={`flex items-center gap-2.5 cursor-pointer rounded-md border px-3 py-2 text-sm transition-colors ${
            showOther
              ? 'border-pine bg-pine-wash text-ink'
              : 'border-line bg-surface text-ink-soft hover:border-ink-faint hover:text-ink'
          }`}
        >
          <input
            type="checkbox"
            checked={showOther}
            onChange={(e) => {
              setShowOther(e.target.checked)
              if (!e.target.checked) onOtherChange('')
            }}
            className="w-4 h-4 rounded border-line accent-pine"
          />
          <span>Other</span>
        </label>
      </div>

      {showOther && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Describe your interest..."
          className="mt-3 w-full px-3 py-2 bg-surface border border-line rounded-md text-ink placeholder:text-ink-faint text-sm focus:outline-none focus:border-pine focus:ring-1 focus:ring-pine"
        />
      )}
    </div>
  )
}
