import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: UsersService;
  let jwtService: JwtService;

  const mockUsersService = {
    findByEmail: jest.fn(),
    registerUser: jest.fn(),
  };

  const mockJwtService = {
    sign: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: mockUsersService },
        { provide: JwtService, useValue: mockJwtService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get<UsersService>(UsersService);
    jwtService = module.get<JwtService>(JwtService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('validateUser', () => {
    it('should return user without password if credentials are valid', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        password_hash: 'hashed',
      };
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(true);

      const result = await service.validateUser('test@example.com', 'pass');

      expect(result).toBeDefined();
      expect(result.password_hash).toBeUndefined();
    });

    it('should return null if password is wrong', async () => {
      const mockUser = {
        id: '1',
        email: 'test@example.com',
        password_hash: 'hashed',
      };
      mockUsersService.findByEmail.mockResolvedValueOnce(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValueOnce(false);

      const result = await service.validateUser('test@example.com', 'wrong');

      expect(result).toBeNull();
    });
  });

  describe('login', () => {
    it('should throw UnauthorizedException if validation fails', async () => {
      jest.spyOn(service, 'validateUser').mockResolvedValueOnce(null);

      await expect(service.login({ email: 'e', password: 'p' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return token and user info if login succeeds', async () => {
      const mockUser = { id: '1', name: 'Test', email: 'e', phone: '123' };
      jest.spyOn(service, 'validateUser').mockResolvedValueOnce(mockUser);
      mockJwtService.sign.mockReturnValue('mockToken');

      const result = await service.login({ email: 'e', password: 'p' });

      expect(result.access_token).toBe('mockToken');
      expect(result.user.name).toBe('Test');
    });
  });
});
