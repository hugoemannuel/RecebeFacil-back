import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { MODULE_KEY } from './requires-module.decorator';
import { canAccessModule } from './plan-modules';
import { PlanType } from '@prisma/client';

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredModule = this.reflector.getAllAndOverride<string>(MODULE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Se não há módulo requerido, liberar o acesso
    if (!requiredModule) return true;

    const request = context.switchToHttp().getRequest();
    const userId = request.user?.id;

    if (!userId) {
      throw new ForbiddenException('Usuário não autenticado.');
    }

    // Busca a assinatura ativa do usuário
    const subscription = await this.prisma.subscription.findUnique({
      where: { user_id: userId },
    });

    // Sem assinatura = plano FREE
    const plan: PlanType = subscription?.plan_type ?? PlanType.FREE;

    // Apenas subscriptions ACTIVE liberam acesso (PAST_DUE e CANCELED = FREE)
    const effectivePlan: PlanType =
      subscription?.status === 'ACTIVE' ? plan : PlanType.FREE;

    if (!canAccessModule(effectivePlan, requiredModule)) {
      console.warn(
        `[PlanGuard] Acesso negado: user=${userId} plano=${effectivePlan} módulo=${requiredModule}`,
      );
      throw new ForbiddenException(
        `Seu plano atual (${effectivePlan}) não tem acesso a este módulo. Faça upgrade para continuar.`,
      );
    }

    // Injeta o plano no request para uso nos controllers
    request.userPlan = effectivePlan;

    return true;
  }
}
