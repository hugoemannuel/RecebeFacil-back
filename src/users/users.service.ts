import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from '../auth/dto/register.dto';
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

    return user;
  }
}
