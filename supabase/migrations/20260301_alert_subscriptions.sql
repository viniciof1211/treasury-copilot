-- Alert email subscriptions for project milestone alerts and other alert types
CREATE TABLE IF NOT EXISTS public.alert_subscriptions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  email text NOT NULL,
  alert_type text NOT NULL DEFAULT 'project_milestones',
  frequency text NOT NULL DEFAULT 'daily' CHECK (frequency IN ('immediate', 'daily', 'weekly')),
  min_urgency text NOT NULL DEFAULT 'warning' CHECK (min_urgency IN ('attention', 'warning', 'critical', 'overdue')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (email, alert_type)
);

-- RLS: allow authenticated users to manage subscriptions
ALTER TABLE public.alert_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read subscriptions" ON public.alert_subscriptions FOR SELECT USING (true);
CREATE POLICY "Anyone can insert subscriptions" ON public.alert_subscriptions FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update subscriptions" ON public.alert_subscriptions FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete subscriptions" ON public.alert_subscriptions FOR DELETE USING (true);
