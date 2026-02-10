import { useState, useEffect, useCallback } from 'react';
import { X, Save, Pencil, Eye, Loader2, Check, AlertTriangle } from 'lucide-react';
import { Badge } from './Badge';
import { supabase } from '../../lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export interface FieldDef {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'currency' | 'select' | 'readonly';
  options?: string[];            // for select type
  group?: string;                // section grouping label
  suffix?: string;               // e.g. "días", "USD", "%"
  highlight?: boolean;           // visually emphasize this field
  format?: (val: unknown) => string; // custom display formatter
}

export interface RecordDetailModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  record: Record<string, unknown> | null;
  fields: FieldDef[];
  /** Supabase schema (e.g. 'silver_finance', 'bronze_finance') */
  schema?: string;
  /** Table name to update (e.g. 'cxp_items', 'mrp_master') */
  table?: string;
  /** Primary key column name (default: 'id') */
  pkColumn?: string;
  /** Callback after successful save */
  onSaved?: () => void;
  /** If false, edit mode is disabled entirely */
  editable?: boolean;
}

// ── Component ────────────────────────────────────────────────────────────────

export function RecordDetailModal({
  open,
  onClose,
  title,
  subtitle,
  record,
  fields,
  schema = 'silver_finance',
  table,
  pkColumn = 'id',
  onSaved,
  editable = true,
}: RecordDetailModalProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Reset state when record changes
  useEffect(() => {
    if (record) {
      setDraft({ ...record });
      setEditing(false);
      setSaveError(null);
      setSaveSuccess(false);
    }
  }, [record]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  const handleFieldChange = useCallback((key: string, value: unknown) => {
    setDraft(prev => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
    setSaveError(null);
  }, []);

  const handleSave = useCallback(async () => {
    if (!table || !record) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Build the update payload — only include editable changed fields
      const editableFields = fields.filter(f => f.type !== 'readonly');
      const updates: Record<string, unknown> = {};
      let changed = false;
      for (const f of editableFields) {
        if (draft[f.key] !== record[f.key]) {
          updates[f.key] = draft[f.key];
          changed = true;
        }
      }
      if (!changed) {
        setEditing(false);
        return;
      }

      const pk = record[pkColumn];
      const { error } = await supabase
        .schema(schema as 'public')
        .from(table)
        .update(updates)
        .eq(pkColumn, pk);

      if (error) throw new Error(error.message);
      setSaveSuccess(true);
      setTimeout(() => {
        setEditing(false);
        onSaved?.();
      }, 800);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }, [table, record, fields, draft, pkColumn, schema, onSaved]);

  if (!open || !record) return null;

  // Group fields by section
  const groups: { label: string; fields: FieldDef[] }[] = [];
  let currentGroup = '';
  for (const f of fields) {
    const g = f.group || '';
    if (g !== currentGroup) {
      currentGroup = g;
      groups.push({ label: g, fields: [] });
    }
    if (groups.length === 0) groups.push({ label: '', fields: [] });
    groups[groups.length - 1].fields.push(f);
  }

  const renderValue = (f: FieldDef) => {
    const raw = editing ? draft[f.key] : record[f.key];
    if (editing && f.type !== 'readonly') {
      if (f.type === 'select' && f.options) {
        return (
          <select
            value={String(raw ?? '')}
            onChange={e => handleFieldChange(f.key, e.target.value)}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#1A4A28] focus:border-[#1A4A28]"
          >
            <option value="">—</option>
            {f.options.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        );
      }
      if (f.type === 'number' || f.type === 'currency') {
        return (
          <div className="flex items-center gap-1">
            <input
              type="number"
              step="any"
              value={raw != null ? String(raw) : ''}
              onChange={e => handleFieldChange(f.key, e.target.value === '' ? null : Number(e.target.value))}
              className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm font-mono focus:ring-2 focus:ring-[#1A4A28] focus:border-[#1A4A28]"
            />
            {f.suffix && <span className="text-xs text-gray-400 flex-shrink-0">{f.suffix}</span>}
          </div>
        );
      }
      if (f.type === 'date') {
        const dateVal = raw ? String(raw).slice(0, 10) : '';
        return (
          <input
            type="date"
            value={dateVal}
            onChange={e => handleFieldChange(f.key, e.target.value)}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#1A4A28] focus:border-[#1A4A28]"
          />
        );
      }
      // Default: text
      return (
        <div className="flex items-center gap-1">
          <input
            type="text"
            value={raw != null ? String(raw) : ''}
            onChange={e => handleFieldChange(f.key, e.target.value)}
            className="w-full border border-gray-300 rounded-md px-2 py-1.5 text-sm focus:ring-2 focus:ring-[#1A4A28] focus:border-[#1A4A28]"
          />
          {f.suffix && <span className="text-xs text-gray-400 flex-shrink-0">{f.suffix}</span>}
        </div>
      );
    }
    // Read-only display
    if (f.format) return <span className="text-sm">{f.format(raw)}</span>;
    if (raw == null || raw === '') return <span className="text-sm text-gray-300">—</span>;
    if (f.type === 'currency') {
      return (
        <span className="text-sm font-mono font-semibold">
          {typeof raw === 'number' ? raw.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : String(raw)}
          {f.suffix && <span className="text-gray-400 ml-1">{f.suffix}</span>}
        </span>
      );
    }
    if (f.type === 'number') {
      return (
        <span className="text-sm font-mono">
          {typeof raw === 'number' ? raw.toLocaleString('es-CR') : String(raw)}
          {f.suffix && <span className="text-gray-400 ml-1">{f.suffix}</span>}
        </span>
      );
    }
    if (f.type === 'date') {
      const d = new Date(String(raw));
      const isValid = !isNaN(d.getTime());
      return <span className="text-sm">{isValid ? d.toLocaleDateString('es-CR') : String(raw)}</span>;
    }
    return (
      <span className="text-sm">
        {String(raw)}
        {f.suffix && <span className="text-gray-400 ml-1">{f.suffix}</span>}
      </span>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 flex-shrink-0">
          <div>
            <h2 className="text-lg font-bold text-gray-900">{title}</h2>
            {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {editable && table && (
              <button
                onClick={() => {
                  if (editing) {
                    setDraft({ ...record });
                    setEditing(false);
                    setSaveError(null);
                  } else {
                    setEditing(true);
                  }
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  editing
                    ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    : 'bg-[#1A4A28] text-white hover:bg-[#2D6A3F]'
                }`}
              >
                {editing ? <Eye className="w-4 h-4" /> : <Pencil className="w-4 h-4" />}
                {editing ? 'Cancelar' : 'Editar'}
              </button>
            )}
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {groups.map((group, gi) => (
            <div key={gi} className="mb-5">
              {group.label && (
                <h3 className="text-sm font-bold text-[#1A4A28] uppercase tracking-wider mb-3 pb-1 border-b border-[#1A4A28]/20">
                  {group.label}
                </h3>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-3">
                {group.fields.map(f => (
                  <div
                    key={f.key}
                    className={`${f.highlight ? 'md:col-span-2 bg-green-50/50 rounded-lg p-2 -mx-2' : ''}`}
                  >
                    <label className="block text-xs font-medium text-gray-500 mb-0.5">
                      {f.label}
                      {f.type === 'readonly' && editing && (
                        <Badge variant="default" className="ml-2 text-[10px]">Solo lectura</Badge>
                      )}
                    </label>
                    {renderValue(f)}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer — only shown when editing */}
        {editing && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 bg-gray-50 rounded-b-2xl flex-shrink-0">
            <div className="flex items-center gap-2 text-sm">
              {saveError && (
                <span className="text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-4 h-4" /> {saveError}
                </span>
              )}
              {saveSuccess && (
                <span className="text-green-600 flex items-center gap-1">
                  <Check className="w-4 h-4" /> Guardado exitosamente
                </span>
              )}
            </div>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-[#1A4A28] text-white rounded-lg text-sm font-medium hover:bg-[#2D6A3F] disabled:opacity-50 transition-colors"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              Guardar Cambios
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
