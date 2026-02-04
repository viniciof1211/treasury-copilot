# Treasury Cashflow AI Management Agent

A comprehensive corporate treasury management platform with AI-powered cashflow analysis, automated image generation, and multi-tenant support.

## Overview

This platform helps Treasury, Finance, CxC (Accounts Receivable), and CxP (Accounts Payable) teams:

- Analyze cashflow data with natural language queries
- Monitor payables and receivables in real-time
- Project liquidity for 12 months ahead
- Evaluate KPIs and ROI for financial initiatives
- Generate photorealistic consulting-style visualizations using AI
- Track engagement projects and their financial impact

## Key Features

### AI-Powered Chat Interface
- Natural language queries about treasury data
- Automated response generation via Microsoft Foundry Agent
- AI-generated visualizations using Google Gemini
- KPI extraction and display
- Structured table rendering
- Spanish-language image prompts for localized insights

### Executive Dashboard
- Real-time KPI cards (Total Cash, Payables, Receivables, Net Position)
- 6-month cashflow trend charts
- Inflows vs Outflows analysis
- Priority payables tracking
- Receivables aging with overdue alerts

### Data Management
- Multiple data source connectors (Databricks, CSV, API)
- Automated synchronization
- Data source health monitoring
- Manual sync triggers

### Project Tracking
- Engagement project management
- Budget vs Actual cost tracking
- Expected vs Actual ROI
- Project lifecycle management
- Financial impact analysis

### Administration
- User management with role-based access control (RBAC)
- Business unit configuration
- Comprehensive audit logging
- Multi-tenant architecture

## Tech Stack

### Frontend
- React 18 with TypeScript
- Vite for build tooling
- TailwindCSS for styling
- React Router for navigation
- Recharts for data visualization
- Lucide React for icons

### Backend
- Supabase for database and authentication
- Supabase Edge Functions (Deno runtime)
- PostgreSQL with Row Level Security (RLS)

### AI & Integrations
- Microsoft Foundry Agent for conversational AI
- Google Gemini (Nano Banana Pro) for image generation
- Databricks SQL connector

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- Supabase account
- Microsoft Foundry Agent access
- Google Gemini API access

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd treasury-ai
```

2. Install dependencies:
```bash
npm install
```

3. Configure environment variables:
```bash
cp .env.example .env
```

Edit `.env` and add your credentials:
- Supabase URL and Anon Key (already configured)
- Microsoft Foundry Agent credentials
- Google Gemini API key
- Databricks credentials (optional)

### Database Setup

You'll need to set up the database schema. The migration file is available and includes:

**Tables Created:**
- `users` - User accounts with RBAC
- `company_bus` - Business units
- `data_sources` - External data connections
- `cashflow_snapshots` - Point-in-time cashflow positions
- `payables_items` - Accounts payable
- `receivables_items` - Accounts receivable
- `bank_movements` - Bank transactions
- `projections_12m` - 12-month liquidity forecasts
- `engagement_projects` - Project tracking
- `kpi_records` - KPI history
- `chat_conversations` - Chat sessions
- `chat_messages` - Individual messages with AI responses
- `audit_logs` - System audit trail

**Security Features:**
- Row Level Security (RLS) enabled on all tables
- Multi-tenant data isolation by business unit
- Role-based access policies
- Audit logging for all critical operations

### Edge Functions Deployment

The following Edge Functions are ready to deploy once database is configured:

1. **ai-chat** - Handles AI conversations
   - Calls Microsoft Foundry Agent
   - Generates images with Google Gemini
   - Returns structured responses with tables, KPIs, and images

2. **sync-data** - Data synchronization
   - Pulls data from Databricks
   - Updates cashflow snapshots, payables, receivables
   - Logs audit trail

These functions are located in `/supabase/functions/` and will be automatically deployed when the database is ready.

### Running Locally

Development server runs automatically. The application will be available at the local dev URL.

### Building for Production

```bash
npm run build
```

The build output will be in the `dist/` directory, ready for deployment.

## Application Structure

```
src/
├── components/
│   ├── ui/              # Reusable UI components
│   ├── layout/          # Layout components (Navbar, Layout)
│   ├── dashboard/       # Dashboard-specific components
│   ├── chat/            # Chat interface components
│   └── ProtectedRoute.tsx
├── contexts/
│   └── AuthContext.tsx  # Authentication context
├── lib/
│   ├── supabase.ts      # Supabase client
│   └── utils.ts         # Utility functions
├── pages/
│   ├── Login.tsx        # Authentication page
│   ├── Dashboard.tsx    # Executive dashboard
│   ├── Chat.tsx         # AI chat interface
│   ├── DataSources.tsx  # Data source management
│   ├── Projects.tsx     # Project tracking
│   └── Admin.tsx        # Administration panel
├── types/
│   └── index.ts         # TypeScript type definitions
└── App.tsx              # Main application component

supabase/
└── functions/
    ├── ai-chat/         # AI chat Edge Function
    └── sync-data/       # Data sync Edge Function
```

## User Roles

The platform supports four user roles with different permissions:

1. **Admin** - Full system access
   - Manage users and business units
   - Configure data sources
   - Access all data across business units
   - View audit logs

2. **Finance Manager** - Financial operations
   - Manage data sources for their BU
   - Create and edit projects
   - Access financial data
   - Use AI chat

3. **Treasury Analyst** - Data analysis
   - View financial data
   - Use AI chat
   - Generate reports
   - Track projects

4. **Viewer** - Read-only access
   - View dashboards
   - Access reports
   - Limited AI chat usage

## API Integration

### Microsoft Foundry Agent

The AI chat uses Microsoft Foundry Agent for analytical responses.

Expected response format:
```typescript
{
  answer: string,
  tables?: Array<{
    title: string,
    columns: string[],
    rows: (string | number)[][]
  }>,
  kpis?: {
    roi_usd?: number,
    opex_avoided_usd?: number,
    revenue_impact_usd?: number,
    time_to_value_days?: number,
    confidence_0_1?: number
  }
}
```

### Google Gemini Image Generation

Images are generated with Spanish prompts following ARA brand guidelines:
- Color palette: Green #1A4A28, white, light gray, gold accents
- Style: Professional consulting aesthetic (Accenture/Palantir)
- High resolution
- Clear Spanish labels

### Databricks SQL Connector

Connects to Databricks views:
- `v_bank_movements`
- `v_payables`
- `v_receivables`
- `v_cashflow_snapshot`
- `v_projection_12m`

## Security Best Practices

1. **Authentication**: Email/password via Supabase Auth
2. **Authorization**: Row Level Security (RLS) policies
3. **Data Isolation**: Multi-tenant with business unit segregation
4. **API Security**: All AI calls server-side only via Edge Functions
5. **Audit Trail**: Comprehensive logging of all actions
6. **Input Validation**: All user inputs validated
7. **Rate Limiting**: Configured on Edge Functions

## Branding

The platform uses ARA Group branding with CVE certification marks.

**Brand Colors:**
- Primary Green: #1A4A28
- White: #FFFFFF
- Light Gray: Various shades
- Gold accents for emphasis

**Logo Placeholders:**
The application includes placeholders for:
- ARA Group logo
- CVE certification mark
- Aurea Ventures logo
- ECS Solutions logo

## Development Notes

### Demo Mode
The application currently runs in demo mode with mock data when database is not fully configured. Once the database schema is applied, all pages will connect to live data.

### Environment Variables
- Frontend variables must be prefixed with `VITE_`
- Edge Function variables are automatically provided by Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
- Never commit actual credentials to version control

### Image Storage
AI-generated images are stored in Supabase Storage in the `ai-images` bucket. Ensure this bucket exists and has appropriate access policies.

## Deployment

The application is ready for deployment with the following steps:

1. Ensure database schema is applied
2. Deploy Edge Functions (will be automatic once database is ready)
3. Configure environment variables in your hosting platform
4. Build the application: `npm run build`
5. Deploy the `dist/` directory

The platform is optimized for deployment on Vercel or similar platforms.

## Troubleshooting

### Database Connection Issues
- Verify Supabase credentials in `.env`
- Check that Row Level Security policies allow your user
- Ensure business unit assignment for non-admin users

### AI Chat Not Working
- Verify Microsoft Foundry Agent credentials
- Check Google Gemini API key and quota
- Review Edge Function logs in Supabase dashboard

### Data Sync Failures
- Verify Databricks credentials
- Check network connectivity
- Review audit logs for detailed error messages

## Support

For support and questions:
- Check the Supabase dashboard for Edge Function logs
- Review audit logs in the Admin panel
- Verify all environment variables are correctly set

## License

Copyright © 2026 ARA Group. All rights reserved.

---

**Built with** ❤️ **for Treasury and Finance Teams**

Powered by ARA Group • CVE Certified
