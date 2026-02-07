# Treasury Process Summary (from doc/)

Resumen de procesos CxC y CxP extraídos de CxC y Facturación.docx y CxP.docx para el Cashflow Agent.

## CxC (Cuentas por Cobrar)

- **Facturación**: Proforma en PCGraf → factura electrónica (Almamater), validación Hacienda, CABYS obligatorio
- **Cobro**: 4 áreas comerciales, cada una con gestor. Cartera se pasa por semana según vencimiento
- **Categorías**: Normal (no vencido), Cartera morosa (1-1000 días vencido), Adelanto proyectos
- **Tesorería**: Conciliación con PCGraf, estados bancarios diarios. Recibos aplican a facturas
- **Notas de crédito**: Retenciones, devoluciones, diferenciales cambiarios (viajan a Hacienda); internas intercompany
- **Data**: Depurar +90 días en batch; 60 días en tiempo real

## CxP (Cuentas por Pagar)

- **Hacienda/Almamater**: Todas las facturas proveedores. Cada BU acepta facturas en el sistema
- **Órdenes de compra**: Módulos complementarios → PCGraf
- **SharePoint**: Factura + OC para aprobación gerencia
- **CxP → Tesorería**: Agrega a Excel Flujos, envía por correo. Compra define prioridades
- **BUs**: Euromobilia, Paneltech, Multiclamp (+ 1)
- **Tarjetas crédito**: Gastos como proveedor banco, mismo flujo CxP
- **Caja chica**: App aparte, liquidación viáticos, visto bueno gerencia → tesorería
- **Comisiones**: Gerencia envía a contaduría (martes/miércoles), cálculo manual, nómina → tesorería
- **Importaciones**: Excel manual, aranceles, carpeta compartida

## Estructura Excel GV CXP Totales

| Columna | Descripción |
|---------|-------------|
| Empresa | Euromobilia, Paneltech, Multiclamp |
| Negocio | Logística Espacial, Productividad Humana, etc. |
| Responsable | Gestor (Eitan R, Uri R, etc.) |
| Vencimiento Fecha | Excel serial |
| Prioridad | "1 URGE", "1", "No Proceder...", etc. |
| Monto en $ | USD |
| Proveedor | Nombre |
| Detalle | Descripción del pago |
| Clasificación | Gastos Locales, Racks, etc. |

## Flujo Semanal Operaciones

- Compañía, Tipo (Largo Plazo, Capital Trabajo), Operación bancaria, Vencimiento
- Saldo original, Principal, Intereses, Cuota, Capital, Capital actualizado
- Moneda (Colones, Dólares), Banco
