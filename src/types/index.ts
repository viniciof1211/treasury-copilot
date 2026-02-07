export type UserRole = 'admin' | 'finance_manager' | 'treasury_analyst' | 'viewer';
export type DataSourceType = 'databricks' | 'csv_upload' | 'api' | 'manual';
export type DataSourceStatus = 'active' | 'inactive' | 'error' | 'syncing';
export type ProjectStatus = 'planning' | 'active' | 'completed' | 'on_hold' | 'cancelled';
export type MessageRole = 'user' | 'assistant' | 'system';

export interface User {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  company_bu_id?: string;
  avatar_url?: string;
  is_active: boolean;
  last_login_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyBU {
  id: string;
  name: string;
  code: string;
  description?: string;
  parent_bu_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface DataSource {
  id: string;
  company_bu_id: string;
  name: string;
  type: DataSourceType;
  status: DataSourceStatus;
  config: Record<string, unknown>;
  last_sync_at?: string;
  last_sync_status?: string;
  sync_frequency_minutes?: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface CashflowSnapshot {
  id: string;
  company_bu_id: string;
  data_source_id?: string;
  snapshot_date: string;
  total_cash: number;
  total_payables: number;
  total_receivables: number;
  net_position: number;
  currency_code: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface PayablesItem {
  id: string;
  company_bu_id: string;
  data_source_id?: string;
  vendor_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  currency_code: string;
  status: string;
  payment_terms?: string;
  priority: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ReceivablesItem {
  id: string;
  company_bu_id: string;
  data_source_id?: string;
  customer_name: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  amount: number;
  currency_code: string;
  status: string;
  payment_terms?: string;
  days_overdue: number;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface BankMovement {
  id: string;
  company_bu_id: string;
  data_source_id?: string;
  transaction_date: string;
  value_date: string;
  description: string;
  amount: number;
  balance_after?: number;
  currency_code: string;
  account_number?: string;
  transaction_type?: string;
  reference_number?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface Projection12M {
  id: string;
  company_bu_id: string;
  projection_month: string;
  projected_inflows: number;
  projected_outflows: number;
  projected_balance: number;
  confidence_score?: number;
  assumptions?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface EngagementProject {
  id: string;
  company_bu_id: string;
  name: string;
  description?: string;
  status: ProjectStatus;
  start_date?: string;
  end_date?: string;
  budget_amount?: number;
  actual_cost: number;
  expected_roi_usd?: number;
  actual_roi_usd?: number;
  owner_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface KPIRecord {
  id: string;
  company_bu_id: string;
  engagement_project_id?: string;
  recorded_date: string;
  roi_usd?: number;
  opex_avoided_usd?: number;
  revenue_impact_usd?: number;
  time_to_value_days?: number;
  confidence_score?: number;
  kpi_data: Record<string, unknown>;
  created_at: string;
}

export interface ChatConversation {
  id: string;
  user_id: string;
  company_bu_id: string;
  title?: string;
  context_data?: Record<string, unknown>;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface ExtractedTable {
  title: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface KPIData {
  roi_usd?: number;
  opex_avoided_usd?: number;
  revenue_impact_usd?: number;
  time_to_value_days?: number;
  confidence_0_1?: number;
}

export interface GeneratedImage {
  promptUsed: string;
  imageUrl: string;
  altText: string;
}

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  extracted_tables?: ExtractedTable[];
  kpis?: KPIData;
  image_url?: string;
  image_prompt?: string;
  image_alt_text?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export interface IngestRun {
  id: string;
  source_file: string;
  source_sheet?: string;
  file_bucket?: string;
  file_path?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  rows_inserted: number;
  error_message?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  completed_at?: string;
}

export interface AuditLog {
  id: string;
  user_id?: string;
  company_bu_id?: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  changes?: Record<string, unknown>;
  ip_address?: string;
  user_agent?: string;
  created_at: string;
}

export interface AIResponse {
  conversationId: string;
  answerMarkdown: string;
  extractedTables?: ExtractedTable[];
  kpis?: KPIData;
  image?: GeneratedImage;
}

export interface DashboardMetrics {
  totalCash: number;
  totalPayables: number;
  totalReceivables: number;
  netPosition: number;
  cashTrend: number;
  payablesDue30Days: number;
  receivablesOverdue: number;
  projectedLiquidity: number;
}
