import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanType, MessageTrigger } from '@prisma/client';
import { TEMPLATE_LIMITS, canSaveMoreTemplates } from '../common/plan-modules';

import { SYSTEM_TEMPLATES } from '../common/system-templates';

@Injectable()
export class ProfilesService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    let profile = await this.prisma.creditorProfile.findUnique({
      where: { user_id: userId },
      include: {
        user: {
          include: {
            subscription: true,
          },
        },
      },
    });

    if (!profile) {
      profile = await this.prisma.creditorProfile.create({
        data: { user_id: userId },
        include: {
          user: {
            include: {
              subscription: true,
            },
          },
        },
      });

      // Seed templates para o novo perfil
      await this.seedBaseTemplates(profile.id);
    } else {
      // Garantir que até perfis antigos tenham os templates base se não tiverem nenhum
      const templateCount = await this.prisma.messageTemplate.count({
        where: { creditor_profile_id: profile.id },
      });

      if (templateCount === 0) {
        await this.seedBaseTemplates(profile.id);
      }
    }

    return profile;
  }

  private async seedBaseTemplates(profileId: string) {
    for (const t of SYSTEM_TEMPLATES) {
      await this.prisma.messageTemplate.create({
        data: {
          creditor_profile_id: profileId,
          name: t.name,
          trigger: t.trigger,
          body: t.body,
          is_default: t.is_default,
        },
      });
    }
  }

  async updateProfile(userId: string, dto: any) {
    const updated = await this.prisma.creditorProfile.update({
      where: { user_id: userId },
      data: {
        business_name: dto.business_name,
        document: dto.document,
        pix_key: dto.pix_key,
        pix_key_type: dto.pix_key_type,
        pix_merchant_name: dto.pix_merchant_name,
      },
    });

    // Auditoria
    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'PIX_CONFIG_UPDATED',
        entity: 'CreditorProfile',
        entity_id: userId,
        details: { pix_key: dto.pix_key, pix_key_type: dto.pix_key_type },
      },
    });

    return updated;
  }

  // ==========================================
  // TEMPLATES
  // ==========================================

  async getTemplates(userId: string) {
    const profile = await this.getProfile(userId);
    return this.prisma.messageTemplate.findMany({
      where: { creditor_profile_id: profile.id },
      orderBy: { created_at: 'asc' },
    });
  }

  async createTemplate(userId: string, dto: any) {
    const profile = await this.getProfile(userId);
    const plan: PlanType = profile.user.subscription?.plan_type ?? PlanType.FREE;

    // 1. Validar se o plano permite templates customizados
    if (plan === PlanType.FREE) {
      throw new ForbiddenException('Seu plano (FREE) não permite criar templates personalizados. Faça upgrade!');
    }

    // 2. Validar limite de templates
    const currentCount = await this.prisma.messageTemplate.count({
      where: { creditor_profile_id: profile.id },
    });

    if (!canSaveMoreTemplates(plan, currentCount)) {
      throw new ForbiddenException(`Você atingiu o limite de ${TEMPLATE_LIMITS[plan]} templates para o plano ${plan}.`);
    }

    return this.prisma.messageTemplate.create({
      data: {
        creditor_profile_id: profile.id,
        name: dto.name,
        trigger: dto.trigger || MessageTrigger.MANUAL,
        body: dto.body,
        is_default: dto.is_default ?? false,
      },
    });
  }

  async updateTemplate(userId: string, templateId: string, dto: any) {
    const profile = await this.getProfile(userId);

    // Verifica ownership
    const template = await this.prisma.messageTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template || template.creditor_profile_id !== profile.id) {
      throw new NotFoundException('Template não encontrado.');
    }

    return this.prisma.messageTemplate.update({
      where: { id: templateId },
      data: {
        name: dto.name,
        trigger: dto.trigger,
        body: dto.body,
        is_default: dto.is_default,
      },
    });
  }

  async deleteTemplate(userId: string, templateId: string) {
    const profile = await this.getProfile(userId);

    const template = await this.prisma.messageTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template || template.creditor_profile_id !== profile.id) {
      throw new NotFoundException('Template não encontrado.');
    }

    await this.prisma.messageTemplate.delete({
      where: { id: templateId },
    });

    return { success: true };
  }
}

