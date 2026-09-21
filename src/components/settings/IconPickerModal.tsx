import {
  secondaryBtnCls,
  inputCls,
  ghostBtnCls,
} from '@/components/settings/settings-utils'
import type { IconCatalogItem } from '@/utils/iconResolver'

export default function IconPickerModal({
  open,
  iconQuery,
  onQueryChange,
  filteredIcons,
  onSelect,
  onClose,
}: {
  open: boolean
  iconQuery: string
  onQueryChange: (value: string) => void
  filteredIcons: IconCatalogItem[]
  onSelect: (iconCode: string) => void
  onClose: () => void
}) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgba(24,20,18,0.46)] p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl rounded-[1.9rem] border border-pp-line bg-[linear-gradient(180deg,rgba(255,255,255,0.88),rgba(255,250,246,0.8))] p-4 shadow-panel backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-xl font-semibold tracking-tight text-pp-text">
              Select icon
            </h3>
            <p className="text-xs leading-relaxed text-pp-muted">
              Selected icon code will be saved (e.g. `fa:FaReact`).
            </p>
          </div>
          <button
            type="button"
            className={ghostBtnCls}
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <input
          className={`${inputCls} mb-3`}
          value={iconQuery}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="Search by icon name or code..."
        />

        <div className="grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          {filteredIcons.map(item => (
            <button
              key={item.code}
              type="button"
              className={`${secondaryBtnCls} bg-white/82 flex items-center gap-2 rounded-[1rem] px-3 py-3 text-left hover:border-pp-blue/35`}
              onClick={() => onSelect(item.code)}
              title={item.code}
            >
              <item.Component
                size={18}
                className="shrink-0 text-pp-text"
              />
              <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-pp-muted">
                {item.name}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
