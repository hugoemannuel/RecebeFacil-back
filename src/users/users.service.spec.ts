import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConflictException } from '@nestjs/common';
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
});
