import { useState, useEffect } from 'react';
import { Mail, Bell, BellOff, Check, X, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Button } from '../ui/Button';
import { Card, CardContent } from '../ui/Card';

interface Subscription {
  id?: string;
  email: string;
  frequency: 'daily' | 'weekly' | 'immediate';
  min_urgency: 'attention' | 'warning' | 'critical' | 'overdue';
  active: boolean;
  created_at?: string;
}

const FREQUENCY_LABELS: Record<string, string> = {
  immediate: 'Inmediato',
  daily: 'Resumen diario',
  weekly: 'Resumen semanal',
};

const URGENCY_LABELS: Record<string, string> = {
  attention: 'Todas (30d+)',
  warning: 'Urgentes (14d)',
  critical: 'Críticas (7d)',
  overdue: 'Solo vencidas',
};

export function AlertEmailSubscription() {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState('');
  const [frequency, setFrequency] = useState<Subscription['frequency']>('daily');
  const [minUrgency, setMinUrgency] = useState<Subscription['min_urgency']>('warning');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadSubscriptions();
  }, []);

  async function loadSubscriptions() {
    try {
      const { data } = await supabase
        .from('alert_subscriptions')
        .select('*')
        .eq('alert_type', 'project_milestones')
        .order('created_at', { ascending: false });
      if (data) setSubscriptions(data as Subscription[]);
    } catch {
      // Table may not exist yet — that's OK
    }
  }

  async function handleSubscribe(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setMessage({ type: 'error', text: 'Ingrese un correo electrónico válido' });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { error } = await supabase
        .from('alert_subscriptions')
        .upsert({
          email,
          alert_type: 'project_milestones',
          frequency,
          min_urgency: minUrgency,
          active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'email,alert_type' });
      if (error) throw error;
      setMessage({ type: 'success', text: `Suscripción creada para ${email}` });
      setShowForm(false);
      setEmail('');
      await loadSubscriptions();
    } catch (err: any) {
      setMessage({ type: 'error', text: err.message || 'Error al guardar suscripción' });
    } finally {
      setSaving(false);
    }
  }

  async function toggleSubscription(sub: Subscription) {
    try {
      await supabase
        .from('alert_subscriptions')
        .update({ active: !sub.active, updated_at: new Date().toISOString() })
        .eq('id', sub.id);
      await loadSubscriptions();
    } catch {
      // silently fail
    }
  }

  async function deleteSubscription(sub: Subscription) {
    if (!confirm(`¿Eliminar suscripción de ${sub.email}?`)) return;
    try {
      await supabase.from('alert_subscriptions').delete().eq('id', sub.id);
      await loadSubscriptions();
    } catch {
      // silently fail
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mail className="w-4 h-4 text-[#1A4A28]" />
          <h3 className="text-sm font-semibold text-gray-900">Suscripción de Alertas por Email</h3>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowForm(!showForm)}
          className="text-xs"
        >
          <Bell className="w-3.5 h-3.5 mr-1" />
          {showForm ? 'Cancelar' : 'Suscribirse'}
        </Button>
      </div>

      {message && (
        <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
          message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
        }`}>
          {message.type === 'success' ? <Check className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {message.text}
        </div>
      )}

      {showForm && (
        <Card className="border-[#1A4A28]/20">
          <CardContent className="p-4">
            <form onSubmit={handleSubscribe} className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="tesoreria@aragroup.cr"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-[#1A4A28]/20 focus:border-[#1A4A28] outline-none"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Frecuencia</label>
                  <select
                    value={frequency}
                    onChange={e => setFrequency(e.target.value as Subscription['frequency'])}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-[#1A4A28]/20"
                  >
                    {Object.entries(FREQUENCY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Severidad mínima</label>
                  <select
                    value={minUrgency}
                    onChange={e => setMinUrgency(e.target.value as Subscription['min_urgency'])}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:ring-1 focus:ring-[#1A4A28]/20"
                  >
                    {Object.entries(URGENCY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? 'Guardando...' : 'Suscribirse'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {subscriptions.length > 0 && (
        <div className="space-y-1.5">
          {subscriptions.map(sub => (
            <div
              key={sub.id || sub.email}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs border transition-colors ${
                sub.active ? 'bg-green-50 border-green-100' : 'bg-gray-50 border-gray-100 opacity-60'
              }`}
            >
              <div className="flex items-center gap-2">
                {sub.active ? <Bell className="w-3.5 h-3.5 text-green-600" /> : <BellOff className="w-3.5 h-3.5 text-gray-400" />}
                <span className="font-medium text-gray-800">{sub.email}</span>
                <span className="text-gray-500">{FREQUENCY_LABELS[sub.frequency]}</span>
                <span className="text-gray-400">· {URGENCY_LABELS[sub.min_urgency]}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleSubscription(sub)}
                  className="p-1 rounded hover:bg-gray-200 transition-colors"
                  title={sub.active ? 'Pausar' : 'Activar'}
                >
                  {sub.active ? <BellOff className="w-3.5 h-3.5 text-gray-500" /> : <Bell className="w-3.5 h-3.5 text-green-600" />}
                </button>
                <button
                  onClick={() => deleteSubscription(sub)}
                  className="p-1 rounded hover:bg-red-100 transition-colors"
                  title="Eliminar"
                >
                  <X className="w-3.5 h-3.5 text-red-500" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {subscriptions.length === 0 && !showForm && (
        <p className="text-xs text-gray-400 text-center py-2">
          No hay suscripciones activas. Haz clic en "Suscribirse" para recibir alertas por email.
        </p>
      )}
    </div>
  );
}
