import { Test, TestingModule } from '@nestjs/testing';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { SubscriptionService } from '../subscription/subscription.service';

describe('UsersController', () => {
  let controller: UsersController;

  const mockUsersService = {
    getProfile: jest.fn(),
    updateProfile: jest.fn(),
    updatePassword: jest.fn(),
    deleteAccount: jest.fn(),
    updateAvatar: jest.fn(),
  };

  const mockSubscriptionService = {
    cancelSubscription: jest.fn(),
  };

  const mockReq = { user: { id: 'user-1' }, ip: '127.0.0.1' };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UsersController],
      providers: [
        { provide: UsersService, useValue: mockUsersService },
        { provide: SubscriptionService, useValue: mockSubscriptionService },
      ],
    }).compile();
    controller = module.get<UsersController>(UsersController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  // ─── DELETE /users/me ─────────────────────────────────────────
  // Lógica real no controller: chama cancelSubscription + deleteAccount em sequência,
  // e continua com deleteAccount mesmo se cancelSubscription falhar.
  describe('deleteAccount', () => {
    it('deve cancelar assinatura e depois anonimizar a conta', async () => {
      mockSubscriptionService.cancelSubscription.mockResolvedValue(undefined);
      mockUsersService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteAccount(mockReq as any);

      expect(mockSubscriptionService.cancelSubscription).toHaveBeenCalledWith('user-1');
      expect(mockUsersService.deleteAccount).toHaveBeenCalledWith('user-1', '127.0.0.1');
    });

    it('deve anonimizar mesmo quando cancelamento da assinatura falha', async () => {
      mockSubscriptionService.cancelSubscription.mockRejectedValue(new Error('sem assinatura'));
      mockUsersService.deleteAccount.mockResolvedValue(undefined);

      await controller.deleteAccount(mockReq as any);

      expect(mockUsersService.deleteAccount).toHaveBeenCalledWith('user-1', '127.0.0.1');
    });
  });

  // ─── POST /users/me/avatar ────────────────────────────────────
  // Lógica real no controller: constrói URL a partir do filename do arquivo.
  describe('uploadAvatar', () => {
    it('deve construir URL e delegar para service', async () => {
      const mockFile = { filename: 'avatar-123.jpg' } as Express.Multer.File;
      mockUsersService.updateAvatar.mockResolvedValueOnce({ avatarUrl: '/uploads/avatars/avatar-123.jpg' });

      const result = await controller.uploadAvatar(mockReq as any, mockFile);

      expect(mockUsersService.updateAvatar).toHaveBeenCalledWith('user-1', '/uploads/avatars/avatar-123.jpg');
      expect(result).toEqual({ avatarUrl: '/uploads/avatars/avatar-123.jpg' });
    });
  });
});
