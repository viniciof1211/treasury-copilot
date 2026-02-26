import { useState } from 'react';
import { X, Save, FileText, User, MapPin, DollarSign, Calendar, Edit3 } from 'lucide-react';
import { Card, CardContent } from '../ui/Card';
import { Button } from '../ui/Button';
import { formatCurrency, formatDate } from '../../lib/utils';
import { saveCuration } from '../../lib/projects-api';
import type { Contract } from '../../types/projects';

interface ContractDetailProps {
  contract: Contract;
  onClose: () => void;
}

export function ContractDetail({ contract, onClose }: ContractDetailProps) {
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const pctCobrado = contract.monto_contrato
    ? (contract.monto_cancelado / contract.monto_contrato) * 100
    : 0;
  const pctFacturado = contract.monto_contrato
    ? (contract.monto_facturado / contract.monto_contrato) * 100
    : 0;

  const handleSave = async () => {
    if (!Object.keys(editFields).length) return;
    setSaving(true);
    setSaveMsg('');
    try {
      await saveCuration(contract.id, editFields);
      setSaveMsg('Cambios guardados');
      setEditing(false);
      setEditFields({});
    } catch (e: any) {
      setSaveMsg(`Error: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const editableField = (label: string, key: keyof Contract, type: 'text' | 'number' | 'date' = 'text') => {
    const val = contract[key];
    const displayVal = type === 'number' && typeof val === 'number'
      ? formatCurrency(val)
      : type === 'date' && val
        ? formatDate(String(val))
        : String(val || '—');

    return (
      <div className="flex items-center justify-between py-2 border-b border-gray-50">
        <span className="text-xs text-gray-500 font-medium">{label}</span>
        {editing ? (
          <input
            type={type}
            defaultValue={type === 'number' ? String(val || 0) : String(val || '')}
            onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))}
            className="w-48 text-right text-sm border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-[#1A4A28] focus:border-[#1A4A28] outline-none"
          />
        ) : (
          <span className="text-sm font-medium text-gray-900">{displayVal}</span>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-white px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-[#1A4A28]" />
            <div>
              <h2 className="text-lg font-bold text-gray-900 truncate max-w-[400px]">{contract.nombre_proyecto}</h2>
              <p className="text-xs text-gray-500">{contract.proyecto_code} &middot; {contract.empresa}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Button size="sm" variant="primary" onClick={handleSave} disabled={saving}>
                  <Save className="w-3.5 h-3.5 mr-1" />
                  {saving ? 'Guardando...' : 'Guardar'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setEditFields({}); }}>
                  Cancelar
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                <Edit3 className="w-3.5 h-3.5 mr-1" /> Editar
              </Button>
            )}
            <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors">
              <X className="w-5 h-5 text-gray-500" />
            </button>
          </div>
        </div>

        <CardContent className="space-y-6">
          {saveMsg && (
            <div className={`text-xs px-3 py-2 rounded ${saveMsg.startsWith('Error') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
              {saveMsg}
            </div>
          )}

          {/* Progress bars */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600 font-medium">Cobrado</span>
                <span className="font-bold text-[#1A4A28]">{pctCobrado.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-[#1A4A28] h-3 rounded-full transition-all" style={{ width: `${Math.min(pctCobrado, 100)}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                <span>{formatCurrency(contract.monto_cancelado)}</span>
                <span>{formatCurrency(contract.monto_contrato)}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-gray-600 font-medium">Facturado</span>
                <span className="font-bold text-blue-600">{pctFacturado.toFixed(1)}%</span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div className="bg-blue-500 h-3 rounded-full transition-all" style={{ width: `${Math.min(pctFacturado, 100)}%` }} />
              </div>
              <div className="flex justify-between text-[10px] text-gray-500 mt-1">
                <span>{formatCurrency(contract.monto_facturado)}</span>
                <span>{formatCurrency(contract.monto_contrato)}</span>
              </div>
            </div>
          </div>

          {/* Info sections */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" /> Cliente
              </h4>
              {editableField('Nombre', 'nombre_cliente')}
              {editableField('Codigo', 'codigo_cliente')}
              {editableField('Asesores', 'asesores')}
            </div>
            <div>
              <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5" /> Fechas
              </h4>
              {editableField('Inicio', 'fecha_inicial', 'date')}
              {editableField('Cierre', 'fecha_cierre', 'date')}
              {editableField('Adelanto', 'fecha_adelanto', 'date')}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <DollarSign className="w-3.5 h-3.5" /> Financiero
            </h4>
            <div className="grid grid-cols-2 gap-x-6">
              {editableField('Monto Contrato', 'monto_contrato', 'number')}
              {editableField('Monto Cancelado', 'monto_cancelado', 'number')}
              {editableField('Pendiente Cobrar', 'pendiente_cobrar', 'number')}
              {editableField('Monto Facturado', 'monto_facturado', 'number')}
              {editableField('Pendiente Facturar', 'pendiente_facturar', 'number')}
              {editableField('Adelantos', 'adelantos', 'number')}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" /> Clasificacion
            </h4>
            {editableField('Area', 'area')}
            {editableField('Empresa', 'empresa')}
            {editableField('Eurosat', 'eurosat')}
            {editableField('Observaciones', 'observaciones')}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
