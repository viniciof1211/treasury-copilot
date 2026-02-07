import { Layout } from '../components/layout/Layout';
import { CopilotChat } from '@copilotkit/react-ui';

const TREASURY_INSTRUCTIONS = `You are an AI Treasury Agent for a cashflow management application. Help users with:
- Cash position and projections
- Payables due and priority payments
- Receivables aging and overdue accounts
- ROI analysis for projects
- Financial insights and recommendations

Be concise and professional. When discussing numbers, use clear formatting (e.g., $1.2M, +5.3%).`;

export function Chat() {
  return (
    <Layout>
      <div className="h-[calc(100vh-12rem)] flex flex-col">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">AI Treasury Agent</h1>
          <p className="text-gray-600 mt-1">
            Ask questions about your cashflow, payables, receivables, and financial projections
          </p>
        </div>

        <div className="flex-1 min-h-0 rounded-xl overflow-hidden border border-gray-200 bg-white">
          <CopilotChat
            instructions={TREASURY_INSTRUCTIONS}
            labels={{
              title: 'Treasury AI',
              initial: 'Ask about cash position, payables, receivables, or project ROI...',
            }}
            className="h-full"
          />
        </div>
      </div>
    </Layout>
  );
}
