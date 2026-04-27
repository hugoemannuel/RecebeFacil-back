import { PlanType } from '@prisma/client';

/**
 * Define quais módulos cada plano tem acesso.
 * Qualquer novo módulo deve ser adicionado aqui primeiro.
 */
export const PLAN_MODULES: Record<PlanType, string[]> = {
  FREE: ['HOME', 'CHARGES'],
  STARTER: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT'],
  PRO: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT'],
  UNLIMITED: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT'],
};

/**
 * Verifica se um plano tem acesso a um módulo específico.
 */
export function canAccessModule(plan: PlanType, module: string): boolean {
  return PLAN_MODULES[plan]?.includes(module) ?? false;
}
