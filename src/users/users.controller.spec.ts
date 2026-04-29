import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController', () => {
  let controller: UsersController;
  let service: UsersService;

  const mockUsersService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updatePassword: jest.fn(),
    deleteAccount: jest.fn(),
  };

  const mockUser = { id: 'user-1', name: 'Test User', email: 'test@example.com', phone: '5511999999999' };
  const mockReq = { user: { id: 'user-1' }, ip: '127.0.0.1' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [{ provide: UsersService, useValue: mockUsersService }],
    }).compile();

    controller = module.get<UsersController>(UsersController);
    service = module.get<UsersService>(UsersService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('GET /users/me', () => {
    it('should return profile from service', async () => {
      mockUsersService.getProfile.mockResolvedValue(mockUser);
      const result = await controller.getProfile(mockReq);
      expect(service.getProfile).toHaveBeenCalledWith('user-1');
      expect(result).toEqual(mockUser);
    });
  });

  describe('PATCH /users/me', () => {
    it('should delegate to updateProfile with userId and dto', async () => {
      const dto = { name: 'New Name', email: 'new@example.com' };
      mockUsersService.updateProfile.mockResolvedValue({ ...mockUser, ...dto });
      const result = await controller.updateProfile(mockReq, dto);
      expect(service.updateProfile).toHaveBeenCalledWith('user-1', dto);
      expect(result.name).toBe('New Name');
    });
  });

  describe('PATCH /users/me/password', () => {
    it('should delegate to updatePassword with userId and dto', async () => {
      const dto = { current_password: 'old123', new_password: 'new12345' };
      mockUsersService.updatePassword.mockResolvedValue({ message: 'Senha alterada com sucesso.' });
      const result = await controller.updatePassword(mockReq, dto);
      expect(service.updatePassword).toHaveBeenCalledWith('user-1', dto);
      expect(result.message).toBe('Senha alterada com sucesso.');
    });
  });

  describe('DELETE /users/me', () => {
    it('should call deleteAccount with userId and req.ip', async () => {
      mockUsersService.deleteAccount.mockResolvedValue(undefined);
      await controller.deleteAccount(mockReq);
      expect(service.deleteAccount).toHaveBeenCalledWith('user-1', '127.0.0.1');
    });
  });
});
