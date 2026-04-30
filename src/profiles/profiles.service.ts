import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ProfilesService {
  constructor(private prisma: PrismaService) {}

  async getProfile(userId: string) {
    let profile = await this.prisma.creditorProfile.findUnique({
      where: { user_id: userId },
    });

    if (!profile) {
      profile = await this.prisma.creditorProfile.create({
        data: { user_id: userId },
      });
    }

    return profile;
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
}
