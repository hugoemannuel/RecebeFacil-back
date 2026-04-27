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
      throw new ConflictException('E-mail já está em uso.');
    }

    const existingPhone = await this.findByPhone(dto.phone);
    if (existingPhone && existingPhone.is_registered) {
      throw new ConflictException('Telefone já está em uso.');
    }

    const password_hash = await bcrypt.hash(dto.password, 12);

    // Se existe como shadow user pelo e-mail ou telefone, nós atualizamos
    const shadowUser = existingEmail || existingPhone;

    if (shadowUser) {
      return this.prisma.user.update({
        where: { id: shadowUser.id },
        data: {
          name: dto.name,
          email: dto.email,
          phone: dto.phone,
          password_hash,
          is_registered: true,
        },
      });
    }

    // Caso não exista de forma alguma, criamos um novo
    return this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        phone: dto.phone,
        password_hash,
        is_registered: true,
      },
    });
  }
}
