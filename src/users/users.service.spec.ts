import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

describe('UsersService', () => {
  let service: UsersService;
  let prismaService: PrismaService;

  const mockPrismaService = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
    prismaService = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('registerUser', () => {
    const registerDto = {
      name: 'Test User',
      email: 'test@example.com',
      phone: '5511999999999',
      password: 'password123',
    };

    it('should throw ConflictException if email is already fully registered', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: registerDto.email,
        is_registered: true,
      });

      await expect(service.registerUser(registerDto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('should update user if shadow user exists (is_registered = false)', async () => {
      // first call is findByEmail
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: '1',
        email: registerDto.email,
        is_registered: false,
      });

      mockPrismaService.user.update.mockResolvedValueOnce({
        id: '1',
        ...registerDto,
        password_hash: 'hashed',
        is_registered: true,
      });

      // bcrypt hash is mocked implicitly or not, but it's fine
      const result = await service.registerUser(registerDto);

      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(result.is_registered).toBe(true);
    });

    it('should create a new user if not exists', async () => {
      mockPrismaService.user.findUnique.mockResolvedValue(null);

      mockPrismaService.user.create.mockResolvedValueOnce({
        id: '2',
        ...registerDto,
        password_hash: 'hashed',
        is_registered: true,
      });

      const result = await service.registerUser(registerDto);

      expect(mockPrismaService.user.create).toHaveBeenCalled();
      expect(result.is_registered).toBe(true);
    });
  });

  describe('getProfile', () => {
    it('should return user fields without password_hash', async () => {
      const profile = { id: '1', name: 'Test', email: 'test@example.com', phone: '5511999999999' };
      mockPrismaService.user.findUnique.mockResolvedValueOnce(profile);
      const result = await service.getProfile('1');
      expect(result).toEqual(profile);
      expect(result).not.toHaveProperty('password_hash');
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.getProfile('unknown')).rejects.toThrow(NotFoundException);
    });
  });

  describe('updateProfile', () => {
    const updated = { id: '1', name: 'New Name', email: 'new@example.com', phone: '5511999999999' };

    it('should update and return profile', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      mockPrismaService.user.update.mockResolvedValueOnce(updated);
      const result = await service.updateProfile('1', { name: 'New Name', email: 'new@example.com' });
      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(result).toEqual(updated);
    });

    it('should allow updating to the same email', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: '1', email: 'same@example.com' });
      mockPrismaService.user.update.mockResolvedValueOnce(updated);
      await expect(service.updateProfile('1', { name: 'Name', email: 'same@example.com' })).resolves.not.toThrow();
    });

    it('should throw ConflictException if email belongs to another user', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: 'other-user', email: 'taken@example.com' });
      await expect(service.updateProfile('1', { name: 'Name', email: 'taken@example.com' })).rejects.toThrow(ConflictException);
    });
  });

  describe('updatePassword', () => {
    it('should update password and create auditLog', async () => {
      const hash = await bcrypt.hash('old-password', 10);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: '1', password_hash: hash });
      mockPrismaService.user.update.mockResolvedValueOnce({});
      mockPrismaService.auditLog.create.mockResolvedValueOnce({});

      const result = await service.updatePassword('1', { current_password: 'old-password', new_password: 'new-password-123' });

      expect(mockPrismaService.user.update).toHaveBeenCalled();
      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ action: 'PASSWORD_CHANGED' }) }),
      );
      expect(result).toEqual({ message: 'Senha alterada com sucesso.' });
    });

    it('should throw UnauthorizedException if current password is wrong', async () => {
      const hash = await bcrypt.hash('correct-password', 10);
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: '1', password_hash: hash });
      await expect(service.updatePassword('1', { current_password: 'wrong', new_password: 'new12345' })).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException if user has no password_hash', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({ id: '1', password_hash: null });
      await expect(service.updatePassword('1', { current_password: 'any', new_password: 'new12345' })).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('deleteAccount', () => {
    it('should anonymize PII and create auditLog with null user_id', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce({
        id: '1',
        name: 'Test User',
        email: 'test@example.com',
        phone: '5511999999999',
      });
      mockPrismaService.user.update.mockResolvedValueOnce({});
      mockPrismaService.auditLog.create.mockResolvedValueOnce({});

      await service.deleteAccount('1', '192.168.0.1');

      const updateCall = mockPrismaService.user.update.mock.calls[0][0];
      expect(updateCall.data.name).toBe('Usuário Deletado');
      expect(updateCall.data.password_hash).toBeNull();
      expect(updateCall.data.is_registered).toBe(false);
      expect(updateCall.data.email).toContain('@deleted.invalid');
      expect(updateCall.data.phone).not.toBe('5511999999999');

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user_id: null,
            action: 'ACCOUNT_DELETED',
            entity_id: '1',
            ip_address: '192.168.0.1',
          }),
        }),
      );
    });

    it('should throw NotFoundException if user not found', async () => {
      mockPrismaService.user.findUnique.mockResolvedValueOnce(null);
      await expect(service.deleteAccount('unknown')).rejects.toThrow(NotFoundException);
    });
  });
});
