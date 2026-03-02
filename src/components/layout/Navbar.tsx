import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, MessageSquare, Database, Briefcase, Settings, Landmark,
  Target, ShoppingCart, Receipt, Presentation, GitBranch, FileText, Shield,
  Menu, X, ChevronDown, ChevronRight,
  Wallet, CreditCard, FileCheck, FolderKanban, BarChart3, Activity,
  Package, PieChart, Wrench, BookOpen,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

interface NavItem { name: string; href: string; icon: React.ComponentType<{ className?: string }> }
interface NavGroup { label: string; items: NavItem[] }

const mainNav: NavItem[] = [
  { name: 'Panel Ejecutivo', href: '/', icon: LayoutDashboard },
  { name: 'Cashflow', href: '/cashflow', icon: Target },
  { name: 'Ingresos / CxC', href: '/ingresos', icon: Receipt },
  { name: 'Crédito', href: '/credito', icon: Landmark },
  { name: 'Compras', href: '/compras', icon: ShoppingCart },
  { name: 'Junta Directiva', href: '/board', icon: Presentation },
  { name: 'AI Chat', href: '/chat', icon: MessageSquare },
];

const dataNav: NavItem[] = [
  { name: 'Fuentes de Datos', href: '/data', icon: Database },
  { name: 'Modelo de Datos', href: '/data-model', icon: GitBranch },
  { name: 'Proyectos', href: '/projects', icon: Briefcase },
  { name: 'ERP Módulos', href: '/erp', icon: FileText },
];

const tmsNav: NavItem[] = [
  { name: 'TMS Hub', href: '/tms', icon: Shield },
  { name: 'Cash Mgmt', href: '/tms/cash', icon: Wallet },
  { name: 'CxP Pagos', href: '/tms/cxp', icon: CreditCard },
  { name: 'CxC Cobros', href: '/tms/cxc', icon: Receipt },
  { name: 'Facturación', href: '/tms/invoicing', icon: FileCheck },
  { name: 'Proyectos', href: '/tms/projects', icon: FolderKanban },
  { name: 'FX & Riesgo', href: '/tms/fx', icon: BarChart3 },
  { name: 'Deuda', href: '/tms/debt', icon: Landmark },
  { name: 'Conciliación', href: '/tms/recon', icon: Activity },
  { name: 'MRP', href: '/tms/mrp', icon: Package },
  { name: 'Board', href: '/tms/board', icon: PieChart },
  { name: 'Admin', href: '/tms/admin', icon: Wrench },
];

const navGroups: NavGroup[] = [
  { label: 'Principal', items: mainNav },
  { label: 'Datos & ERP', items: dataNav },
  { label: 'TMS Módulos', items: tmsNav },
  { label: 'Sistema', items: [
    { name: 'Admin', href: '/admin', icon: Settings },
    { name: 'Glosario', href: '/glossary', icon: BookOpen },
  ] },
];

// Top-bar quick links (desktop only — space-efficient subset)
const topBarNav: NavItem[] = [
  { name: 'Panel', href: '/', icon: LayoutDashboard },
  { name: 'Cashflow', href: '/cashflow', icon: Target },
  { name: 'CxC', href: '/ingresos', icon: Receipt },
  { name: 'Compras', href: '/compras', icon: ShoppingCart },
  { name: 'Chat', href: '/chat', icon: MessageSquare },
  { name: 'TMS', href: '/tms', icon: Shield },
  { name: 'Proyectos', href: '/projects', icon: Briefcase },
];

export function Navbar() {
  const location = useLocation();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null);

  const isActive = (href: string) =>
    href === '/' ? location.pathname === '/' : location.pathname.startsWith(href);

  const toggleGroup = (label: string) =>
    setExpandedGroup(prev => prev === label ? null : label);

  return (
    <>
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14 sm:h-16">
            {/* Left: Logo + hamburger */}
            <div className="flex items-center gap-2">
              {/* Mobile hamburger */}
              <button
                onClick={() => setMobileOpen(true)}
                className="lg:hidden p-2 rounded-md text-gray-600 hover:bg-gray-100"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </button>

              <Link to="/" className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-[#1A4A28] rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm sm:text-lg">ARA</span>
                </div>
                <div className="hidden sm:block">
                  <h1 className="text-lg font-bold text-gray-900 leading-tight">Treasury AI</h1>
                  <p className="text-[10px] text-gray-500 leading-tight">Cashflow Management</p>
                </div>
              </Link>
            </div>

            {/* Center: Desktop quick links */}
            <div className="hidden lg:flex items-center gap-1">
              {topBarNav.map(item => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link key={item.href} to={item.href}
                    className={`inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors ${
                      active ? 'text-[#1A4A28] bg-green-50' : 'text-gray-600 hover:text-[#1A4A28] hover:bg-gray-50'
                    }`}>
                    <Icon className="w-3.5 h-3.5 mr-1.5" />
                    {item.name}
                  </Link>
                );
              })}
              {/* More menu trigger */}
              <button
                onClick={() => setMobileOpen(true)}
                className="inline-flex items-center px-2.5 py-1.5 text-xs font-medium rounded-md text-gray-500 hover:text-[#1A4A28] hover:bg-gray-50"
              >
                <Menu className="w-3.5 h-3.5 mr-1" />Más
              </button>
            </div>

            {/* Right: User */}
            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-medium text-gray-900">{user.full_name}</p>
                <p className="text-[10px] text-gray-500 capitalize">{user.role.replace('_', ' ')}</p>
              </div>
              <div className="sm:hidden w-7 h-7 bg-[#1A4A28] rounded-full flex items-center justify-center">
                <span className="text-white text-[10px] font-bold">{user.full_name.split(' ').map(n => n[0]).join('').slice(0, 2)}</span>
              </div>
            </div>
          </div>
        </div>
      </nav>

      {/* ── Mobile/Full drawer ────────────────────────────────────────── */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/30" onClick={() => setMobileOpen(false)} />
          {/* Drawer */}
          <div className="relative w-72 max-w-[85vw] bg-white shadow-xl overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-[#1A4A28] rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">ARA</span>
                </div>
                <span className="font-bold text-gray-900">Treasury AI</span>
              </div>
              <button onClick={() => setMobileOpen(false)} className="p-1 rounded-md text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-2">
              {navGroups.map(group => {
                const isExpanded = expandedGroup === group.label || group.items.some(i => isActive(i.href));
                return (
                  <div key={group.label}>
                    <button
                      onClick={() => toggleGroup(group.label)}
                      className="w-full flex items-center justify-between px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 hover:text-gray-600"
                    >
                      {group.label}
                      {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                    </button>
                    {isExpanded && (
                      <div className="space-y-0.5 px-2 pb-2">
                        {group.items.map(item => {
                          const Icon = item.icon;
                          const active = isActive(item.href);
                          return (
                            <Link
                              key={item.href}
                              to={item.href}
                              onClick={() => setMobileOpen(false)}
                              className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                                active
                                  ? 'text-[#1A4A28] bg-green-50 font-semibold'
                                  : 'text-gray-700 hover:bg-gray-50 hover:text-[#1A4A28]'
                              }`}
                            >
                              <Icon className="w-4 h-4 flex-shrink-0" />
                              {item.name}
                            </Link>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* User section at bottom */}
            <div className="border-t border-gray-200 px-4 py-3 mt-auto">
              <p className="text-sm font-medium text-gray-900">{user.full_name}</p>
              <p className="text-xs text-gray-500 capitalize">{user.role.replace('_', ' ')}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
