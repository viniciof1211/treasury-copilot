import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';

// ── Lazy-loaded pages (code-splitting) ──────────────────────────────────
const Dashboard = lazy(() => import('./pages/Dashboard').then(m => ({ default: m.Dashboard })));
const CashflowDashboard = lazy(() => import('./pages/CashflowDashboard').then(m => ({ default: m.CashflowDashboard })));
const CreditDashboard = lazy(() => import('./pages/CreditDashboard').then(m => ({ default: m.CreditDashboard })));
const ComprasDashboard = lazy(() => import('./pages/ComprasDashboard').then(m => ({ default: m.ComprasDashboard })));
const IngresosDashboard = lazy(() => import('./pages/IngresosDashboard').then(m => ({ default: m.IngresosDashboard })));
const BoardPresentation = lazy(() => import('./pages/BoardPresentation').then(m => ({ default: m.BoardPresentation })));
const Chat = lazy(() => import('./pages/Chat').then(m => ({ default: m.Chat })));
const DataSources = lazy(() => import('./pages/DataSources').then(m => ({ default: m.DataSources })));
const DataModelDashboard = lazy(() => import('./pages/DataModelDashboard').then(m => ({ default: m.DataModelDashboard })));
const ProjectsDashboard = lazy(() => import('./pages/ProjectsDashboard').then(m => ({ default: m.ProjectsDashboard })));
const ERPModulesDashboard = lazy(() => import('./pages/ERPModulesDashboard').then(m => ({ default: m.ERPModulesDashboard })));
const TMSDashboard = lazy(() => import('./pages/TMSDashboard').then(m => ({ default: m.TMSDashboard })));
const CashManagementDashboard = lazy(() => import('./pages/CashManagementDashboard').then(m => ({ default: m.CashManagementDashboard })));
const CxPPaymentsDashboard = lazy(() => import('./pages/CxPPaymentsDashboard').then(m => ({ default: m.CxPPaymentsDashboard })));
const CxCCollectionsDashboard = lazy(() => import('./pages/CxCCollectionsDashboard').then(m => ({ default: m.CxCCollectionsDashboard })));
const InvoicingModuleDashboard = lazy(() => import('./pages/InvoicingModuleDashboard').then(m => ({ default: m.InvoicingModuleDashboard })));
const ProjectFinanceDashboard = lazy(() => import('./pages/ProjectFinanceDashboard').then(m => ({ default: m.ProjectFinanceDashboard })));
const FxRiskDashboard = lazy(() => import('./pages/FxRiskDashboard').then(m => ({ default: m.FxRiskDashboard })));
const DebtManagementDashboard = lazy(() => import('./pages/DebtManagementDashboard').then(m => ({ default: m.DebtManagementDashboard })));
const BankReconDashboard = lazy(() => import('./pages/BankReconDashboard').then(m => ({ default: m.BankReconDashboard })));
const MrpDashboard = lazy(() => import('./pages/MrpDashboard').then(m => ({ default: m.MrpDashboard })));
const BoardReportingDashboard = lazy(() => import('./pages/BoardReportingDashboard').then(m => ({ default: m.BoardReportingDashboard })));
const AdminConfigDashboard = lazy(() => import('./pages/AdminConfigDashboard').then(m => ({ default: m.AdminConfigDashboard })));
const Admin = lazy(() => import('./pages/Admin').then(m => ({ default: m.Admin })));
const Glossary = lazy(() => import('./pages/Glossary').then(m => ({ default: m.Glossary })));

// ── Route loading fallback ──────────────────────────────────────────────
function PageLoader() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="inline-block w-8 h-8 border-4 border-[#1A4A28] border-t-transparent rounded-full animate-spin" />
        <p className="mt-3 text-sm text-gray-500">Cargando módulo…</p>
      </div>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/cashflow" element={<CashflowDashboard />} />
            <Route path="/credito" element={<CreditDashboard />} />
            <Route path="/compras" element={<ComprasDashboard />} />
            <Route path="/ingresos" element={<IngresosDashboard />} />
            <Route path="/board" element={<BoardPresentation />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/data" element={<DataSources />} />
            <Route path="/data-model" element={<DataModelDashboard />} />
            <Route path="/projects" element={<ProjectsDashboard />} />
            <Route path="/erp" element={<ERPModulesDashboard />} />
            <Route path="/tms" element={<TMSDashboard />} />
            <Route path="/tms/cash" element={<CashManagementDashboard />} />
            <Route path="/tms/cxp" element={<CxPPaymentsDashboard />} />
            <Route path="/tms/cxc" element={<CxCCollectionsDashboard />} />
            <Route path="/tms/invoicing" element={<InvoicingModuleDashboard />} />
            <Route path="/tms/projects" element={<ProjectFinanceDashboard />} />
            <Route path="/tms/fx" element={<FxRiskDashboard />} />
            <Route path="/tms/debt" element={<DebtManagementDashboard />} />
            <Route path="/tms/recon" element={<BankReconDashboard />} />
            <Route path="/tms/mrp" element={<MrpDashboard />} />
            <Route path="/tms/board" element={<BoardReportingDashboard />} />
            <Route path="/tms/admin" element={<AdminConfigDashboard />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/glossary" element={<Glossary />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
