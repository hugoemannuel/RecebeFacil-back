import { Test, TestingModule } from '@nestjs/testing';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

describe('SubscriptionController', () => {
  let controller: SubscriptionController;

  const mockService = {
    getSubscriptionStatus: jest.fn(),
    cancelSubscription: jest.fn(),
    createCheckout: jest.fn(),
  };

  const req = { user: { id: 'user-1' } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SubscriptionController],
      providers: [{ provide: SubscriptionService, useValue: mockService }],
    }).compile();
    controller = module.get<SubscriptionController>(SubscriptionController);
  });

  afterEach(() => jest.clearAllMocks());

  it('deve estar definido', () => expect(controller).toBeDefined());

  it('getStatus delega para service', async () => {
    mockService.getSubscriptionStatus.mockResolvedValueOnce({ plan: 'FREE' });
    await controller.getStatus(req as any);
    expect(mockService.getSubscriptionStatus).toHaveBeenCalledWith('user-1');
  });

  it('cancel delega para service', async () => {
    mockService.cancelSubscription.mockResolvedValueOnce({ cancel_at_period_end: true });
    await controller.cancel(req as any);
    expect(mockService.cancelSubscription).toHaveBeenCalledWith('user-1');
  });

  it('checkout delega para service com planType, period e document', async () => {
    mockService.createCheckout.mockResolvedValueOnce({ invoiceUrl: 'https://...' });
    await controller.checkout(req as any, { planType: 'PRO', period: 'MONTHLY', document: '123' });
    expect(mockService.createCheckout).toHaveBeenCalledWith('user-1', 'PRO', 'MONTHLY', '123');
  });

  it('retryPayment chama getSubscriptionStatus (stub)', async () => {
    mockService.getSubscriptionStatus.mockResolvedValueOnce({ plan: 'PRO' });
    await controller.retryPayment(req as any);
    expect(mockService.getSubscriptionStatus).toHaveBeenCalledWith('user-1');
  });
});
