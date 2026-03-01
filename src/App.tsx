import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { Dashboard } from './pages/Dashboard';
import { CashflowDashboard } from './pages/CashflowDashboard';
import { CreditDashboard } from './pages/CreditDashboard';
import { ComprasDashboard } from './pages/ComprasDashboard';
import { IngresosDashboard } from './pages/IngresosDashboard';
import { BoardPresentation } from './pages/BoardPresentation';
import { Chat } from './pages/Chat';
import { DataSources } from './pages/DataSources';
import { DataModelDashboard } from './pages/DataModelDashboard';
import { ProjectsDashboard } from './pages/ProjectsDashboard';
import { ERPModulesDashboard } from './pages/ERPModulesDashboard';
import { TMSDashboard } from './pages/TMSDashboard';
import { CashManagementDashboard } from './pages/CashManagementDashboard';
import { CxPPaymentsDashboard } from './pages/CxPPaymentsDashboard';
import { CxCCollectionsDashboard } from './pages/CxCCollectionsDashboard';
import { InvoicingModuleDashboard } from './pages/InvoicingModuleDashboard';
import { ProjectFinanceDashboard } from './pages/ProjectFinanceDashboard';
import { FxRiskDashboard } from './pages/FxRiskDashboard';
import { DebtManagementDashboard } from './pages/DebtManagementDashboard';
import { BankReconDashboard } from './pages/BankReconDashboard';
import { MrpDashboard } from './pages/MrpDashboard';
import { BoardReportingDashboard } from './pages/BoardReportingDashboard';
import { AdminConfigDashboard } from './pages/AdminConfigDashboard';
import { Admin } from './pages/Admin';
import { ensureStorageBuckets } from './lib/supabase';

function App() {
  useEffect(() => {
    ensureStorageBuckets();
  }, []);

  return (
    <AuthProvider>
      <BrowserRouter>
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
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
