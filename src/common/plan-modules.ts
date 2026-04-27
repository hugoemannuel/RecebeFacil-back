import { PlanType } from '@prisma/client';

/**
 * Define quais módulos cada plano tem acesso.
 * Qualquer novo módulo deve ser adicionado aqui primeiro.
 *
 * CUSTOM_TEMPLATES: Salvar templates de mensagem personalizados no banco.
 *   - FREE: Não pode salvar. Usa apenas o template padrão do sistema (read-only).
 *   - STARTER+: Pode salvar e editar templates customizados (limite por plano aplicado no service).
 */
export const PLAN_MODULES: Record<PlanType, string[]> = {
  FREE:      ['HOME', 'CHARGES'],
  STARTER:   ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  PRO:       ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
  UNLIMITED: ['HOME', 'CHARGES', 'CLIENTS', 'REPORTS', 'EXCEL_IMPORT', 'CUSTOM_TEMPLATES'],
};

/**
 * Limites de templates salvos por plano.
 * O MessageTemplateService deve validar contra este mapa.
 * null = ilimitado.
 */
export const TEMPLATE_LIMITS: Record<PlanType, number | null> = {
  FREE:      0,    // Não pode salvar nenhum template customizado
  STARTER:   3,    // Máx 3 templates no total
  PRO:       null, // Ilimitado
  UNLIMITED: null, // Ilimitado
};

/**
 * Verifica se um plano tem acesso a um módulo específico.
 */
export function canAccessModule(plan: PlanType, module: string): boolean {
  return PLAN_MODULES[plan]?.includes(module) ?? false;
}

/**
 * Verifica se um plano pode salvar mais templates dado o total atual.
 */
export function canSaveMoreTemplates(plan: PlanType, currentCount: number): boolean {
  const limit = TEMPLATE_LIMITS[plan];
  if (limit === null) return true;
  return currentCount < limit;
}
