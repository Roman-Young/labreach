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
        {INTERESTS.map((interest) => (
          <label
            key={interest}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={value.includes(interest)}
              onChange={() => toggle(interest)}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500 focus:ring-offset-slate-900"
            />
            <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
              {interest}
            </span>
          </label>
        ))}

        <label className="flex items-center gap-2 cursor-pointer group">
          <input
            type="checkbox"
            checked={showOther}
            onChange={(e) => {
              setShowOther(e.target.checked)
              if (!e.target.checked) onOtherChange('')
            }}
            className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-teal-500 focus:ring-teal-500 focus:ring-offset-slate-900"
          />
          <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
            Other
          </span>
        </label>
      </div>

      {showOther && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Describe your interest..."
          className="mt-3 w-full px-3 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-500 text-sm focus:outline-none focus:border-teal-500"
        />
      )}
    </div>
  )
}
