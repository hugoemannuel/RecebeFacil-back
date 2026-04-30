import { createHmac } from 'crypto';
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from '../auth/dto/register.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findByPhone(phone: string) {
    return this.prisma.user.findUnique({ where: { phone } });
  }

  async findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async getProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, name: true, email: true, phone: true, avatar_url: true },
    });
    if (!user) throw new NotFoundException();
    return user;
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing && existing.id !== userId) {
      throw new ConflictException('Não foi possível atualizar o perfil. Verifique os dados informados.');
    }

    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true },
    });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name, email: dto.email },
      select: { id: true, name: true, email: true, phone: true },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'PROFILE_UPDATED',
        entity: 'User',
        entity_id: userId,
        details: { before, after: { name: dto.name, email: dto.email } },
      },
    });

    return updated;
  }

  async updatePassword(userId: string, dto: UpdatePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.password_hash) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const isMatch = await bcrypt.compare(dto.current_password, user.password_hash);
    if (!isMatch) {
      throw new UnauthorizedException('Credenciais inválidas.');
    }

    const password_hash = await bcrypt.hash(dto.new_password, 12);

    await this.prisma.user.update({ where: { id: userId }, data: { password_hash } });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'PASSWORD_CHANGED',
        entity: 'User',
        entity_id: userId,
      },
    });

    return { message: 'Senha alterada com sucesso.' };
  }

  async deleteAccount(userId: string, ipAddress?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException();

    const salt = process.env.ANON_SALT ?? 'recebefacil_lgpd_anon';
    const hmac = (value: string) => createHmac('sha256', salt).update(value).digest('hex');

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        name: 'Usuário Deletado',
        email: user.email ? `${hmac(user.email)}@deleted.invalid` : null,
        phone: hmac(user.phone),
        password_hash: null,
        is_registered: false,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: null,
        action: 'ACCOUNT_DELETED',
        entity: 'User',
        entity_id: userId,
        details: { reason: 'Self-deletion (LGPD)' },
        ip_address: ipAddress,
      },
    });
  }

  async registerUser(dto: RegisterDto) {
    const existingEmail = await this.findByEmail(dto.email);
    if (existingEmail && existingEmail.is_registered) {
      console.error(`[Auth] Falha no cadastro: E-mail já está em uso (${dto.email})`);
      throw new ConflictException('Não foi possível realizar o cadastro. Verifique os dados informados.');
    }

    const existingPhone = await this.findByPhone(dto.phone);
    if (existingPhone && existingPhone.is_registered) {
      console.error(`[Auth] Falha no cadastro: Telefone já está em uso (${dto.phone})`);
      throw new ConflictException('Não foi possível realizar o cadastro. Verifique os dados informados.');
    }

    const password_hash = await bcrypt.hash(dto.password, 12);

    // Se existe como shadow user pelo e-mail ou telefone, nós atualizamos
    const shadowUser = existingEmail || existingPhone;

    let user;

    if (shadowUser) {
      user = await this.prisma.user.update({
        where: { id: shadowUser.id },
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          password_hash,
          is_registered: true,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          user_id: user.id,
          action: 'USER_REGISTERED_FROM_SHADOW',
          entity: 'User',
          entity_id: user.id,
          details: { 
            previous_state: { email: shadowUser.email, phone: shadowUser.phone },
            new_state: { email: user.email, phone: user.phone }
          }
        }
      });
    } else {
      // Caso não exista de forma alguma, criamos um novo
      user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          password_hash,
          is_registered: true,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          user_id: user.id,
          action: 'USER_REGISTERED_NEW',
          entity: 'User',
          entity_id: user.id,
          details: { email: user.email, phone: user.phone }
        }
      });
    }

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setFullYear(periodEnd.getFullYear() + 10);

    await this.prisma.subscription.upsert({
      where: { user_id: user.id },
      update: {},
      create: {
        user_id: user.id,
        plan_type: 'FREE',
        status: 'ACTIVE',
        current_period_start: now,
        current_period_end: periodEnd,
      },
    });

    return user;
  }
 
  async updateAvatar(userId: string, avatarUrl: string) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { avatar_url: avatarUrl },
      select: { id: true, avatar_url: true },
    });

    await this.prisma.auditLog.create({
      data: {
        user_id: userId,
        action: 'AVATAR_UPDATED',
        entity: 'User',
        entity_id: userId,
      },
    });

    return updated;
  }
}
